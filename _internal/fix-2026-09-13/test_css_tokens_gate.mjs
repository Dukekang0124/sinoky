#!/usr/bin/env node
/**
 * test_css_tokens_gate.mjs —— 证明 `scripts/check-css-tokens.mjs` 真的会咬
 *
 * 为什么非要有这一层：本项目的教训是「**闸门必须被变异证明会咬，否则是假绿**」。
 * 一个永远 PASS 的闸门不但没用，还会让人以为这类问题被守住了。
 * 所以这里对闸门做 9 组变异 —— 6 组必须变红（证明有分辨力），
 * 3 组必须保持绿（证明不会误伤）：
 *   · 带 fallback 的未定义引用是**合法**的（fallback 是 CSS 变量的正当逃生舱）
 *   · 链接由 class 规则覆盖时，不要求存在裸 a 兜底
 *   · 未变异时基线必须是绿的
 *
 * 做法：把闸门需要的那 6 个文件复制到临时目录，在副本上做变异，
 * 用 `--root=<临时目录>` 跑闸门，读 exit code + stdout。
 * ⚠️ 不碰仓库真文件 —— 变异跑在副本上，跑完即弃。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const NODE = process.execPath;
const GATE = path.join(APP, 'scripts', 'check-css-tokens.mjs');

const FILES = [
  'index.html', 'stats.html', 'download.html', 'credits.html',
  '_internal/nono-ip-v1/patch.css', '_internal/nono-ip-v1/patch.js',
];

const TMP = path.join(HERE, 'tmp', 'csstokens-gate');
const rebuild = () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const rel of FILES) {
    const src = path.join(APP, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(TMP, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
};

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✅ ' + m); };
const no = (m) => { fail++; console.log('  ❌ ' + m); };

/** 在副本目录上跑闸门，返回 {code, out} */
function runGate() {
  const r = spawnSync(NODE, [GATE, '--root=' + TMP], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** 对副本里的某个文件做一次整体替换（改完必须 restore() 还原） */
function mutate(rel, from, to, expectHits = 1) {
  const fp = path.join(TMP, rel);
  const s = fs.readFileSync(fp, 'utf8');
  const n = s.split(from).length - 1;
  if (n !== expectHits) throw new Error('变异锚点 ' + JSON.stringify(from.slice(0, 60)) + ' 在 ' + rel + ' 命中 ' + n + ' 次（期望 ' + expectHits + '）');
  fs.writeFileSync(fp, s.replace(from, to));
}
const restore = (rel) => fs.copyFileSync(path.join(APP, rel), path.join(TMP, rel));

rebuild();
console.log('CSS 令牌闸门 · 变异验证（在副本 %s 上跑）\n', path.relative(APP, TMP));

const BARE_RULE = 'a{color:var(--teal)}a:visited{color:var(--teal)}';

// ── M0 阴性对照：未变异的副本必须 PASS ────────────────────────────────
{
  const { code, out } = runGate();
  code === 0 ? ok('M0 未变异 ⇒ 闸门 PASS（基线成立，否则后面全是伪差异）')
             : no('M0 未变异就已经失败 ⇒ 闸门本身有问题（rc=' + code + '）' + out.slice(-300));
}

// ── M1 复现康哥报的那个 bug：把 .rv-en 改回 var(--fg) ────────────────
{
  mutate('index.html', '.rv-en{display:block;font-size:15px;font-weight:700;color:var(--txt)',
                         '.rv-en{display:block;font-size:15px;font-weight:700;color:var(--fg)');
  const { code, out } = runGate();
  if (code !== 0 && /--fg/.test(out) && /L\d+/.test(out)) ok('M1 把 .rv-en 改回 var(--fg) ⇒ 闸门失败并点名 --fg（复现原缺陷）');
  else no('M1 变异后闸门仍 PASS ⇒ 咬不住原缺陷（rc=' + code + '）');
  restore('index.html');
}

// ── M2 片段域：patch.css 里引入一个 index.html 没有的变量 ─────────────
{
  mutate('_internal/nono-ip-v1/patch.css', 'color:var(--txt); font-size:12.5px;', 'color:var(--brand-ink); font-size:12.5px;');
  const { code, out } = runGate();
  if (code !== 0 && /--brand-ink/.test(out) && /patch\.css/.test(out)) ok('M2 片段（patch.css）引用未定义变量 ⇒ 闸门失败（片段按宿主定义域判，不当假阳性放过）');
  else no('M2 片段域未咬住（rc=' + code + '）' + out.slice(-260));
  restore('_internal/nono-ip-v1/patch.css');
}

// ── M3 删掉一个 :root 定义（模拟改名/误删）⇒ 应引发大面积失败 ──────────
{
  mutate('index.html', '--red:#e63946; --teal:#8ab8b2;', '--redX:#e63946; --teal:#8ab8b2;');
  const { code, out } = runGate();
  const hits = (out.match(/引用了未定义的 --red\b/g) || []).length;
  if (code !== 0 && hits >= 5) ok('M3 删掉 --red 定义 ⇒ 闸门失败并报出 ' + hits + ' 处引用（改名/误删会被抓住）');
  else no('M3 未咬住（rc=' + code + '，命中 ' + hits + ' 处）');
  restore('index.html');
}

// ── M4 阴性对照（不许误伤）：带 fallback 的未定义引用必须 PASS ────────
{
  mutate('index.html', '.rv-hz{display:block;', '.rv-hz{color:var(--not-a-real-token,var(--teal));display:block;');
  const { code, out } = runGate();
  code === 0 ? ok('M4 带 fallback 的未定义引用 ⇒ 闸门仍 PASS（fallback 是合法逃生舱，不误伤）')
             : no('M4 误伤：带 fallback 也被判失败（rc=' + code + '）' + out.slice(-200));
  restore('index.html');
}

// ── M5 独立页面自有定义域：credits.html 引用未定义变量 ⇒ 应失败 ────────
{
  mutate('credits.html', '<style>', '<style>:root{--x:1}.bad{color:var(--nope)}');
  const { code, out } = runGate();
  if (code !== 0 && /--nope/.test(out) && /credits\.html/.test(out)) ok('M5 独立页面 credits.html 引用未定义变量 ⇒ 闸门失败（页面自成定义域，不借用 index.html）');
  else no('M5 未咬住（rc=' + code + '）' + out.slice(-260));
  restore('credits.html');
}

// ── M6 复现「裸 <a> 掉到 UA 默认色」：删掉兜底规则 ⇒ 应失败 ────────────
{
  mutate('index.html', '\n' + BARE_RULE, '');
  const { code, out } = runGate();
  if (code !== 0 && /#0000EE/.test(out) && /privacy\.html/.test(out)) ok('M6 删掉裸 a 兜底色 ⇒ 闸门失败并点名页脚 Privacy / Share（复现 1.86:1 那处）');
  else no('M6 未咬住（rc=' + code + '）' + out.slice(-260));
  restore('index.html');
}

// ── M7 兜底色本身不可读：改成与页面底色同色 ⇒ 应失败（证明真在算对比度）──
{
  mutate('index.html', BARE_RULE, 'a{color:var(--bg)}a:visited{color:var(--bg)}');
  const { code, out } = runGate();
  if (code !== 0 && /需 ≥4\.5/.test(out)) ok('M7 兜底色改成与底色同色（1:1）⇒ 闸门失败（C 段真在算对比度，不是只看"有没有规则"）');
  else no('M7 未咬住（rc=' + code + '）' + out.slice(-260));
  restore('index.html');
}

// ── M8 阴性对照（不许误伤）：<a class="dl"> 由 class 规则覆盖 ⇒ 不该强求裸 a 兜底 ──
{
  const { code, out } = runGate();
  if (code === 0 && /download\.html 的 <a> 都由行内色或 class 规则覆盖/.test(out)) ok('M8 <a class="dl"> 由 .dl{color:#fff} 覆盖 ⇒ 不强求裸 a 兜底（不误伤）');
  else no('M8 误伤或未覆盖（rc=' + code + '）' + (out.match(/.*download\.html.*/) || [''])[0]);
}

rebuild();
fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
