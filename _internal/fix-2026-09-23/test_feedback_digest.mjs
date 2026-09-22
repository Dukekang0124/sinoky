/**
 * B3 反馈智能分诊 —— 行为自测（v0.23.21）
 *
 * 直接 import 真 _worker.js，mock env（KV / GLM_KEY / AI / ASSETS）与 global.fetch，
 * 用真 Request 打 GET /api/feedback?digest=1，断言端到端行为。
 *
 * 运行：node _internal/fix-2026-09-23/test_feedback_digest.mjs
 */
import worker from '../../_worker.js';

const TOKEN = 'test-token-abc';
let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log(`  ✓ ${id} ${m}`); };
const no = (id, m) => { fail++; console.log(`  ✗ ${id} ${m}`); };

/* ---------- KV stub ---------- */
function makeKV(entries) {
  const store = new Map();
  for (const e of entries) store.set(e.key, JSON.stringify(e.val));
  const kv = {
    puts: 0, gets: 0, lists: 0,
    async list(opts = {}) {
      kv.lists++;
      let names = [...store.keys()];
      if (opts.prefix) names = names.filter((n) => n.startsWith(opts.prefix));
      if (opts.limit) names = names.slice(0, opts.limit);
      return { keys: names.map((name) => ({ name })), list_complete: true };
    },
    async get(k) { kv.gets++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { kv.puts++; store.set(k, v); },
  };
  return kv;
}

/* ---------- fetch mock ---------- */
let captured = [];
function mockFetch({ glm = 'ok', ai = 'ok' } = {}) {
  captured = [];
  return async (url, opts = {}) => {
    const u = String(url);
    captured.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('bigmodel.cn')) {
      if (glm === 'ok') {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            summary: '本批反馈集中在音频无声与麦克风授权，整体情绪偏挫败。',
            clusters: [
              { topic: '音频无声', cat: 'audio', count: 2, samples: ['No sound at all'], action: '检查 iOS 静音开关与 audio unlock' },
              { topic: '麦克风问题', cat: 'mic', count: 1, samples: ['Mic never starts'], action: '补权限引导文案' },
            ],
            urgent: { topic: '音频无声', why: '新用户第一句就听不到声音，直接流失' },
          }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (glm === 'fenced') {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '```json\n{"summary":"fenced ok","clusters":[],"urgent":null}\n```' } }],
        }), { status: 200 });
      }
      if (glm === 'prose') {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '总结：这周反馈不多，主要是音频问题，建议先修静音开关。' } }],
        }), { status: 200 });
      }
      return new Response('boom', { status: 500 }); // glm==='fail'
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

function makeEnv({ items = [], glmKey = 'fake-key', aiMode = 'ok', fetchMode = {} } = {}) {
  const kv = makeKV(items);
  const env = {
    FEEDBACK: kv,
    PROFILES: makeKV([]),
    FEEDBACK_TOKEN: TOKEN,
    GLM_KEY: glmKey,
    AI: {
      runs: 0,
      async run(model, payload) {
        env.AI.runs++;
        if (aiMode === 'throw') throw new Error('ai down');
        if (aiMode === 'empty') return { response: '' };
        return { response: JSON.stringify({ summary: 'AI fallback summary', clusters: [], urgent: null }) };
      },
    },
    ASSETS: { fetch: async () => new Response('assets', { status: 200 }) },
  };
  globalThis.fetch = mockFetch(fetchMode);
  return env;
}

const ITEMS = [
  { key: 'fb:1', val: { t: '2026-09-22T10:00:00Z', msg: 'No sound at all', cat: 'audio', v: '0.23.20', country: 'US', ua: 'X', errs: ['e1'] } },
  { key: 'fb:2', val: { t: '2026-09-22T11:00:00Z', msg: 'Mic never starts', cat: 'mic', v: '0.23.20', country: 'DE' } },
  { key: 'fb:3', val: { t: '2026-09-23T02:00:00Z', msg: 'I want to say my job', cat: 'wantline', v: '0.23.19', country: 'FR' } },
  { key: 'rl:ip:1', val: { n: 5 } },        // 必须被过滤
  { key: 'chat:abc', val: { reply: 'hi' } }, // 必须被过滤
];

async function call(qs, env) {
  const req = new Request('https://sinoky.pages.dev/api/feedback' + qs, { method: 'GET' });
  const res = await worker.fetch(req, env, {});
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/* ---------- run ---------- */
console.log('\n=== B3 feedback digest self-test ===\n');

// T1 token 未配置 → 404
{
  const env = makeEnv(); env.FEEDBACK_TOKEN = '';
  const r = await call('?token=x', env);
  r.status === 404 ? ok('T1', 'token 未配置时端点禁用 404') : no('T1', 'got ' + r.status);
}

// T2 错误 token → 403
{
  const env = makeEnv({ items: ITEMS });
  const r = await call('?token=wrong', env);
  r.status === 403 ? ok('T2', '错误 token -> 403') : no('T2', 'got ' + r.status + ' ' + JSON.stringify(r.body));
}

// T3 无 digest（回归）：结构与过滤不变
{
  const env = makeEnv({ items: ITEMS });
  const r = await call('?token=' + TOKEN, env);
  const names = (r.body.items || []).map((x) => x.cat);
  const okShape = r.status === 200 && r.body.ok === true && r.body.count === 3 && r.body.digest === undefined;
  const okFilter = !names.includes(undefined) && r.body.items.length === 3;
  (okShape && okFilter) ? ok('T3', '无 digest 时行为不变（count=3，rl:/chat: 已过滤）') : no('T3', JSON.stringify(r.body).slice(0, 200));
}

// T4 digest=1 但零反馈
{
  const env = makeEnv({ items: [] });
  const r = await call('?token=' + TOKEN + '&digest=1', env);
  const d = r.body && r.body.digest;
  (r.status === 200 && d && d.count === 0 && d.clusters.length === 0 && d.degraded === false)
    ? ok('T4', '空反馈 -> count=0，不调模型')
    : no('T4', JSON.stringify(r.body).slice(0, 200));
  captured.length === 0 ? ok('T4b', '空反馈时未发起任何模型调用') : no('T4b', 'unexpected fetch ' + captured.length);
}

// T5 digest=1 正常路径
{
  const env = makeEnv({ items: ITEMS });
  const r = await call('?token=' + TOKEN + '&digest=1', env);
  const d = r.body && r.body.digest;
  const good = r.status === 200 && d && d.degraded === false && d.model === 'glm-4-flash'
    && /音频/.test(d.summary) && d.clusters.length === 2 && d.urgent && d.count === 3;
  good ? ok('T5', 'digest 解析成功（summary/clusters/urgent/count 齐）') : no('T5', JSON.stringify(r.body).slice(0, 260));
}

// T6 模型被 ```json 包裹
{
  const env = makeEnv({ items: ITEMS, fetchMode: { glm: 'fenced' } });
  const r = await call('?token=' + TOKEN + '&digest=1', env);
  const d = r.body && r.body.digest;
  (d && d.summary === 'fenced ok' && d.degraded === false)
    ? ok('T6', '剥 ```json 壳后仍解析')
    : no('T6', JSON.stringify(d).slice(0, 200));
}

// T7 GLM 挂 → Workers AI 兜底
{
  const env = makeEnv({ items: ITEMS, fetchMode: { glm: 'fail' } });
  const r = await call('?token=' + TOKEN + '&digest=1', env);
  const d = r.body && r.body.digest;
  (d && d.model.startsWith('workers-ai:') && env.AI.runs >= 1 && d.degraded === false)
    ? ok('T7', 'GLM 500 -> Workers AI 兜底（model=' + d.model + '）')
    : no('T7', JSON.stringify(d).slice(0, 200));
}

// T8 双层都挂 → 温柔降级，不崩
{
  const env = makeEnv({ items: ITEMS, fetchMode: { glm: 'fail' }, aiMode: 'throw' });
  const r = await call('?token=' + TOKEN + '&digest=1', env);
  const d = r.body && r.body.digest;
  (r.status === 200 && d && d.degraded === true && /AI 摘要暂时不可用/.test(d.summary) && d.model.startsWith('degraded:'))
    ? ok('T8', '双层皆挂 -> degraded=true 且 HTTP 200（不崩）')
    : no('T8', r.status + ' ' + JSON.stringify(d).slice(0, 200));
}

// T9 模型返回散文（非 JSON）→ unparsed 兜底
{
  const env = makeEnv({ items: ITEMS, fetchMode: { glm: 'prose' } });
  const r = await call('?token=' + TOKEN + '&digest=1', env);
  const d = r.body && r.body.digest;
  (d && d.clusters.length === 0 && d.raw && d.model.endsWith(':unparsed') && /这周反馈不多/.test(d.summary))
    ? ok('T9', '非 JSON 输出 -> unparsed 原文兜底')
    : no('T9', JSON.stringify(d).slice(0, 220));
}

// T10 prompt 只含精简字段（丢掉 ua/errs），且含全部 3 条
{
  const env = makeEnv({ items: ITEMS });
  await call('?token=' + TOKEN + '&digest=1', env);
  const call0 = captured.find((c) => c.url.includes('bigmodel.cn'));
  const userMsg = call0 && call0.body.messages.find((m) => m.role === 'user').content;
  const sysMsg = call0 && call0.body.messages.find((m) => m.role === 'system').content;
  const good = userMsg && /共 3 条反馈/.test(userMsg) && /No sound at all/.test(userMsg)
    && !/errs/.test(userMsg) && !/\"ua\"/.test(userMsg)
    && sysMsg && /主题簇|clusters/.test(sysMsg);
  good ? ok('T10', 'prompt 精简（去 errs/ua）且含全部反馈与聚类指令') : no('T10', String(userMsg).slice(0, 200));
}

// T11 msg 截断 200 字 + 条目上限 80
{
  const long = 'x'.repeat(500);
  const many = Array.from({ length: 100 }, (_, i) => ({ key: 'fb:' + i, val: { t: '2026-09-23T00:00:00Z', msg: long, cat: 'other' } }));
  many.push({ key: 'fb:long', val: { t: '2026-09-23T00:00:00Z', msg: long, cat: 'other' } });
  const env = makeEnv({ items: many });
  await call('?token=' + TOKEN + '&digest=1', env);
  const call0 = captured.find((c) => c.url.includes('bigmodel.cn'));
  const userMsg = call0.body.messages.find((m) => m.role === 'user').content;
  const n = (userMsg.match(/xxxx/g) || []).length;
  const capOk = /共 80 条反馈/.test(userMsg);   // list 上限 200，但 digest 只取前 80
  const truncOk = !userMsg.includes('x'.repeat(201));
  (capOk && truncOk) ? ok('T11', '条目上限 80 + msg 截断 200 字') : no('T11', 'cap=' + capOk + ' trunc=' + truncOk + ' n=' + n);
}

// T12 零新增 KV 写
{
  const env = makeEnv({ items: ITEMS });
  const before = env.FEEDBACK.puts;
  await call('?token=' + TOKEN + '&digest=1', env);
  (env.FEEDBACK.puts === before && before === 0)
    ? ok('T12', 'digest 全流程 0 次 KV 写（零新增写红线）')
    : no('T12', 'puts=' + env.FEEDBACK.puts);
}

// T13 digest=1 时同样过滤 rl:/chat:（不把计数器喂给模型）
{
  const env = makeEnv({ items: ITEMS });
  await call('?token=' + TOKEN + '&digest=1', env);
  const call0 = captured.find((c) => c.url.includes('bigmodel.cn'));
  const userMsg = call0.body.messages.find((m) => m.role === 'user').content;
  (!/\"n\":5/.test(userMsg) && !/reply/.test(userMsg))
    ? ok('T13', 'rl:/chat: 条目未进 prompt')
    : no('T13', userMsg.slice(0, 200));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
