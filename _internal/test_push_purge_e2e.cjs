#!/usr/bin/env node
/* v0.29.2 行程隐私清理 —— 集成级真跑 + 干预式因果 A/B
 *
 * 为什么还要一个 e2e：`test_push_tree.cjs` 用真源码抽段测的是**纯函数判据**，
 * 它证明不了「/api/push-send 真的把行程字段写回了 KV」—— 中间还隔着分页循环、
 * dry 开关、writeLast 节流、try/catch 兜底、以及 `rec` 在循环里被就地改写这类细节。
 * 这里把 `_worker.js` 当**真 ESM import** 进来，喂内存 KV + 假 fetch，
 * **真跑一次 GET /api/push-send**，然后查 KV 的真实字节。
 *
 * 干预式因果（铁律）：同一份夹具跑两版 —— 当前源码 vs `git show HEAD:_worker.js` 的旧版。
 * 旧版必须**做不到**（无 tripPurged 字段、arrive 原封不动），否则说明这组断言是假的。
 *
 * 用法：node _internal/test_push_purge_e2e.cjs   （零网络、零生产写入）
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
const eq = (n, g, w) => ok(n, g === w, 'got ' + JSON.stringify(g) + ' want ' + JSON.stringify(w));

const TZ = 8;
const localDay = (o) => new Date(Date.now() + TZ * 3600e3 + (o || 0) * 86400e3).toISOString().slice(0, 10);

/* ---- 内存 KV（只实现 worker 用到的 4 个方法）---- */
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
      const keys = [...m.keys()].filter(k => k.indexOf(pre) === 0).map(name => ({ name: name }));
      return { keys: keys.slice(0, (o && o.limit) || 1000), list_complete: true };
    }
  };
}

/* ---- 真 P-256 密钥：vapidToken 走 WebCrypto importKey('jwk') ---- */
async function vapidJwk() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
}

/* ---- 一条订阅记录 ---- */
function recFixture(over) {
  return JSON.stringify({
    uid: 'u' + Math.random().toString(36).slice(2, 6),
    sub: { endpoint: 'https://push.example/x' },
    at: Date.now(),
    p: Object.assign({
      tz: TZ, at: Date.now(), pur: 'travel',
      city: '上海', cityId: 'shanghai', cityEn: 'Shanghai',
      arrive: '', days: 6, streak: 0, due: 0, weakTop: '', lang: 'en', lastDone: ''
    }, over || {})
  });
}

/* ---- 把某个 _worker.js 复制成 .mjs 临时文件再 import（相对 import 才解析得到）---- */
function stage(srcText, name) {
  const p = path.join(ROOT, name);
  fs.writeFileSync(p, srcText);
  return p;
}
async function run(workerFile, KV, query) {
  /* 每次带不同 query 破 ESM 模块缓存，保证两版互不污染 */
  const mod = await import(pathToFileURL(workerFile).href + '?v=' + Date.now() + Math.random());
  const env = {
    PUSH: KV,
    STATS_TOKEN: 'T',
    VAPID_PRIVATE: await vapidJwk(),
    ASSETS: { fetch: async () => new Response('', { status: 404 }) }
  };
  /* 🔴 Pages advanced mode 会把 env 同时挂成**全局** —— `vapidAuth()` 里引用的就是
     这个全局（不是 fetch 的形参），生产环境靠它工作。harness 必须一并模拟，
     否则 vapidToken 抛 ReferenceError → 被 catch 成 failed，看起来像「推送没发」。 */
  globalThis.env = env;
  const req = new Request('https://sinoky.pages.dev/api/push-send?token=T' + (query || ''));
  const res = await mod.default.fetch(req, env, {});
  return { body: await res.json(), status: res.status };
}

(async function main() {
  const CUR = stage(fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8'), '_worker.cur.tmp.mjs');
  let OLD = null;
  try {
    OLD = stage(cp.execSync('git show HEAD:_worker.js', { cwd: ROOT, encoding: 'utf8' }), '_worker.old.tmp.mjs');
  } catch (e) { console.log('⚠️ 取不到旧版（git show 失败），跳过 A/B：' + String(e.message || e).slice(0, 80)); }

  /* 假推送端点：一律 201，绝不发真实请求 */
  let pushHits = 0;
  globalThis.fetch = async (u) => { if (String(u).indexOf('https://push.example/') === 0) { pushHits++; return new Response('', { status: 201 }); } throw new Error('unexpected fetch: ' + u); };

  const K1 = 'push:u1:aaa', K2 = 'push:u2:bbb', K3 = 'push:u3:ccc';
  const seed = {};
  seed[K1] = recFixture({ arrive: localDay(-30), days: 6 });                                            /* 结束 30 天 → 该清，清后无触发 */
  seed[K2] = recFixture({ arrive: localDay(0), days: 6, city: '北京', cityId: 'beijing', cityEn: 'Beijing' }); /* 行程中 → 不清，走 A */
  seed[K3] = recFixture({ arrive: localDay(-13), days: 6, streak: 9 });                                 /* 结束 7 天 → 该清，清后走 B */

  console.log('\n=== ① 当前源码：真跑 /api/push-send ===');
  const KV = mkKV(seed);
  const r1 = await run(CUR, KV);
  eq('HTTP 200 + ok', r1.status, 200);
  ok('响应带 tripPurged 字段（新能力就位）', typeof r1.body.tripPurged === 'number', JSON.stringify(r1.body).slice(0, 120));
  eq('tripPurged = 2（u1 结束 30 天、u3 结束 7 天）', r1.body.tripPurged, 2);
  eq('sent = 2（u2 行程推送 + u3 清理后连胜推送）', r1.body.sent, 2);
  eq('skipped = 1（u1 清完行程后无任何触发）', r1.body.skipped, 1);
  eq('真实推送到 push 端点 2 次', pushHits, 2);

  console.log('\n=== ② KV 真实字节：该清的五字段没了，不该动的原样 ===');
  const g1 = JSON.parse(KV._m.get(K1)), g2 = JSON.parse(KV._m.get(K2)), g3 = JSON.parse(KV._m.get(K3));
  ok('u1 行程五字段全被抹掉', !g1.p.arrive && !g1.p.city && !g1.p.cityId && !g1.p.cityEn && !g1.p.days, JSON.stringify(g1.p));
  ok('u1 订阅本体保留（这是本方案的关键 —— 不删订阅）', !!(g1.sub && g1.sub.endpoint), JSON.stringify(g1.sub));
  ok('u1 用途字段 pur 仍在（非行程数据不牵连）', g1.p.pur === 'travel', g1.p.pur);
  eq('u2（行程进行中）arrive 原封不动', g2.p.arrive, localDay(0));
  eq('u2 城市字段原封不动', g2.p.cityId, 'beijing');
  ok('u3 行程字段被抹掉但连胜保留', !g3.p.arrive && g3.p.streak === 9, JSON.stringify(g3.p));
  eq('u3 清理后写了 lastPush（顺手记幂等）', g3.lastPush, new Date().toISOString().slice(0, 10));

  console.log('\n=== ③ 写次数核算（隐私清理不能打爆 KV 写配额）===');
  const w = (k) => KV._writes.filter(x => x.k === k).length;
  eq('K1（清完即 skip → 不写 lastPush）总写 1 次', w(K1), 1);
  eq('K2（行程中 → 只写 lastPush）总写 1 次', w(K2), 1);
  eq('K3（清理 + lastPush）总写 2 次', w(K3), 2);
  eq('3 条订阅下的总 KV 写 = 4（清理只占 2，且一次性）', KV._writes.length, 4);
  ok('全部写都带 180 天 TTL（订阅长命，只有行程字段短命）',
     KV._writes.every(w => w.opts && w.opts.expirationTtl === 180 * 86400),
     JSON.stringify(KV._writes.map(w => w.opts)));

  console.log('\n=== ④ 幂等：同一条 KV 再跑一次 ===');
  const r2 = await run(CUR, KV);
  eq('第二次 tripPurged = 0（清空后条件不再成立，永不重复写）', r2.body.tripPurged, 0);
  const after = KV._writes.filter(w => w.k === K1).length;
  eq('u1 全程只被写过 1 次', after, 1);

  console.log('\n=== ⑤ dry 验收模式不许有副作用 ===');
  const KVD = mkKV(seed);
  const rd = await run(CUR, KVD, '&dry=1');
  eq('dry 下 tripPurged = 0', rd.body.tripPurged, 0);
  eq('dry 下对 KV 零写入', KVD._writes.length, 0);
  ok('dry 下 u1 行程字段仍在（干跑绝不污染）', !!JSON.parse(KVD._m.get(K1)).p.arrive);

  console.log('\n=== ⑥ 干预式因果 A/B：旧版必须做不到 ===');
  if (OLD) {
    const KVO = mkKV(seed);
    pushHits = 0;
    const ro = await run(OLD, KVO);
    eq('旧版响应没有 tripPurged 字段', ro.body.tripPurged, undefined);
    ok('旧版 u1（结束 30 天）行程字段仍在 —— 这正是本版修掉的偏差',
       !!JSON.parse(KVO._m.get(K1)).p.arrive && !!JSON.parse(KVO._m.get(K1)).p.city,
       JSON.stringify(JSON.parse(KVO._m.get(K1)).p));
    ok('旧版 u3 行程字段也仍在', !!JSON.parse(KVO._m.get(K3)).p.arrive);
    eq('两版发出去的推送条数相同（本版只在推送链路上「顺手清」）', ro.body.sent, r1.body.sent);
    console.log('  ℹ️  差异只在 KV 里的行程字段：旧版永远留着，新版 7 天后抹掉。');
  }

  console.log('\n──────────────────────────────────────────────');
  console.log((fail === 0 ? '✅ 行程清理 e2e 全绿' : '❌ 行程清理 e2e 有失败') + ' — ' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('──────────────────────────────────────────────\n');
  fs.rmSync(CUR, { force: true });
  if (OLD) fs.rmSync(OLD, { force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('❌ 运行异常：', e);
  ['_worker.cur.tmp.mjs', '_worker.old.tmp.mjs'].forEach(f => { try { fs.rmSync(path.join(ROOT, f), { force: true }); } catch (_) {} });
  process.exit(1);
});
