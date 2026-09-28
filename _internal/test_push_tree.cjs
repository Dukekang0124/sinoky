/* v0.28.0 推送分段决策树 —— 纯 Node 单测（不需要部署、不需要 KV、不碰生产）
 *
 * 为什么这么做：`decidePush()` 是**服务端**逻辑，但它决定了「哪个人被打扰、哪个人不被打扰」，
 * 是这个版本最该被验证的一段。Pages Functions 没法在本地起（依赖 KV/VAPID 绑定），
 * 所以从 `_worker.js` 源码里**按锚点抽出**这一段求值 —— 测的是真源码，不是副本。
 *
 * 用法：node _internal/test_push_tree.cjs
 */
const fs = require('fs');
const path = require('path');

const WORKER = path.join(__dirname, '..', '_worker.js');
const src = fs.readFileSync(WORKER, 'utf8');
const A = src.indexOf('const PUSH_TXT = {');
const B = src.indexOf('/* ===== v0.3.23 安全加固');
if (A < 0 || B < 0 || B <= A) { console.error('❌ 抽不出决策树代码段（锚点变了？）'); process.exit(1); }
const mod = new Function(src.slice(A, B) + '\nreturn { PUSH_TXT, decidePush, pushDay, dateIdx, dayIdx, TRIP_KEEP_DAYS, tripEndIdx, tripStale, purgeTrip };')();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};
const eq = (name, got, want) => ok(name, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

/* ---- 夹具 ---- */
const TZ = 8;
const localDay = (offsetDays) => new Date(Date.now() + TZ * 3600e3 + (offsetDays || 0) * 86400e3).toISOString().slice(0, 10);
function snap(over) {
  return Object.assign({
    tz: TZ, at: Date.now(), pur: 'travel', city: '上海', cityId: 'shanghai', cityEn: 'Shanghai',
    arrive: '', days: 6, streak: 0, due: 0, weakTop: '', lang: 'en', lastDone: ''
  }, over || {});
}
const rec = (over) => ({ uid: 'u1', sub: { endpoint: 'https://push.example/x' }, at: Date.now(), p: snap(over) });
const bare = () => ({ uid: 'u1', sub: { endpoint: 'https://push.example/x' }, at: Date.now() });

console.log('\n=== ① 代码段抽取 ===');
ok('PUSH_TXT / decidePush / pushDay / dateIdx / dayIdx 全部就位',
   typeof mod.PUSH_TXT === 'object' && typeof mod.decidePush === 'function' &&
   typeof mod.pushDay === 'function' && typeof mod.dateIdx === 'function' && typeof mod.dayIdx === 'function');

console.log('\n=== ② D 分支：其余 → SKIP（本机制能活下来的前提）===');
eq('老客户端（只发 uid+sub，无快照）→ skip', mod.decidePush(bare()).kind, 'skip');
eq('全无触发（无行程/无连胜/无到期）→ skip', mod.decidePush(rec({ streak: 0, due: 0 })).kind, 'skip');
eq('连胜 2（未达阈值 3）→ skip', mod.decidePush(rec({ streak: 2 })).kind, 'skip');
eq('到期 0 → skip', mod.decidePush(rec({ due: 0 })).kind, 'skip');
eq('skip 带 reason=no-trigger', mod.decidePush(rec({})).why, 'no-trigger');

console.log('\n=== ③ A 分支：行程 T-1 / 当天（最高价值）===');
const rA = mod.decidePush(rec({ arrive: localDay(1), city: '上海', cityId: 'shanghai' }));
eq('明天到 → kind=trip', rA.kind, 'trip');
ok('深链含 ?go=trip&city=shanghai&set=10', rA.url === './index.html?go=trip&city=shanghai&set=10', rA.url);
ok('英文文案用罗马化城市名（不得出现中文）', /Shanghai/.test(rA.title) && !/[\u4e00-\u9fa5]/.test(rA.title), rA.title);
ok('正文点明「练这 10 句」', /10 lines/.test(rA.body), rA.body);
const rA0 = mod.decidePush(rec({ arrive: localDay(0), city: '北京', cityId: 'beijing' }));
eq('今天到 → kind=trip', rA0.kind, 'trip');
ok('今天到的文案与明天不同', rA0.title !== rA.title, rA0.title);
ok('今天到深链指向 beijing', /city=beijing/.test(rA0.url), rA0.url);

console.log('\n=== ④ A 分支的边界（不能乱推）===');
eq('T-2 → 不命中 trip', mod.decidePush(rec({ arrive: localDay(2) })).kind, 'skip');
eq('T-7 → 不命中 trip', mod.decidePush(rec({ arrive: localDay(7) })).kind, 'skip');
eq('已过期（昨天到）→ 不命中 trip', mod.decidePush(rec({ arrive: localDay(-1) })).kind, 'skip');
eq('有日期但 cityId 为空 → 不命中（防拼出坏深链）', mod.decidePush(rec({ arrive: localDay(1), cityId: '' })).kind, 'skip');
eq('有日期但 city 为空 → 不命中', mod.decidePush(rec({ arrive: localDay(1), city: '' })).kind, 'skip');

console.log('\n=== ⑤ B 分支：连胜将断 ===');
const rB = mod.decidePush(rec({ streak: 12, due: 0 }));
eq('streak=12 且今天未开口 → kind=streak', rB.kind, 'streak');
ok('文案带连胜天数', /12/.test(rB.title), rB.title);
eq('连胜走首页（首页有主动卡接住）', rB.url, './index.html');
eq('streak=3 且今天已开口 → 不推', mod.decidePush(rec({ streak: 3, lastDone: mod.pushDay() })).kind, 'skip');
eq('streak=12 且今天已开口 → 不推', mod.decidePush(rec({ streak: 12, lastDone: mod.pushDay() })).kind, 'skip');

console.log('\n=== ⑥ C 分支：到期复习 ===');
const rC = mod.decidePush(rec({ streak: 0, due: 8 }));
eq('due=8 且今天未开口 → kind=due', rC.kind, 'due');
ok('深链含 ?go=review', rC.url.indexOf('go=review') > -1, rC.url);
ok('文案带到期句数', /8/.test(rC.title), rC.title);
eq('due=8 但今天已开口 → 不推', mod.decidePush(rec({ due: 8, lastDone: mod.pushDay() })).kind, 'skip');

console.log('\n=== ⑦ 优先级：A > B > C > D（与前端 PRO.decide() 同顺序）===');
eq('行程 + 连胜 + 到期 同时命中 → A(trip)',
   mod.decidePush(rec({ arrive: localDay(1), streak: 12, due: 8 })).kind, 'trip');
eq('连胜 + 到期 同时命中 → B(streak)',
   mod.decidePush(rec({ streak: 12, due: 8 })).kind, 'streak');
eq('行程 T-2 + 连胜 → 落到 B(streak)',
   mod.decidePush(rec({ arrive: localDay(2), streak: 12 })).kind, 'streak');

console.log('\n=== ⑧ 流失保护（防卸载）===');
eq('快照 8 天前没动 → skip(dormant)',
   mod.decidePush(rec({ at: Date.now() - 8 * 86400e3, arrive: localDay(1), streak: 12, due: 8 })).why, 'dormant');
eq('快照 6 天前 → 不被 dormant 拦（仍按分支走）',
   mod.decidePush(rec({ at: Date.now() - 6 * 86400e3, arrive: localDay(1) })).kind, 'trip');
eq('快照 7 天整 → 不拦（边界 >7 才拦）',
   mod.decidePush(rec({ at: Date.now() - 7 * 86400e3 - 3600e3, arrive: localDay(1) })).kind, 'trip');

console.log('\n=== ⑨ 时区正确性（「明天」必须是用户本地的明天）===');
for (const tz of [-8, -5, 0, 1, 5, 8, 12]) {
  const d = new Date(Date.now() + tz * 3600e3 + 86400e3).toISOString().slice(0, 10);
  const r = mod.decidePush(rec({ tz: tz, arrive: d }));
  eq('tz=' + tz + ' 的本地明天 → trip', r.kind, 'trip');
}
for (const tz of [-8, 8, 12]) {
  const d = new Date(Date.now() + tz * 3600e3 + 2 * 86400e3).toISOString().slice(0, 10);
  eq('tz=' + tz + ' 的本地后天 → 不推', mod.decidePush(rec({ tz: tz, arrive: d })).kind, 'skip');
}

console.log('\n=== ⑩ 多语言文案 ===');
const zh = mod.decidePush(rec({ lang: 'zh', arrive: localDay(1), city: '上海', cityId: 'shanghai' }));
ok('zh → 中文标题', /上海/.test(zh.title), zh.title);
ok('zh → 中文正文', /10 句/.test(zh.body), zh.body);
const zhS = mod.decidePush(rec({ lang: 'zh', streak: 5 }));
ok('zh 连胜文案是中文', /连胜/.test(zhS.title), zhS.title);
const es = mod.decidePush(rec({ lang: 'es', streak: 5 }));
ok('es（未覆盖）→ 回退英文', /streak/.test(es.title), es.title);

console.log('\n=== ⑪ 日期口径（幂等与前端 today() 同口径）===');
ok('pushDay() = UTC 日串', /^\d{4}-\d{2}-\d{2}$/.test(mod.pushDay()) && mod.pushDay() === new Date().toISOString().slice(0, 10), mod.pushDay());
ok('dateIdx 单调递增', mod.dateIdx('2026-10-01') - mod.dateIdx('2026-09-30') === 1);
ok('dateIdx 跨月正确', mod.dateIdx('2026-10-01') - mod.dateIdx('2026-09-01') === 30);
ok('dateIdx 跨年正确', mod.dateIdx('2027-01-01') - mod.dateIdx('2026-12-31') === 1);
ok('dateIdx 非法输入返回 null', mod.dateIdx('not-a-date') === null);
ok('dayIdx(tz=8) 与 dayIdx(tz=-8) 同日可差 1 以内（不越界）',
   Math.abs(mod.dayIdx(undefined, 8) - mod.dayIdx(undefined, -8)) <= 1);

console.log('\n=== ⑫ 行程隐私清理（v0.29.2 · 方案 §5.5 选项 B 严格对齐）===');
/* 口径自证：localDay(0) 的 dateIdx 恰等于 dayIdx(now, 8) —— 与 snap() 默认 tz=8 同源，
   所以下面这些「距今天数」的断言是**确定**的，不随运行时刻漂移。 */
ok('口径自证：dateIdx(localDay(0)) === dayIdx(now, 8)',
   mod.dateIdx(localDay(0)) === mod.dayIdx(Date.now(), TZ));
ok('TRIP_KEEP_DAYS = 7（方案原文「行程结束后 7 天」）', mod.TRIP_KEEP_DAYS === 7);

/* —— 不该清的：行程期间 + 结束后 7 天内（清早了 = 用户行程还没走完就丢数据）—— */
const stale = (over) => mod.tripStale(rec(over), Date.now());
eq('今天出发、停留 6 天 → 不清', stale({ arrive: localDay(0), days: 6 }), false);
eq('行程最后一天（到访 5 天前、停留 6 天）→ 不清', stale({ arrive: localDay(-5), days: 6 }), false);
eq('行程结束当天 → 不清', stale({ arrive: localDay(-6), days: 6 }), false);
eq('行程结束第 6 天 → 不清（差 1 天）', stale({ arrive: localDay(-12), days: 6 }), false);
eq('已清过（arrive 为空）→ 不清（幂等）', stale({ arrive: '' }), false);
eq('老客户端（无 p 快照）→ 不清', mod.tripStale(bare(), Date.now()), false);
eq('days 缺失按 1 天算：离开日 +6 天 → 不清', stale({ arrive: localDay(-7), days: 0 }), false);

/* —— 该清的：行程结束后 ≥ 7 天 —— */
eq('行程结束第 7 天 → 清', stale({ arrive: localDay(-13), days: 6 }), true);
eq('行程结束第 30 天 → 清', stale({ arrive: localDay(-36), days: 6 }), true);
eq('days 缺失按 1 天算：离开日 +7 天 → 清', stale({ arrive: localDay(-8), days: 0 }), true);
eq('日期串不可解析 → 清（无保留价值）', stale({ arrive: 'not-a-date' }), true);

/* —— tz 参与计算：+14 与 -12 的「本地今天」最多差 1 天 ⇒ 翻转点最多差 1 —— */
const flipOf = (tz) => { for (let k = 0; k < 40; k++) { if (mod.tripStale(rec({ tz: tz, arrive: localDay(-k), days: 6 }), Date.now())) return k; } return -1; };
const fA = flipOf(14), fB = flipOf(-12);
ok('tz 参与判定（+14 / -12 的翻转点相差 ≤ 1 天）', fA > 0 && fB > 0 && Math.abs(fA - fB) <= 1, 'flip +14=' + fA + ' / -12=' + fB);

/* —— purgeTrip：只清行程五字段，别的都不许动 —— */
const r1 = rec({ arrive: localDay(-30), days: 6, streak: 9, due: 4 });
eq('purgeTrip 返回 true（确实有变更）', mod.purgeTrip(r1), true);
ok('行程五字段全被抹掉',
   !r1.p.arrive && !r1.p.city && !r1.p.cityId && !r1.p.cityEn && !r1.p.days,
   JSON.stringify(r1.p));
ok('订阅本体与 B/C 所需字段原封不动',
   !!(r1.sub && r1.sub.endpoint) && r1.p.streak === 9 && r1.p.due === 4 && r1.p.tz === TZ && !!(r1.p.lang && r1.p.pur));
eq('purgeTrip 二次调用返回 false（幂等，不会反复写 KV）', mod.purgeTrip(r1), false);
eq('清理后 tripStale 恒 false（该条记录不会再触发写）', mod.tripStale(r1, Date.now()), false);
eq('清理后决策树照常走 B（连胜不受影响）', mod.decidePush(r1).kind, 'streak');
const r1c = rec({ arrive: localDay(-30), days: 6, due: 4 }); mod.purgeTrip(r1c);
eq('清理后（无行程）due=4 → C(due)', mod.decidePush(r1c).kind, 'due');
eq('老客户端（无 p）purgeTrip 返回 false', mod.purgeTrip(bare()), false);

console.log('\n──────────────────────────────────────────────');
console.log((fail === 0 ? '✅ 决策树单测全绿' : '❌ 决策树单测有失败') + ' — ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('──────────────────────────────────────────────\n');
process.exit(fail === 0 ? 0 : 1);
