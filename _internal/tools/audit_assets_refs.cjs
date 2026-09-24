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
 * 判据（三档，宁可漏报不可误报）：
 *   1) 完整文件名出现在产品树文本中         → REF  (确定被引用)
 *   2) 文件名的「后缀模式」出现（如 _256.webp 配合 d.id 动态拼接） → DYN (动态引用，人工确认)
 *   3) 名字的任意可辨识片段都没出现          → ZERO (疑似零引用，重点看)
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

/* ---- 3. 分类 ---- */
const REF = [], DYN = [], ZERO = [];
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
  if (shapeHit) { DYN.push({ rel, hint: '_' + tail + ext }); continue; }

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
