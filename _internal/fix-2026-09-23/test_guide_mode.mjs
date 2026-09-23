/**
 * v0.23.22 城市攻略问答（mode:'guide'）—— 行为自测
 *
 * 直接 import 真 _worker.js，mock env（KV / GLM_KEY / AI）与 global.fetch，
 * 用真 Request 打 POST /api/chat，断言：
 *   G1  mode:'guide' → 选中 GUIDE_SYSTEM（系统提示含本地通/拼音/城市人格）
 *   G2  mode:'guide' → 端到端返回含「中文+拼音+英文」实务格式的回复（透传）
 *   G3  mode:'chat'  → 选中 CHAT_SYSTEM（证明分支真切换，不是 guide 恒成立）
 *   G4  缺省 mode    → 回落 CHAT_SYSTEM（不是 guide）
 *   G5  mode:'guide' + 前端城市前缀【城市：上海】→ 用户消息原样透传（服务端不剥离）
 *   G6  guide 复用 chat 限流桶 + 既有 chat 统计写（零新增 KV 绑定）
 *
 * 运行：node _internal/fix-2026-09-23/test_guide_mode.mjs
 */
import worker from '../../_worker.js';

let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log(`  ✓ ${id} ${m}`); };
const no = (id, m) => { fail++; console.log(`  ✗ ${id} ${m}`); };

/* ---------- KV stub ---------- */
function makeKV() {
  const store = new Map();
  const kv = {
    puts: 0, gets: 0, lists: 0,
    async list() { kv.lists++; return { keys: [...store.keys()].map((n) => ({ name: n })), list_complete: true }; },
    async get(k) { kv.gets++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { kv.puts++; store.set(k, v); },
  };
  return kv;
}

/* ---------- fetch mock：拦截 bigmodel.cn，捕获系统提示，返回模拟 guide 回复 ---------- */
let captured = [];
function mockFetch() {
  captured = [];
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('bigmodel.cn')) {
      const body = JSON.parse(opts.body);
      captured.push(body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '扫码(sǎo mǎ, scan the code)支付(zhī fù, pay)。打开微信(wēi xìn, WeChat)扫一扫(sǎo yi sǎo, scan)。' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

function makeEnv() {
  const fb = makeKV(); // 复用 FEEDBACK（chat 统计既有写）
  const env = {
    FEEDBACK: fb,
    PROFILES: makeKV(),
    GLM_KEY: 'fake-key',
    AI: { async run() { return { response: 'fallback' }; } },
    ASSETS: { fetch: async () => new Response('assets', { status: 200 }) },
  };
  globalThis.fetch = mockFetch();
  return env;
}

async function callChat({ text, mode, hist, env }) {
  const req = new Request('https://sinoky.pages.dev/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, uid: 'test-uid', hist: hist || [], mode }),
  });
  const res = await worker.fetch(req, env, {});
  const body = await res.json();
  const glmCall = captured.find((c) => c.messages);
  return { status: res.status, body, sysMsg: glmCall ? glmCall.messages.find((m) => m.role === 'system').content : '', userMsg: glmCall ? glmCall.messages.find((m) => m.role === 'user').content : '' };
}

/* ---------- run ---------- */
console.log('\n=== v0.23.22 guide mode self-test ===\n');

// G1 mode:'guide' 选中 GUIDE_SYSTEM
{
  const env = makeEnv();
  const r = await callChat({ text: '怎么去外滩', mode: 'guide', env });
  const isGuide = /本地通|拼音|城市/.test(r.sysMsg) && /旅行实务|扫码\(/.test(r.sysMsg) === false ? /本地通/.test(r.sysMsg) : /本地通/.test(r.sysMsg);
  // GUIDE_SYSTEM 含"本地通""城市本地通"字样
  (r.status === 200 && /本地通/.test(r.sysMsg) && /拼音/.test(r.sysMsg))
    ? ok('G1', 'mode:guide → 系统提示注入城市本地通人格（含 本地通/拼音）')
    : no('G1', 'sysMsg=' + r.sysMsg.slice(0, 80));
}

// G2 端到端返回含"中文+拼音+英文"实务格式
{
  const env = makeEnv();
  const r = await callChat({ text: '怎么付钱', mode: 'guide', env });
  const good = r.status === 200 && r.body.ok === true && /[\u4e00-\u9fff]\([^)]*, [a-z ]+\)/.test(r.body.reply);
  good ? ok('G2', 'mode:guide → 回复含「中文(拼音, English)」格式并透传') : no('G2', JSON.stringify(r.body).slice(0, 160));
}

// G3 mode:'chat' 选中 CHAT_SYSTEM（证明分支真切换）
{
  const env = makeEnv();
  const r = await callChat({ text: '你好', mode: 'chat', env });
  const isChat = !/本地通/.test(r.sysMsg) && !/拼音/.test(r.sysMsg);
  isChat ? ok('G3', 'mode:chat → 选中 CHAT_SYSTEM（不含 本地通/拼音，分支真切换）') : no('G3', 'sysMsg=' + r.sysMsg.slice(0, 80));
}

// G4 缺省 mode 回落 CHAT_SYSTEM
{
  const env = makeEnv();
  const r = await callChat({ text: '你好', mode: undefined, env });
  !/本地通/.test(r.sysMsg) ? ok('G4', '缺省 mode → 回落 CHAT_SYSTEM（非 guide）') : no('G4', 'sysMsg=' + r.sysMsg.slice(0, 80));
}

// G5 城市前缀透传
{
  const env = makeEnv();
  const r = await callChat({ text: '【城市：上海】怎么去机场', mode: 'guide', env });
  r.userMsg === '【城市：上海】怎么去机场'
    ? ok('G5', 'mode:guide + 城市前缀【城市：上海】原样透传（服务端不剥离）')
    : no('G5', 'userMsg=' + r.userMsg);
}

// G6 guide 复用 chat 统计写（既有 FEEDBACK 绑定，零新增 KV 绑定）
{
  const env = makeEnv();
  const r = await callChat({ text: '怎么坐地铁', mode: 'guide', env });
  (r.status === 200 && env.FEEDBACK.puts >= 1)
    ? ok('G6', 'guide 走同一 chat 统计写（FEEDBACK.put=' + env.FEEDBACK.puts + '，零新增绑定）')
    : no('G6', 'FEEDBACK.puts=' + env.FEEDBACK.puts);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
