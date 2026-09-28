#!/usr/bin/env node
/* audit_assets_refs.cjs —— assets/ 目录「被引用 vs 零引用」核对器
 *
 * 起因（2026-09-24）：build-web.mjs 对 assets 整目录 cp、无逐文件排除
 *   ⇒ 任何塞进 assets/ 的非产品文件都会自动上线（已实证：6 个 *_2x.webp
 *   + scenes/meeting.md 线上 200 可下，含内部规范库路径）。
 *   本工具的作用：在提交前把「零引用文件」暴露出来，人工判断该不该留在产品树。
 *
 * 用法：node _internal/tools/audit_assets_refs.cjs
 *      node _internal/tools/audit_assets_refs.cjs --root <sinoky-app 路径>
 *
 * 判据（三档，**宁可漏报不可误报**）：
 *   1) 完整文件名出现在产品树文本中                        → REF  (确定被引用)
 *   2) 命中「拼接表达式」：后缀形态（_256.webp）或**前缀形态**（assets/cities/thumb_）
 *                                                         → DYN  (疑似动态引用，人工确认)
 *   3) 只在**注释**里被点名（含通配，如 assets/tones/*.mp3）→ NOTE (可能有意预留，人工确认)
 *   4) 以上都不命中                                        → ZERO (疑似零引用，重点看)
 *
 * 🔴 2026-09-28 修正一处**会误导人删掉线上正在用的资源**的假阳性：
 *   原实现的形态判断只取文件名「末段」（stem.split(/[-_]/).pop()），
 *   于是 `assets/cities/thumb_beijing.webp` 取到末段 `beijing`，而代码里是**前缀式**
 *   拼接 `'assets/cities/thumb_' + sc.id + '.webp'` —— 前缀那半截根本没参与判断，
 *   ⇒ 18 个正在使用的城市缩略图被判成「零引用」。同因还把
 *   `scenes/thumbs/intro_1x1_1024.webp`（由 `SCENE_THUMB[sc.id]==='intro' ? '1024' : '512'`
 *   选中）判成零引用。照它删，城市列表与场景卡的图会整片 404 —— 而且每处都有
 *   `onerror` 兜底降级成图标，**现场不报错、只是图没了**，是最难查的那类回归。
 *   修法：额外抽取源码里以 `/` 或 `_` 结尾的 `assets/...` 字面量作为**前缀规则**，
 *   前缀命中即算 DYN。取向仍是「宁可漏报」—— 对「删除」这个动作而言，
 *   误报（说它被引用）远比漏报（说它零引用）安全。
 *
 * 注意：本脚本只读，不改动任何文件。
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const rIdx = argv.indexOf('--root');
const appRoot = rIdx >= 0 ? argv[rIdx + 1] : path.resolve(__dirname, '..', '..');

/* 不进产品的目录（与 build-web.mjs EXCLUDE 保持同口径） */
const SKIP_DIRS = new Set([
  '.git', '.github', 'node_modules', 'www', 'apk', 'apk-icons',
  'android', 'voice', '_internal', 'dist', '.wrangler',
]);
const TEXT_RE = /\.(html|js|mjs|cjs|json|css|webmanifest|txt|xml|md)$/i;

function walk(dir, hit, skip) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (skip(e.name)) continue;
      walk(path.join(dir, e.name), hit, skip);
    } else hit(path.join(dir, e.name));
  }
}

/* ---- 1. assets 下全部文件 ---- */
const assetsDir = path.join(appRoot, 'assets');
if (!fs.existsSync(assetsDir)) {
  console.error('[audit] assets/ 不存在：' + assetsDir);
  process.exit(1);
}
const assetFiles = [];
walk(assetsDir, (p) => assetFiles.push(p), () => false);

/* ---- 2. 产品树全部文本 ---- */
const texts = [];
walk(appRoot, (p) => {
  if (!TEXT_RE.test(p)) return;
  try { texts.push(fs.readFileSync(p, 'utf8')); } catch (e) { /* 二进制/权限：忽略 */ }
}, (n) => SKIP_DIRS.has(n));
const blob = texts.join('\n');

/* 拼接表达式的**前缀**规则：源码里以 `/` 或 `_` 结尾的 `assets/...` 字面量。
   例：'assets/cities/thumb_' + sc.id + '.webp'   ⇒ 前缀 'assets/cities/thumb_'
       'assets/scenes/thumbs/' + X + '_1x1_' + …  ⇒ 前缀 'assets/scenes/thumbs/'
   只收「以分隔符结尾」的字面量 —— 那是「后面还接着变量」的直接证据，
   避免把一条完整路径也当成前缀，把范围放得太宽。 */
const PREFIXES = new Set();
for (const m of blob.matchAll(/['"`]([^'"`\n]*assets\/[^'"`\n]*)['"`]/g)) {
  const lit = m[1];
  if (/[/_]/.test(lit.slice(-1))) PREFIXES.add(lit);
}

/* 注释里被点名的资产 ⇒ 单列 NOTE（**可能是有意预留**，仍需人工确认）。
   起因：assets/tones/tone{1..4}.mp3 长期被报「零引用」，但代码注释明写
   「这样新组可以用 assets/tones/*.mp3 文件」—— 那是**有意预留**，不是废弃。
   这类若一直混在 ZERO 里，每次审计都要人工重新判一遍：
   _internal/retired-assets-2026-09-24/README.md 就为此专门写了一节
   「刻意保留在 assets/ 的疑似零引用文件（勿误判为遗漏）」——
   **判断写进了文档，却没进工具，于是警报照旧**（文档腐化 + 工具不承载判断）。
   把判据固化到工具里才算修完。注释里的 * 当通配符（'assets/tones/*.mp3' 命中 tone1.mp3）。 */
const COMMENT_RE = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/[^\n]*/g;
const NOTE_RULES = [];
for (const cm of blob.matchAll(COMMENT_RE)) {
  for (const lm of cm[0].matchAll(/assets\/[A-Za-z0-9_./*-]+/g)) {
    const raw = lm[0].replace(/[.,;:)]+$/, '');
    NOTE_RULES.push({
      raw,
      re: new RegExp('^' + raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'),
    });
  }
}

/* ---- 3. 分类 ---- */
const REF = [], DYN = [], NOTE = [], ZERO = [];
for (const f of assetFiles) {
  const rel = path.relative(appRoot, f).replace(/\\/g, '/');
  const base = path.basename(f);
  const m = base.match(/^(.*?)((?:\.\d+x)?\.(?:webp|png|jpg|jpeg|svg|gif|mp3|wav|json|md|txt))$/i);
  const stem = m ? m[1] : base.replace(/\.[^.]+$/, '');
  const ext = m ? m[2] : path.extname(base);

  if (blob.includes(base) || blob.includes(rel)) { REF.push(rel); continue; }

  /* 动态拼接：如 assets/badges/{id}_256.webp → 代码里只有 '_256.webp' 字面量。
     策略：取 stem 的末段（最后一个 - 或 _ 之后）作为「形态标记」判断。 */
  const tail = stem.split(/[-_]/).pop();
  const shapeHit = blob.includes('_' + tail + ext) || blob.includes(tail + ext);
  if (shapeHit) { DYN.push({ rel, hint: '后缀 _' + tail + ext }); continue; }

  /* 前缀式拼接（见文件头 2026-09-28 修正）：thumb_<id>.webp、scenes/thumbs/<名>_1x1_<n>.webp
     这类是「前半截是字面量、后半截来自变量」，只查末段永远查不到。 */
  const preHit = [...PREFIXES].find((p) => rel.startsWith(p));
  if (preHit) { DYN.push({ rel, hint: '前缀 ' + preHit }); continue; }

  /* 注释点名过 ⇒ 可能是有意预留，单列出来人工确认（见文件头与 NOTE_RULES 说明） */
  const noteHit = NOTE_RULES.find((c) => c.re.test(rel));
  if (noteHit) { NOTE.push({ rel, size: fs.statSync(f).size, hint: noteHit.raw }); continue; }

  ZERO.push({ rel, size: fs.statSync(f).size });
}

/* ---- 4. 输出 ---- */
const line = (s) => console.log(s);
line('=== assets 引用审计 ===');
line('assets 文件总数 : ' + assetFiles.length);
line('产品树文本文件数: ' + texts.length);
line('');
line('[REF]  确定被引用                 : ' + REF.length);
line('[DYN]  动态拼接(人工确认)          : ' + DYN.length);
DYN.forEach((d) => line('        ' + d.rel + '   ← 形态 ' + d.hint));
line('[NOTE] 注释点名(可能有意预留)     : ' + NOTE.length);
NOTE.forEach((n) => line('        ' + n.rel + '   ← 注释提到 ' + n.hint));
line('[ZERO] 疑似零引用(重点看)          : ' + ZERO.length);
ZERO.sort((a, b) => b.size - a.size).forEach((z) => line('        ' + z.rel + '   ' + z.size + ' B'));
line('');
if (ZERO.length) {
  line('→ 处置原则（红线：assets 整目录上线）：');
  line('   该上线  → 必须被 index.html / sw.js / 产品代码静态或动态引用；');
  line('   不该上线→ 移出产品树（git mv 到 _internal/ 或资产区），再提交。');
} else {
  line('→ 无零引用文件。');
}
