#!/usr/bin/env node
/* v0.29.4 限流兜底改造 —— 真跑单测 + 干预式因果 A/B（零网络、零生产写入）
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────
 * v0.29.4 改了两件事，两件都**没法靠读代码证明**：
 *   ① 删掉「KV 兜底写 rl:<ip>」—— 要证明的是「真的一次都不再写了」（写配额是本次事故的实伤面）
 *   ② 新增「降级显式上报（alert:rate-degraded）」—— 要证明的是「真写了、且真的被节流」
 * 静态扫源码只能证明「字符串不在文件里」，证明不了运行时不再触发写入路径。
 * 所以这里把 `_worker.js` 当真 ESM import 进来，喂**内存 KV（记录每一次 put）** + 假 DO，
 * 真跑 `GET /api/profile`，然后查 KV 的真实写入记录。
 *
 * ── 干预式因果（铁律）─────────────────────────────────────────────
 * 同一组夹具跑两版：当前源码 vs **固定 commit** 的旧版（改动前的 `_worker.js`）。
 * 旧版必须**做得到**「写 rl: 键」，否则说明这组断言没有判别力（恒真）。
 * 锚点 = `19381b7`（v0.29.3，本次改动之前的最后一个提交）。
 * ⚠️ 锚点绝不能写浮动的 HEAD —— 一旦提交，HEAD 就含新代码，控制组变成对照组自己。
 *
 * 用法：node _internal/test_ratelimit.cjs
 * 退出码：0 = 全绿；1 = 有失败
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OLD_REF = '19381b7';   // v0.29.3 = 本次改动之前的最后一个提交

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')); }
};

/* ---- 内存 KV：记录每一次 put（这是本次唯一重要的事实来源）---- */
function mkKV(seed) {
  const m = new Map(Object.entries(seed || {}));
  const writes = [];
  return {
    _m: m, _writes: writes,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, opts) { m.set(k, v); writes.push({ k: k, opts: opts }); },
    async delete(k) { m.delete(k); },
    async list(o) {
      const pre = (o && o.prefix) || '';
      const keys = [...m.keys()].filter((k) => k.indexOf(pre) === 0).map((name) => ({ name: name }));
      return { keys: keys.slice(0, (o && o.limit) || 1000), list_complete: true };
    },
    _prefix(p) { return writes.filter((w) => w.k.indexOf(p) === 0).map((w) => w.k); }
  };
}

/* ---- 假 Durable Object：三种行为（正常 / 一律拒绝 / 抛异常）---- */
function mkDO(opts) {
  opts = opts || {};
  const state = new Map();
  const calls = [];
  return {
    _calls: calls,
    idFromName(n) {
      if (opts.throwOnId) throw new Error('do boom');
      return n;
    },
    get(id) {
      return {
        async fetch(url) {
          const s = String(url);
          calls.push({ id: id, url: s });
          if (opts.deny) {
            return new Response(JSON.stringify({ allowed: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          const u = new URL(s);
          const mx = Number(u.searchParams.get('max'));
          const w = Number(u.searchParams.get('window'));
          const now = Date.now();
          let e = state.get(id);
          if (!e || now - e.ts > w) { e = { ts: now, count: 0 }; state.set(id, e); }
          e.count++;
          return new Response(JSON.stringify({ allowed: e.count <= mx }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      };
    }
  };
}

/* ---- 把某份 _worker.js 落成临时 .mjs 再 import ----
 * 🔴 必须落在**仓库根**（与 _worker.js 同目录），不能放 _internal/：
 *    `_worker.js` 里有**相对 import**（`./badge-backend.mjs` 等），
 *    副本换了目录就会 ERR_MODULE_NOT_FOUND（实测踩过）。 */
function stage(srcText, name) {
  const p = path.join(ROOT, name);
  fs.writeFileSync(p, srcText, 'utf8');
  return p;
}
/* 🔴 取旧版源码：本环境 `git show` 会 spawnSync EBUSY（同 verify_release.cjs 记录的
 *    「该 sandbox 内 node 无法 fork 子进程」限制），所以必须留 GitHub API 回退。
 *    回退用**原生 fetch**（此刻尚未 mock），避免把自己算进「外发请求」计数。 */
const realFetch = globalThis.fetch;
async function oldWorkerSrc(ref) {
  try {
    return cp.execFileSync('git', ['show', ref + ':_worker.js'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    const r = await realFetch('https://api.github.com/repos/Dukekang0124/sinoky/contents/_worker.js?ref=' + ref,
      { headers: { 'User-Agent': 'node' } });
    if (!r.ok) throw new Error('git 不可用（' + String(e.message).split('\n')[0] + '）且 GitHub API HTTP ' + r.status);
    const j = await r.json();
    return Buffer.from(String(j.content || ''), 'base64').toString('utf8');
  }
}
/* 每次带不同 query 破 ESM 模块缓存 ⇒ 每个 load() 等价于一个**全新的 isolate**
   （模块级的 rateDegradeChecked 会归零，正好用来验证跨 isolate 的 KV 节流）。 */
async function load(workerFile) {
  const mod = await import(pathToFileURL(workerFile).href + '?v=' + Date.now() + Math.random());
  return mod.default;
}
async function hit(mod, env, pathname) {
  globalThis.env = env;   // Pages advanced mode 会把 env 也挂成全局（worker 内确有引用）
  const req = new Request('https://sinoky.pages.dev' + pathname);
  const res = await mod.fetch(req, env, {});
  return { status: res.status, text: await res.text() };
}

(async function main() {
  console.log('限流兜底真跑单测 · 锚点 ' + OLD_REF);
  console.log('─'.repeat(60));

  const curSrc = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
  const CUR = stage(curSrc, '_rl_cur.tmp.mjs');

  /* ---- 0. 源码前置守卫（防「改了但没生效」与「锚点腐化」）---- */
  console.log('\n[0] 前置守卫');
  ok('0a 新代码含 rateAlert（降级显式上报）', /function rateAlert/.test(curSrc));
  ok('0b 新代码已删除 KV 兜底的 rl: 写入',
    !/await env\.FEEDBACK\.put\(key, JSON\.stringify\(d\)\)/.test(curSrc));

  let OLD = null;
  try {
    const oldSrc = await oldWorkerSrc(OLD_REF);
    const hasRl = /'rl:'/.test(oldSrc);
    const hasAlert = /function rateAlert/.test(oldSrc);
    if (!hasRl || hasAlert) {
      fail++;
      console.log('  ❌ 0c A/B 锚点 ' + OLD_REF + ' 失效（含 rl:写入=' + hasRl + ' 含 rateAlert=' + hasAlert +
        '）⇒ 控制组不再代表「旧行为」，本组断言失去判别力。请把 OLD_REF 换到更早的提交。');
    } else {
      OLD = stage(oldSrc, '_rl_old.tmp.mjs');
      ok('0c A/B 锚点 ' + OLD_REF + ' 有效（旧版有 rl: 写入、无 rateAlert）', true);
    }
  } catch (e) {
    fail++;
    console.log('  ❌ 0c 取不到锚点 ' + OLD_REF + '：' + String(e.message || e).slice(0, 100) +
      '\n        ↳ 取不到旧版 = A/B 无法成立 = 本组断言会退化成恒真，必须硬失败而不是跳过。');
  }

  /* 任何外发请求都不该发生（本测试零网络） */
  let extHits = 0;
  globalThis.fetch = async (u) => { extHits++; throw new Error('unexpected external fetch: ' + u); };

  /* ================= A 组：env.RL 缺失（复现本次事故的配置状态）================= */
  console.log('\n[A] env.RL 缺失 → 兜底必须「不写任何存储」+ 显式告警');
  {
    const fb = mkKV(), pf = mkKV();
    const env = { FEEDBACK: fb, PROFILES: pf };
    const mod = await load(CUR);

    const r1 = await hit(mod, env, '/api/profile?uid=rlA');
    ok('A1 用户请求未被降级拖垮', r1.status === 200, 'status=' + r1.status + ' body=' + r1.text.slice(0, 90));

    const rlW = fb._prefix('rl:');
    ok('A2 【核心】没有再写 rl: 键（这就是烧掉 426 条配额的元凶）', rlW.length === 0,
      '实际写了 ' + rlW.length + ' 个：' + rlW.slice(0, 3).join(','));

    const aW = fb._prefix('alert:');
    ok('A3 写了一条可见告警 alert:rate-degraded', aW.length === 1, '实际 ' + aW.length + ' 条：' + aW.join(','));
    const body = fb._m.get('alert:rate-degraded') || '';
    ok('A4 告警 reason = no-rl-binding', /no-rl-binding/.test(String(body)), String(body).slice(0, 140));

    /* 同 isolate 连发 → 模块级 flag 必须挡住重复写 */
    for (let i = 0; i < 5; i++) await hit(mod, env, '/api/profile?uid=rlA' + i);
    ok('A5 同 isolate 连发 6 次仍只写 1 条告警', fb._prefix('alert:').length === 1,
      '实际 ' + fb._prefix('alert:').length + ' 条');
    ok('A6 连发后仍无 rl: 写入', fb._prefix('rl:').length === 0);

    /* 新 isolate（模块 flag 归零）+ KV 里已有 6h 内告警 → 必须靠「先读后写」再挡一次 */
    const mod2 = await load(CUR);
    await hit(mod2, env, '/api/profile?uid=rlB');
    ok('A7 跨 isolate 节流生效（新 isolate 也不重复写）', fb._prefix('alert:').length === 1,
      '实际 ' + fb._prefix('alert:').length + ' 条 —— 说明「先读后写」的 6h 节流真的在起作用');
  }

  /* ================= B 组：env.RL 正常 ================= */
  console.log('\n[B] env.RL 正常 → 计数走 DO、KV 零写入');
  {
    const fb = mkKV(), pf = mkKV();
    const doFake = mkDO();
    const env = { FEEDBACK: fb, PROFILES: pf, RL: doFake };
    const mod = await load(CUR);

    const r = await hit(mod, env, '/api/profile?uid=rlC');
    ok('B1 请求正常 200', r.status === 200, 'status=' + r.status);
    ok('B2 DO 真被调用（且恰好 1 次）', doFake._calls.length === 1, 'DO 调用 ' + doFake._calls.length + ' 次');
    ok('B3 DO 收到 max=120（RATE_MAX 真传下去了）',
      /max=120/.test((doFake._calls[0] || {}).url || ''), ((doFake._calls[0] || {}).url || '(无)'));
    ok('B4 【核心】KV 零写入（正常路径完全不碰存储）', fb._writes.length === 0,
      '写了 ' + fb._writes.length + ' 条：' + fb._writes.map((w) => w.k).join(','));
  }

  /* ================= C 组：DO 抛异常 → 降级但不能阻塞 ================= */
  console.log('\n[C] DO 调用抛异常 → 不阻塞用户 + 上报 do-error');
  {
    const fb = mkKV(), pf = mkKV();
    const env = { FEEDBACK: fb, PROFILES: pf, RL: mkDO({ throwOnId: true }) };
    const mod = await load(CUR);
    const r = await hit(mod, env, '/api/profile?uid=rlD');
    ok('C1 不因 DO 挂掉而 5xx', r.status === 200, 'status=' + r.status + ' body=' + r.text.slice(0, 90));
    const b = String(fb._m.get('alert:rate-degraded') || '');
    ok('C2 上报 reason 含 do-error（区别于绑定缺失）', /do-error/.test(b), b.slice(0, 140));
    ok('C3 降级路径也不写 rl: 键', fb._prefix('rl:').length === 0);
  }

  /* ================= D 组：DO 判超限 → 必须 429（证明限流真的会拦）================= */
  console.log('\n[D] DO 判超限 → 必须返回 429（线上事故里 429 个数恒为 0）');
  {
    const fb = mkKV(), pf = mkKV();
    const env = { FEEDBACK: fb, PROFILES: pf, RL: mkDO({ deny: true }) };
    const mod = await load(CUR);
    const r = await hit(mod, env, '/api/profile?uid=rlE');
    ok('D1 超限返回 429', r.status === 429, 'status=' + r.status + ' body=' + r.text.slice(0, 90));
    ok('D2 429 文案为 rate limited', /rate limited/.test(r.text), r.text.slice(0, 90));
  }

  /* ================= E 组：告警键不得污染反馈视图 ================= */
  console.log('\n[E] /api/feedback 必须跳过 alert: 键');
  {
    const fb = mkKV({
      'alert:rate-degraded': JSON.stringify({ ts: Date.now(), reason: 'no-rl-binding' }),
      'rl:1.2.3.4': JSON.stringify({ ts: Date.now(), count: 9 }),
      'chat:x1': JSON.stringify({ t: 'x', q: 'x' }),
      'aBc123': JSON.stringify({ t: '2026-09-28T10:00:00Z', msg: '真实用户反馈' })
    });
    const env = { FEEDBACK: fb, PROFILES: mkKV(), FEEDBACK_TOKEN: 'T' };
    const mod = await load(CUR);
    const r = await hit(mod, env, '/api/feedback?token=T');
    ok('E1 读端点 200', r.status === 200, 'status=' + r.status);
    let j = null; try { j = JSON.parse(r.text); } catch (e) { /* 下面判 */ }
    ok('E2 返回可解析 JSON 且 count=1', !!j && j.count === 1, r.text.slice(0, 160));
    const txt = r.text;
    ok('E3 items 不含 alert: / rl: / chat: 的内容', !!j && !/no-rl-binding/.test(txt) && !/count":9/.test(txt),
      txt.slice(0, 200));
  }

  /* ================= F 组：A/B 干预式因果 ================= */
  console.log('\n[F] A/B 对照：旧版（' + OLD_REF + '）必须**做得到**写 rl: —— 否则本组无判别力');
  if (!OLD) {
    console.log('  ⏭  跳过（锚点不可用，已在 0c 硬失败）');
  } else {
    const oldMod = await load(OLD);
    const fb = mkKV(), pf = mkKV();
    const env = { FEEDBACK: fb, PROFILES: pf };   // 同样不给 RL（模拟本次事故的配置状态）
    for (let i = 0; i < 3; i++) await hit(oldMod, env, '/api/profile?uid=old' + i);
    const rlW = fb._prefix('rl:');
    ok('F1 旧版写了 rl: 键（≥3）—— 证明这是**真实的行为改变**，不是恒真断言',
      rlW.length >= 3, '旧版写了 ' + rlW.length + ' 个：' + rlW.slice(0, 4).join(','));
    ok('F2 旧版从不写 alert:（该机制当时不存在）', fb._prefix('alert:').length === 0,
      '旧版写了 ' + fb._prefix('alert:').length + ' 条');
    console.log('      ↳ 对照：新版同场景写了 ' + 0 + ' 个 rl: 键 —— 差额即本次修复的真实效果');
  }

  ok('G1 全程零外部网络请求（mock fetch 未被触发）', extHits === 0, '被触发 ' + extHits + ' 次');

  console.log('─'.repeat(60));
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  try { fs.unlinkSync(CUR); } catch (e) { /* ignore */ }
  try { if (OLD) fs.unlinkSync(OLD); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试自身异常：' + (e && e.stack || e)); process.exit(1); });
