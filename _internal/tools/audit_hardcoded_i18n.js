/* 硬编码界面文案审计（可复用工具）
 * ---------------------------------------------------------------------------
 * 为什么需要它：i18n 闸门（scripts/check-i18n.mjs）只校验 **T() 字面量**，
 *   因此「整段绕过 T() 直接写进 innerHTML / 提示气泡的文案」是**闸门盲区** ——
 *   对 es/ru/vi/id/th 用户等于英文（甚至中文）fallback，却永远不报警。
 *   本项目已实证两处：tourHtml() 的「New here?」整卡（~10 串）、
 *   VIEW_HINT 的 9 条诺诺提示（其中 6 条是中英混写）。
 *
 * 判据（v2，收紧过）——字符串字面量须**同时**满足：
 *   ① 含 CJK（U+4E00–U+9FFF）
 *   ② 含内联 HTML 标记（<b>/<br>/<span>/<i>）**或**出现在 UI 发射调用里
 *      （nonoHint( / toast( / innerHTML / textContent / .title= / alert( / tourHtml)
 *
 * §为什么收紧：v1 判据只要求「含 CJK」，实测命中 **917 行** —— 但本产品源码里
 *   大量中文是**教学内容本身**（要教的语言：场景句、菜名、地名、题库），
 *   它们语言无关、本就不该翻译。v1 的数字是**误导性的**，属「仪表在量别的东西」。
 *   加「含 HTML 标记」后，教学内容绝大多数被排除，剩下的基本都是面向全体的界面提示。
 * ⚠️⚠️ 定位：这是**人工复核清单**，不是闸门（不可接进 CI 判失败）。
 *   原因：判据无法区分两类中文 ——
 *     (a) **教学内容**（要教的语言本身）：如 `That was clear and natural — <b>说得很好！</b>`
 *         中文是学生该学会说的句子，对外语用户**理应**保持中文，不是缺陷；
 *     (b) **纯中文界面文案**：如声调订正标注 `应为`、限额芯片 `✅ 已解锁 · 不限次数`、
 *         导览标题 `诺诺带你认识` —— 这些外语用户读不懂，**是真缺陷**。
 *   两者在文本上同形，机器判不了，必须人看。
 *   ⇒ 结论：本工具负责「把 917 行的噪音压到 ~38 行候选」，人再从中挑 (b)。
 *   彻底的判据需「跨 6 语言渲染对比 + 内容白名单」，是**未解决的开问题**。
 *
 * 跑法：node _internal/tools/audit_hardcoded_i18n.js [--show]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(ROOT, 'index.html');
const SHOW = process.argv.includes('--show');

const src = fs.readFileSync(FILE, 'utf8');

/* 1. 剔掉注释与 <style>：按块清零，保留换行以维持行号 */
const blank = (s, re) => s.replace(re, m => m.replace(/[^\n]/g, ' '));
let code = src;
code = blank(code, /<!--[\s\S]*?-->/g);
code = blank(code, /\/\*[\s\S]*?\*\//g);
code = blank(code, /<style[\s\S]*?<\/style>/gi);
code = blank(code, /(^|[^:])\/\/[^\n]*/g);

const CJK = /[\u4e00-\u9fff]/;
const HTML_INLINE = /<\s*(b|br|span|i|em|strong)\b/i;
const UI_CALL = /(nonoHint\s*\(|toast\s*\(|innerHTML|textContent|\.title\s*=|alert\s*\(|tourHtml|VIEW_HINT)/;

const lines = code.split('\n');
const findings = [];
lines.forEach((ln, i) => {
  if (!CJK.test(ln)) return;
  const uiCtx = UI_CALL.test(ln);
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(ln))) {
    const s = m[1] !== undefined ? m[1] : m[2];
    if (!s || !CJK.test(s)) continue;
    if (!HTML_INLINE.test(s) && !uiCtx) continue;   /* 判据 ② */
    findings.push({ line: i + 1, text: s });
  }
});

const byLine = new Map();
findings.forEach(f => byLine.set(f.line, (byLine.get(f.line) || []).concat(f.text)));

console.log('─'.repeat(78));
console.log('硬编码界面文案审计（v2 收紧判据） — ' + path.relative(ROOT, FILE));
console.log('─'.repeat(78));
console.log('命中行数   : ' + byLine.size);
console.log('命中断片数 : ' + findings.length);

let hintN = 0, otherN = 0;
const other = [];
[...byLine.entries()].sort((a, b) => a[0] - b[0]).forEach(([ln, arr]) => {
  const raw = (lines[ln - 1] || '').trim();
  if (/pose:\s*'/.test(raw)) { hintN++; return; }
  otherN++;
  other.push({ line: ln, arr, raw });
});

console.log('\n【诺诺 view 提示表 VIEW_HINT】' + hintN + ' 行（已知债务：9 条 × 7 语言）');
console.log('\n【其它】' + otherN + ' 行');
other.forEach(it => {
  console.log('  L' + it.line + '  ' + it.raw.slice(0, 118));
  if (SHOW) it.arr.forEach(t => console.log('        · ' + t.slice(0, 104)));
});

console.log('\n' + '─'.repeat(78));
console.log('说明：只判「含 CJK 且带 HTML 标记或位于 UI 发射调用」的串。');
console.log('      纯英文硬编码需字典反查判定，不在本判据内。');
console.log('─'.repeat(78));
process.exit(0);
