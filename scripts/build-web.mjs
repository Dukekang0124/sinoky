// 把"真正属于 App 的文件"拷贝到 www/，供 Capacitor 打包。
// 目的：webDir 不能指向仓库根（会把 node_modules/android 一起塞进 APK）。
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '..');           // sinoky-app/
const out = path.join(src, 'www');

// 需要进包的目录 / 文件（其余一律不带）
const DIRS = ['assets', 'audio', 'data', 'icons', 'vendor', 'langs'];
const FILES = [
  'index.html', 'sw.js', 'version.json', 'manifest.webmanifest',
  'ARPHICPL.TXT', 'privacy.html', 'stats.html', 'robots.txt', 'sitemap.xml', '_headers',
  '_worker.js',        // ⚠️ 必须进包：Pages Functions(TTS/ASR/chat/score/feedback) 靠它。漏掉会导致 CI 末段 `wrangler pages deploy www` 把函数全覆盖掉（v0.21.0 踩过）
  'badge-backend.mjs', // ⚠️ _worker.js:29 `import { handleBadgeApi } from './badge-backend.mjs'` 的依赖。漏掉 → wrangler 打包 worker 报 Could not resolve → APK 发布链整体失败（v0.21.2 踩过）
  '.assetsignore'      // ⚠️ 使 badge-backend.mjs 不作为静态资源上传（防公网直接下载），但保留在磁盘上供 worker bundler 解析 import
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const d of DIRS) {
  await cp(path.join(src, d), path.join(out, d), { recursive: true });
}
for (const f of FILES) {
  try { await cp(path.join(src, f), path.join(out, f)); }
  catch (e) { console.warn('skip missing file:', f); }
}

// 版本号：从 index.html 的 APP_VERSION 读取，绝不手写（防三处不同步铁律复发）
const html = readFileSync(path.join(src, 'index.html'), 'utf8');
const m = html.match(/var APP_VERSION = '([\d.]+)'/);
if (!m) throw new Error('APP_VERSION not found in index.html');
const version = m[1];
writeFileSync(path.join(out, 'APK_VERSION.txt'), version + '\n');
console.log('[build:web] version =', version);

// 体积基线输出（后续对比用）
const size = async (p) => {
  let total = 0;
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      const st = await stat(fp);
      if (st.isDirectory()) await walk(fp);
      else total += st.size;
    }
  };
  await walk(p);
  return total;
};
console.log('[build:web] www size =', Math.round((await size(out)) / 1024 / 1024 * 10) / 10, 'MB');

/* ── 依赖闭包校验（2026-09-12 新增防线）──────────────────────────────
   事故：c98715b 把 _worker.js 放进 www/ 以保住 Pages Functions，却漏带它的
   依赖 badge-backend.mjs → CI 第 19 步 `wrangler pages deploy www` 报
   `Could not resolve "./badge-backend.mjs"`，APK 已构建签名完却发不出去。
   CI 上要跑到最后一步才暴露（浪费 8 分钟），故前移到构建阶段直接失败。 */
const missing = [];
const jsFiles = [];
const walkJs = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) await walkJs(fp);
    else if (/\.m?js$/.test(e.name)) jsFiles.push(fp);
  }
};
await walkJs(out);

// 只看包内相对依赖（./x、../x）——裸模块名/URL 交给运行时
const IMPORT_RE = /(?:^|[^\w$])(?:import\s+[^'"]*?from\s*|import\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/gm;
for (const f of jsFiles) {
  const code = readFileSync(f, 'utf8');
  for (const m of code.matchAll(IMPORT_RE)) {
    const target = path.join(path.dirname(f), m[1]);
    if (!existsSync(target)) missing.push(`${path.relative(out, f).replace(/\\/g, '/')} → ${m[1]}`);
  }
}

// index.html 里同级的本地 script src（漏列文件时页面静默挂掉，kaikou 项目踩过）
const htmlOut = readFileSync(path.join(out, 'index.html'), 'utf8');
for (const m of htmlOut.matchAll(/<script[^>]+src=["']([^"'#:?]+)["']/g)) {
  const p = m[1];
  if (/^(https?:|\/\/|data:)/.test(p)) continue;
  if (!existsSync(path.join(out, p))) missing.push(`index.html → ${p}`);
}

if (missing.length) {
  console.error('[build:web] ✗ 包内依赖缺失（CI 的 wrangler 部署会失败）：');
  missing.forEach((x) => console.error('   - ' + x));
  console.error('   → 把缺失文件加进本脚本顶部的 DIRS / FILES 清单');
  throw new Error('missing packaged dependency: ' + missing.join(', '));
}
console.log('[build:web] dependency closure OK —', jsFiles.length, 'js files checked');
