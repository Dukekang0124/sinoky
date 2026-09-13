// test_metrics.mjs —— v0.23.8 组 1 行为验收（审计 P0-2 MAU + P0-3 自测标记）
//
// 为什么不能只做静态检查：MAU 窗口边界（t-6 / t-7）与「自测剔除」是纯算术逻辑，
// grep 只能证明代码在，不能证明算对。所以把 _worker.js 变成可 import 的模块，
// mock 一个内存 KV，造 7 个用户跑真数据。
//
// 造数（t = 今天）：
//   1 real1 : days[t, t-5]   src=real   phrases20 tone5 day1✅
//   2 real2 : days[t-10]     src=real   phrases0
//   3 real3 : days[t-1]      无 src     phrases3        ← 老数据必须按 real 算
//   4 test1 : days[t, t-2]   src=test   phrases99 tone99 day1✅
//   5 old   : days[t-40]     src=real   phrases7
//   6 edge7 : days[t-6]      src=real   phrases1        ← 7 天窗口最内边界（应算 MAU7）
//   7 edge8 : days[t-7]      src=real   phrases1        ← 7 天窗口外一格（不该算 MAU7）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const DAY = 86400000;
const t = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \u2705 ' + name); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
};
const eq = (name, a, b) => ok(name, a === b, '\u671f\u671b ' + JSON.stringify(b) + ' \u5b9e\u5f97 ' + JSON.stringify(a));

// ── 1. 把 _worker.js 变成可 import 的测试版
let src = fs.readFileSync(path.join(APP, '_worker.js'), 'utf8');
const IMP = "import { handleBadgeApi } from './badge-backend.mjs';";
if (!src.includes(IMP)) { console.error('\u274c \u672a\u627e\u5230 badge import\uff0c\u65e0\u6cd5\u6784\u9020\u6d4b\u8bd5\u6a21\u5757'); process.exit(1); }
src = src.replace(IMP, 'const handleBadgeApi = async () => null;');
src += '\nexport { summarizeStats, recordStat };\n';
const tmp = path.join(HERE, '_worker_testable.mjs');
fs.writeFileSync(tmp, src);
const { summarizeStats, recordStat } = await import('file:///' + tmp.replace(/\\/g, '/'));

// ── 2. mock KV
function mkKV(seed) {
  const store = new Map(seed || []);
  return {
    _store: store,
    async list({ prefix }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
  };
}
const putUser = (kv, uid, o) => kv._store.set('s:' + uid, JSON.stringify(o));
const env = { PROFILES: mkKV() };
const U = {
  real1: { src: 'real', first: Date.now() - 10 * DAY, days: [t(0), t(5)], phrases: 20, tone: 5, day1Done: true, scenes: {}, feat: {} },
  real2: { src: 'real', first: Date.now() - 10 * DAY, days: [t(10)], phrases: 0, scenes: {}, feat: {} },
  real3: { first: Date.now() - 2 * DAY, days: [t(1)], phrases: 3, scenes: {}, feat: {} },   // 无 src
  test1: { src: 'test', first: Date.now() - 20 * DAY, days: [t(0), t(2)], phrases: 99, tone: 99, day1Done: true, scenes: {}, feat: {} },
  old: { src: 'real', first: Date.now() - 60 * DAY, days: [t(40)], phrases: 7, scenes: {}, feat: {} },
  edge7: { src: 'real', first: Date.now() - DAY, days: [t(6)], phrases: 1, scenes: {}, feat: {} },
  edge8: { src: 'real', first: Date.now() - DAY, days: [t(7)], phrases: 1, scenes: {}, feat: {} },
};
for (const k in U) putUser(env.PROFILES, k, U[k]);

console.log('\n=== A. summarizeStats\uff1aMAU \u7a97\u53e3 + \u771f\u5b9e\u53e3\u5f84 ===');
const S = await summarizeStats(env);

eq('A1 users \u603b\u6570', S.users, 7);
eq('A2 usersReal\uff08\u6392\u9664\u81ea\u6d4b\uff09', S.real.users, 6);
eq('A3 usersTest', S.real.test, 1);
eq('A4 \u65e0 src \u7684\u8001\u6570\u636e\u6309 real \u7b97', S.real.users + S.real.test, 7);
eq('A5 dau', S.dau, 2);
eq('A6 dauReal', S.real.dau, 1);
eq('A7 mau7\uff08t-6 \u7b97\u8fdb\u53bb\u3001t-7 \u7b97\u4e0d\u8fdb\u53bb\uff09', S.mau7, 4);
eq('A8 mau7Real', S.real.mau7, 3);
eq('A9 mau30\uff08t-29 \u5185\uff0ct-40 \u7b97\u4e0d\u8fdb\u53bb\uff09', S.mau30, 6);
eq('A10 mau30Real', S.real.mau30, 5);
eq('A11 phraseSum \u542b\u81ea\u6d4b', S.phraseSum, 131);
eq('A12 real.phrasesPerUser\uff08\u5254\u6389 99 \u53e5\u81ea\u6d4b\uff09', S.real.phrasesPerUser, 5.3);
eq('A13 day1DoneRate \u5168\u91cf', S.day1DoneRate, 28.6);
eq('A14 real.day1DoneRate', S.real.day1DoneRate, 16.7);
eq('A15 real.toneUsageRate', S.real.toneUsageRate, 16.7);
ok('A16 mau7 <= mau30 \u4e14 mau30 <= users', S.mau7 <= S.mau30 && S.mau30 <= S.users, `${S.mau7}/${S.mau30}/${S.users}`);
ok('A17 \u65e7\u5b57\u6bb5\u672a\u88ab\u7834\u574f\uff08retention/northStar/gate \u4ecd\u5728\uff09',
  !!S.retention && !!S.northStar && !!S.gate && S.northStar.target === 10);
ok('A18 real \u5b57\u6bb5\u5e26 note', typeof S.real.note === 'string' && S.real.note.length > 0);

// ── B. recordStat\uff1asrc \u8bb0\u5f55\u4e0e\u4e0d\u53ef\u9006
console.log('\n=== B. recordStat\uff1asrc \u4e0d\u53ef\u9006 ===');
const kV = mkKV();
const envB = { PROFILES: kV };
await recordStat(envB, 'n1', { phrases: 5, src: 'test' });
let r = JSON.parse(kV._store.get('s:n1'));
eq('B1 \u9996\u6b21\u4e0a\u62a5 test \u2192 src=test', r.src, 'test');

await recordStat(envB, 'n1', { phrases: 5, src: 'real' });
r = JSON.parse(kV._store.get('s:n1'));
eq('B2 test \u540e\u62a5 real \u4ecd\u4e3a test\uff08\u4e0d\u53ef\u9006\uff09', r.src, 'test');

await recordStat(envB, 'n2', { phrases: 3 });
r = JSON.parse(kV._store.get('s:n2'));
eq('B3 \u65e0 src \u2192 \u9ed8\u8ba4 real', r.src, 'real');

await recordStat(envB, 'n3', { phrases: 1, src: 'real' });
await recordStat(envB, 'n3', { phrases: 1, src: 'test' });
r = JSON.parse(kV._store.get('s:n3'));
eq('B4 real \u540e\u62a5 test \u2192 \u5347\u7ea7\u4e3a test', r.src, 'test');

// B5 \u5e42\u7b49\uff1a\u540c\u6837\u62a5\u6587\u4e0d\u91cd\u5199
const before = kV._store.get('s:n2');
await recordStat(envB, 'n2', { phrases: 3 });
eq('B5 \u65e0\u53d8\u5316\u4e0d\u91cd\u5199\uff08\u5199\u5165\u8282\u6d41\u4ecd\u751f\u6548\uff09', kV._store.get('s:n2'), before);

// ── C. \u517c\u5bb9\uff1a\u65e7\u8bb0\u5f55\uff08\u65e0 mau/src \u5b57\u6bb5\uff09\u4e0d\u5d29
console.log('\n=== C. \u540e\u5411\u517c\u5bb9 ===');
const envC = { PROFILES: mkKV() };
putUser(envC.PROFILES, 'legacy', { first: Date.now() - 5 * DAY, days: [t(1)], phrases: 4, scenes: {}, feat: {} });
const SC = await summarizeStats(envC);
ok('C1 \u65e7\u8bb0\u5f55\uff08\u65e0 src\uff09\u4e0d\u5d29\u4e14\u8ba1\u5165 real', SC.users === 1 && SC.real.users === 1, JSON.stringify(SC.real));
ok('C2 \u65e7\u8bb0\u5f55 MAU \u6b63\u5e38', SC.mau30 === 1 && SC.mau7 === 1, `${SC.mau7}/${SC.mau30}`);

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log('\u7ed3\u679c\uff1a' + pass + ' \u901a\u8fc7 / ' + fail + ' \u5931\u8d25');
console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
process.exit(fail ? 1 : 0);
