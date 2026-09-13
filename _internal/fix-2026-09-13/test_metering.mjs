/**
 * test_metering.mjs —— v0.23.8 组 6 行为验收（审计 P3-13：漏斗四步 + 错误上报）
 *
 * 三层都要验，缺一层就会漏掉一种失败：
 *   A 前端钩子 —— 四个埋点真的被触发了（不是「代码在就算」）
 *   B 后端聚合 —— recordStat 的 OR/max 合并 + summarizeStats 的比率算术
 *   C 配额纪律 —— sig 粗桶真的封住了写放大（**这条最容易被漏，但最贵**）
 *
 * C 的理由：如果错误数直接进 sig，就会「每多一条错误 → 下一次上报多一次 KV 写」，
 * 错误越多写得越勤 —— 正好在系统最脆弱时加压。所以必须证明：同桶内的 n 变化**不触发 put**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const DAY = 86400000;
const t = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  \u2705 ' + n); } else { fail++; console.log('  \u274c ' + n + (extra ? '   ' + extra : '')); } };
const eq = (n, a, b) => ok(n, a === b, '\u671f\u671b ' + JSON.stringify(b) + ' \u5b9e\u5f97 ' + JSON.stringify(a));

/* ─────────── 把 _worker.js 变可 import 模块（与 test_metrics 同法） ─────────── */
let src = fs.readFileSync(path.join(APP, '_worker.js'), 'utf8');
const IMP = "import { handleBadgeApi } from './badge-backend.mjs';";
src = src.replace(IMP, 'const handleBadgeApi = async () => null;');
src += '\nexport { summarizeStats, recordStat };\n';
const tmp = path.join(HERE, '_worker_testable_metering.mjs');
fs.writeFileSync(tmp, src);
const { summarizeStats, recordStat } = await import('file:///' + tmp.replace(/\\/g, '/'));

function mkKV() {
  const store = new Map();
  let puts = 0;
  return {
    _store: store,
    get puts() { return puts; },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { puts++; store.set(k, v); },
  };
}

/* ══════════════════════ B. 后端聚合 ══════════════════════ */
console.log('\n=== B. recordStat：funnel OR 合并 / err max 合并 ===');

{
  const env = { PROFILES: mkKV() };
  // 1) OR：先 open+heard，再 only spoke（不能把已有位抹掉）
  await recordStat(env, 'u1', { phrases: 0, funnel: { open: 1, heard: 1 }, err: { n: 0, last: '' }, src: 'real' });
  await recordStat(env, 'u1', { phrases: 0, funnel: { spoke: 1 }, err: { n: 0, last: '' }, src: 'real' });
  let s = JSON.parse(await env.PROFILES.get('s:u1'));
  eq('B1 open 保留', s.funnel.open, 1);
  eq('B2 heard 保留', s.funnel.heard, 1);
  eq('B3 spoke 新置', s.funnel.spoke, 1);
  eq('B4 verified 仍为 0', s.funnel.verified || 0, 0);

  // 2) verified 置位
  await recordStat(env, 'u1', { phrases: 0, funnel: { verified: 1 }, src: 'real' });
  s = JSON.parse(await env.PROFILES.get('s:u1'));
  eq('B5 verified 置位', s.funnel.verified, 1);

  // 3) err：n 取 max，last 跟随大的一侧
  await recordStat(env, 'u2', { phrases: 0, err: { n: 5, last: 'error: big' }, src: 'real' });
  await recordStat(env, 'u2', { phrases: 0, err: { n: 2, last: 'error: small' }, src: 'real' });
  let s2 = JSON.parse(await env.PROFILES.get('s:u2'));
  eq('B6 err.n 取 max（不回退）', s2.err.n, 5);
  eq('B7 err.last 不被小 n 覆盖', s2.err.last, 'error: big');

  // 4) 老记录（无 funnel / err）不崩
  env.PROFILES._store.set('s:legacy', JSON.stringify({ first: Date.now(), days: [t(0)], phrases: 4, scenes: {}, feat: {} }));
  await recordStat(env, 'legacy', { phrases: 4, funnel: { open: 1 }, src: 'real' });
  const s3 = JSON.parse(await env.PROFILES.get('s:legacy'));
  eq('B8 老记录补上 funnel', s3.funnel.open, 1);
  eq('B9 老记录 phrases 不受影响', s3.phrases, 4);
}

console.log('\n=== B10-B16. summarizeStats：漏斗与错误的聚合 ===');
{
  const env = { PROFILES: mkKV() };
  const put = (uid, o) => env.PROFILES._store.set('s:' + uid, JSON.stringify(o));
  const base = { first: Date.now() - 5 * DAY, days: [t(0)], scenes: {}, feat: {} };
  put('r1', { ...base, src: 'real', phrases: 10, funnel: { open: 1, heard: 1, spoke: 1, verified: 1 } });
  put('r2', { ...base, src: 'real', phrases: 4, funnel: { open: 1, heard: 1 } });
  put('r3', { ...base, src: 'real', phrases: 0, funnel: { open: 1 } });
  put('r4', { ...base, src: 'real', phrases: 0, funnel: { open: 1, heard: 1, spoke: 1 } });
  put('tst', { ...base, src: 'test', phrases: 99, funnel: { open: 1, heard: 1, spoke: 1, verified: 1 }, err: { n: 7, last: 'test boom' } });
  put('e1', { ...base, src: 'real', phrases: 1, funnel: { open: 1, heard: 1 }, err: { n: 3, last: 'error: X' } });
  put('e2', { ...base, src: 'real', phrases: 1, funnel: { open: 1 }, err: { n: 1, last: 'error: X' } });
  put('legacy', { ...base, phrases: 2 });   // 无 funnel/err 的老记录

  const S = await summarizeStats(env);
  eq('B10 users', S.users, 8);
  /* 有 funnel.open 的：r1 r2 r3 r4 tst e1 e2 = 7（legacy 无 funnel 字段，不算「打开过」——
     这是可接受的偏差：旧记录确实无法回溯它有没有打开过） */
  eq('B11 funnel.open', S.funnel.open, 7);
  eq('B12 funnel.heard（r1 r2 r4 tst e1）', S.funnel.heard, 5);
  eq('B13 funnel.spoke（r1 r4 tst）', S.funnel.spoke, 3);
  eq('B14 funnel.verified（r1 tst）', S.funnel.verified, 2);
  eq('B15 funnelReal.open（排除 test）', S.funnelReal.open, 6);
  eq('B16 funnelReal.verifiedRate = 1/6', S.funnelReal.verifiedRate, 16.7);
  eq('B17 errors.devices', S.errors.devices, 3);
  eq('B18 errors.devicesReal', S.errors.devicesReal, 2);
  eq('B19 errors.total（7+3+1）', S.errors.total, 11);
  ok('B20 errors.top 首条是 error: X（2 台）', S.errors.top[0] && S.errors.top[0].msg === 'error: X' && S.errors.top[0].devices === 2,
     JSON.stringify(S.errors.top));
  const S0 = await summarizeStats({ PROFILES: mkKV() });
  eq('B22 空库 users', S0.users, 0);
  eq('B23 空库 funnel.open', S0.funnel.open, 0);
  eq('B24 空库比率是 null 而不是 0（不造假数字）', S0.funnel.spokeRate, null);
}

/* ══════════════════════ C. 配额纪律 ══════════════════════ */
console.log('\n=== C. 配额纪律：错误数粗桶必须封住写放大 ===');
{
  const env = { PROFILES: mkKV() };
  const st = (n, last) => ({ phrases: 9, tone: 0, day1Done: false, scenes: {}, feat: {}, src: 'real', funnel: { open: 1, heard: 1 }, err: { n, last } });
  await recordStat(env, 'q1', st(1, 'error: a'));      // bucket 1 → 写
  const p1 = env.PROFILES.puts;
  await recordStat(env, 'q1', st(2, 'error: b'));      // 仍 bucket 1 → 不写
  const p2 = env.PROFILES.puts;
  await recordStat(env, 'q1', st(2, 'error: c'));      // 仍 bucket 1 → 不写
  const p3 = env.PROFILES.puts;
  await recordStat(env, 'q1', st(3, 'error: d'));      // bucket 2 → 写
  const p4 = env.PROFILES.puts;
  await recordStat(env, 'q1', st(9, 'error: e'));      // bucket 2 → 不写
  const p5 = env.PROFILES.puts;
  await recordStat(env, 'q1', st(10, 'error: f'));     // bucket 3 → 写
  const p6 = env.PROFILES.puts;
  await recordStat(env, 'q1', st(999, 'error: g'));    // bucket 3 → 不写
  const p7 = env.PROFILES.puts;

  console.log('     put 次数轨迹：', [p1, p2, p3, p4, p5, p6, p7].join(' → '));
  eq('C1 首次写', p1, 1);
  eq('C2 同桶内 n 1→2 不写', p2, 1);
  eq('C3 同桶内只换 last 不写', p3, 1);
  eq('C4 跨到 bucket 2 才写', p4, 2);
  eq('C5 bucket 2 内 3→9 不写', p5, 2);
  eq('C6 跨到 bucket 3 才写', p6, 3);
  eq('C7 bucket 3 内 10→999 不写', p7, 3);
  ok('C8 1000 条错误只产生 3 次写（写放大是常数，不随错误数增长）', p7 === 3);
}

/* ══════════════════════ A. 前端钩子 ══════════════════════ */
console.log('\n=== A. 前端四个钩子 + 持久化（Playwright）===');
{
  const http = await import('node:http');
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
  };
  const srv = http.createServer((req, resp) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
    const fp = path.join(APP, rel);
    if (!fp.startsWith(APP) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { resp.writeHead(404); return resp.end('nf'); }
    resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    resp.end(fs.readFileSync(fp));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ permissions: [] });
  const page = await ctx.newPage();
  // mock ASR，让 asrText 能真跑完
  await page.route('**/api/asr**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '你好' }) }));
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });

  const a0 = await page.evaluate(() => ({
    open: window.FUNNEL && window.FUNNEL.open,
    ls: localStorage.getItem('sinoky-funnel'),
    hasBuildStatFunnel: /funnel/.test(String((window.buildStat && JSON.stringify(window.buildStat())) || '')),
  }));
  eq('A1 open 位在加载时置位', a0.open, 1);
  ok('A2 localStorage 已落盘：' + a0.ls, /"open":1/.test(a0.ls || ''));
  ok('A3 buildStat() 带 funnel 字段', a0.hasBuildStatFunnel);

  const a1 = await page.evaluate(() => {
    window.playToneAudio(window.TONES[0]);      // data URI，无需网络
    return { heard: window.FUNNEL.heard };
  });
  eq('A4 heard 钩子（playToneAudio 真播）', a1.heard, 1);

  const a2 = await page.evaluate(async () => {
    await window.asrText(new ArrayBuffer(16), '你好');
    return { spoke: window.FUNNEL.spoke };
  });
  eq('A5 spoke 钩子（asrText 收口）', a2.spoke, 1);

  const a3 = await page.evaluate(() => {
    window.renderScore({ overall: 1, verdict: 'ok', perSyll: [] });
    return { verified: window.FUNNEL.verified };
  });
  eq('A6 verified 钩子（renderScore）', a3.verified, 1);

  const a4 = await page.evaluate(() => {
    window.logErr('error', 'boom-test-123');
    return { n: window.ERRSTAT.n, last: window.ERRSTAT.last, ls: localStorage.getItem('sinoky-errstat') };
  });
  eq('A7 logErr 计数 +1', a4.n, 1);
  ok('A8 logErr 记下最近一条：' + a4.last, /boom-test-123/.test(a4.last || ''));
  ok('A9 错误计数落盘', /"n":1/.test(a4.ls || ''));

  const a5 = await page.evaluate(() => {
    const b = window.buildStat();
    return { funnel: b.funnel, err: b.err };
  });
  ok('A10 buildStat 带 funnel 四位', a5.funnel && a5.funnel.open === 1 && a5.funnel.verified === 1, JSON.stringify(a5.funnel));
  ok('A11 buildStat 带错误计数', a5.err && a5.err.n === 1, JSON.stringify(a5.err));

  // 持久化：重载后四个位仍在
  await page.reload({ waitUntil: 'load' });
  const a6 = await page.evaluate(() => window.FUNNEL);
  ok('A12 重载后漏斗四位全部保留（跨会话）：' + JSON.stringify(a6),
     a6.open === 1 && a6.heard === 1 && a6.spoke === 1 && a6.verified === 1);

  // A13：清空 localStorage 后再重载，只有 open 回来（其余不复活）—— 证明位不是每次都被无脑置位
  await page.evaluate(() => { localStorage.removeItem('sinoky-funnel'); });
  await page.reload({ waitUntil: 'load' });
  const a7 = await page.evaluate(() => window.FUNNEL);
  ok('A13 清空后重载只剩 open=1，其余为 0：' + JSON.stringify(a7),
     a7.open === 1 && a7.heard === 0 && a7.spoke === 0 && a7.verified === 0);

  await browser.close();
  srv.close();
}

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('──────────────────────────────');
process.exit(fail ? 1 : 0);
