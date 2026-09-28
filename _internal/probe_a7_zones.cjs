/* probe_a7_zones.cjs —— A7（城市任务区数字逐城对账）的**外部干预验证**工具
 *
 * 为什么需要它（与 check_site 里内建的 auditZoneSelfTest 是两件事）：
 *   · 内建自测证明的是「判据函数对**字符串**敏感」；
 *   · 这个工具证明的是「**文件**被改坏时闸门真的会失败」—— 还要覆盖两件自测覆盖不到的：
 *       ① 文件读取 → 文本提取（visibleText / zhAttrs）这条链路真的把该文本喂给了判据
 *          （实测踩过：spread 字符串导致英文侧整体失明，自测完全正常但文件层面漏检）
 *       ② 失败真的计入 fail 并影响退出码
 *   只看自测就宣称"闸门有效"，属于把验证推给一个不覆盖真实链路的代理指标。
 *
 * 为什么不做「一条命令全自动跑完三步」：那需要 fork 子进程执行 check_site，而本沙箱
 *   不允许 node fork（execSync/execFileSync 报 EBUSY）。审计纪律：别把闸门建立在
 *   spawn 上 —— 环境一变整条验证链就成盲区，而人只会以为"工具坏了"。故保持手动三步。
 *
 * 用法（三步，顺序固定；每步都看输出，别跳）：
 *   node _internal/probe_a7_zones.cjs break-each     # 只改「无单位」那一处（最易漏检形态）
 *   node _internal/check_site.cjs --static-only      # 期望：A7 失败，点名 features.html
 *   node _internal/probe_a7_zones.cjs restore        # 还原（务必执行，别让工作区留在改坏态）
 *   node _internal/check_site.cjs --static-only      # 期望：8 项全过
 *   （把 break-each 换成 break 可做更粗的"整段改错"版验证：期望 8 条失败）
 */
const fs = require('fs');
const path = require('path');

const F = path.join(__dirname, '..', 'landing', 'features.html');
const MODE = process.argv[2];

/* 正确 → 错误 的替换对。左侧串必须与当前线上文案**逐字**相同，否则命中数会是 0，
   脚本会拒绝执行 —— 因为「命中 0 还继续」等于什么都没验证却打印成功。 */
const ALL = [
  ['北京与成都各有 4 个任务区', '北京与成都各有 9 个任务区'],
  ['Beijing and Chengdu have four zones each', 'Beijing and Chengdu have nine zones each'],
  ['北京与成都各 4 个', '北京与成都各 9 个'],
  ['Beijing and Chengdu 4 each', 'Beijing and Chengdu 9 each'],
];
/* 只改「表格后半句」——它没有 `zones` 单位词，是 A7 第一版**真正漏检**的形态。 */
const EACH_ONLY = [['Beijing and Chengdu 4 each', 'Beijing and Chengdu 9 each']];

const PAIRS = { break: ALL, 'break-each': EACH_ONLY, restore: ALL }[MODE];
if (!PAIRS) {
  console.error('用法：node _internal/probe_a7_zones.cjs <break|break-each|restore>');
  process.exit(2);
}

let s = fs.readFileSync(F, 'utf8');
let hit = 0;
for (const [good, bad] of PAIRS) {
  const [from, to] = MODE === 'restore' ? [bad, good] : [good, bad];
  const n = s.split(from).length - 1;
  /* 注入模式：每处必须**恰好**命中 1 次。
     命中 0 = 没改到任何东西（验证是假的）；命中 > 1 = 该串在多处出现，只改一处不足以证明。
     还原模式：只还原真正处于错误态的那几处（其余跳过），总数必须 ≥ 1。 */
  if (MODE !== 'restore' && n !== 1) { console.error(`✗ 命中数 ${n} ≠ 1：${from}`); process.exit(2); }
  if (MODE === 'restore' && n > 1) { console.error(`✗ 还原命中数 ${n} > 1：${bad}`); process.exit(2); }
  if (!n) continue;
  s = s.replace(from, to);
  hit += n;
}
if (!hit) {
  console.error(MODE === 'restore'
    ? '✗ 还原命中 0 处 —— 文件本来就没被改错？拒绝写回（防止把"以为还原了"当成已还原）。'
    : '✗ 注入命中 0 处 —— 文案已变，请同步更新本工具的替换对。');
  process.exit(2);
}
fs.writeFileSync(F, s);
console.log(`${MODE}：已改写 ${hit} 处 —— ${MODE === 'restore' ? '记得跑 check_site --static-only 确认 8 项全过' : '现在跑 check_site --static-only，期望 A7 失败'}`);
