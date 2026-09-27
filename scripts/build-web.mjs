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
const DIRS = ['assets', 'audio', 'data', 'icons', 'vendor', 'langs', 'landing'];
const FILES = [
  'index.html', 'sw.js', 'version.json', 'manifest.webmanifest',
  'ARPHICPL.TXT', 'privacy.html', 'stats.html', 'credits.html', 'robots.txt', 'sitemap.xml',
  '_headers',
  '_redirects',        // ⚠️ 部署配置：承载边缘 302 收口（/www/*、/_internal/*、/badge-backend.mjs…）。漏带 → tag CI 部署后收口规则整体失效
  'download.html',     // ⚠️ 线上 /download 下载引导页。漏带 → tag CI 部署后下载页退化成 SPA 兜底
  '_worker.js',        // ⚠️ 必须进包：Pages Functions(TTS/ASR/chat/score/feedback) 靠它。漏掉会导致 CI 末段 `wrangler pages deploy www` 把函数全覆盖掉（v0.21.0 踩过）
  'badge-backend.mjs', // ⚠️ _worker.js:29 `import { handleBadgeApi } from './badge-backend.mjs'` 的依赖。漏掉 → wrangler 打包 worker 报 Could not resolve → APK 发布链整体失败（v0.21.2 踩过）
  '.assetsignore'      // ⚠️ 使 badge-backend.mjs 不作为静态资源上传（防公网直接下载），但保留在磁盘上供 worker bundler 解析 import
];

// 明确不上线的根级条目
const EXCLUDE = new Set([
  '.git', '.github', '.gitignore', '.wrangler', '.dev.vars', '.env',
  'node_modules', 'android', 'www', 'apk', 'apk-icons', 'scripts', 'voice', '_internal',
  'package.json', 'package-lock.json', 'capacitor.config.json',
  '_audit_i18n.txt',
  'wrangler.toml',     // v0.24.8 新增：Pages 部署配置（KV 绑定/兼容标记）。属构建配置，**不上线**（上线等于把部署配置公开可下载）
  'nul',               // Windows 保留设备名的 0 字节残留（环境产物）。归类为排除，避免每次构建硬失败
]);

/* ── 归类断言（2026-09-12 新增）────────────────────────────────────
   仓库根新加一个条目后若忘了归类，后果是静默的：该上线的没上线
   （download.html / _redirects / landing 都曾长期漏在包外，只有 push main
   的根目录部署才临时掩盖），或内部文件被上线。这里让构建阶段直接失败。 */
const unclassified = (await readdir(src, { withFileTypes: true }))
  .map((e) => e.name)
  .filter((n) => !DIRS.includes(n) && !FILES.includes(n) && !EXCLUDE.has(n) && !/\.(log|jks)$/.test(n));
if (unclassified.length) {
  console.error('[build:web] ✗ 仓库根有未归类条目：');
  unclassified.forEach((n) => console.error('   - ' + n));
  console.error('   → 该上线：加进 DIRS / FILES；不该上线：加进 EXCLUDE');
  throw new Error('unclassified root entries: ' + unclassified.join(', '));
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const d of DIRS) {
  await cp(path.join(src, d), path.join(out, d), { recursive: true });
}
for (const f of FILES) {
  try { await cp(path.join(src, f), path.join(out, f)); }
  catch (e) { console.warn('skip missing file:', f); }
}

/* ── 行尾规范化（2026-09-27 新增）────────────────────────────────────
   CI 在 Linux 上 checkout + 构建 ⇒ 产物是 LF；本机 Windows 构建 ⇒ CRLF。
   两者「内容相同、字节不同」，后果有二：
   ① 本地 www 与线上逐行比对会显示 14100 行「全部不同」（其实只差一个 \r），
      人工 diff 被噪音淹没，真实差异（如 version.json 落后）反而看不见；
   ② 用本地 www 应急部署，会把线上每个文本文件都换成 CRLF 版 ——
      功能虽无害，但「线上 == 仓库产物」这条不变量当场失效，此后每次比对都是噪音。
   故在构建阶段统一规范化为 LF，与 CI 产物字节对齐。二进制（png/webp/mp3/apk）不动。 */
const TEXT_EXT = /\.(html?|js|mjs|cjs|json|webmanifest|css|txt|xml|md|svg)$/i;
const TEXT_BARE = new Set(['_headers', '_redirects', '.assetsignore']);
let normalized = 0;
const walkText = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { await walkText(fp); continue; }
    if (!TEXT_EXT.test(e.name) && !TEXT_BARE.has(e.name)) continue;
    const buf = readFileSync(fp);
    if (!buf.includes(13)) continue;                    // 无 \r 直接跳过
    writeFileSync(fp, Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
    normalized++;
  }
};
await walkText(out);
console.log('[build:web] 行尾规范化 LF —', normalized, '个文本文件已转换');

// 版本号：从 index.html 的 APP_VERSION 读取，绝不手写（防三处不同步铁律复发）
const html = readFileSync(path.join(src, 'index.html'), 'utf8');
const m = html.match(/var APP_VERSION = '([\d.]+)'/);
if (!m) throw new Error('APP_VERSION not found in index.html');
const version = m[1];

/* 🔴 v0.28.1 修复：APK_VERSION.txt 的语义是 **APK 的版本号**，历史上却一直写「网页版本」。
   自 v0.28.1 起两者可以不同（纯网页修正不发新 APK），继续写网页版本等于让这个文件撒谎：
   线上宣告 APK=0.28.1，而 apk/ 目录里只有 0.28.0 的包 —— 任何按它判断更新的逻辑
   都会「提示更新 → 下到同一个包 → 装完还是旧版 → 再提示」，形成死循环。
   改为读 version.json 的 apk.version（旧结构无 apk 段时退回网页版本）。 */
let apkVersion = version;
try {
  const vj = JSON.parse(readFileSync(path.join(src, 'version.json'), 'utf8'));
  if (vj && vj.apk && vj.apk.version) apkVersion = String(vj.apk.version);
} catch (e) {
  console.warn('[build:web] ⚠️ 读 version.json 失败，APK_VERSION.txt 退回网页版本：' + e.message);
}
writeFileSync(path.join(out, 'APK_VERSION.txt'), apkVersion + '\n');
/* 不变量①：APK_VERSION.txt 必须等于 version.json 的 apk.version（防语义再次漂移） */
/* 不变量②：apk.version 必须与 apk.url 里的版本号一致（防「宣告的版本」与「实际给的包」不符） */
{
  const vj = JSON.parse(readFileSync(path.join(src, 'version.json'), 'utf8'));
  if (vj && vj.apk) {
    const urlVer = (String(vj.apk.url || '').match(/Sinoky-v([\d.]+)-release\.apk/) || [])[1];
    if (urlVer && urlVer !== String(vj.apk.version)) {
      throw new Error(`[build:web] apk.version(${vj.apk.version}) 与 apk.url 版本(${urlVer}) 不一致 —— 停止构建`);
    }
  }
}
console.log('[build:web] version =', version, '| APK_VERSION.txt =', apkVersion,
            apkVersion === version ? '(与网页同版)' : '(APK 落后于网页 — 预期)');

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

// 所有 HTML 的本地 script src / stylesheet href（漏列文件时页面静默挂掉，kaikou 项目踩过）
const htmlFiles = [];
const walkHtml = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) await walkHtml(fp);
    else if (/\.html?$/i.test(e.name)) htmlFiles.push(fp);
  }
};
await walkHtml(out);
for (const f of htmlFiles) {
  const html = readFileSync(f, 'utf8');
  const rel = path.relative(out, f).replace(/\\/g, '/');
  const local = (u) => u && !/^(https?:|\/\/|data:|mailto:|#)/.test(u);
  for (const m of html.matchAll(/<script[^>]+src=["']([^"'#:?]+)["']/g)) {
    if (local(m[1]) && !existsSync(path.join(out, m[1]))) missing.push(`${rel} → ${m[1]}`);
  }
  for (const tag of html.match(/<link[^>]*>/g) || []) {
    if (!/rel=["']stylesheet["']/i.test(tag)) continue;
    const h = tag.match(/href=["']([^"'#:?]+)["']/);
    if (h && local(h[1]) && !existsSync(path.join(out, h[1]))) missing.push(`${rel} → ${h[1]}`);
  }
}

if (missing.length) {
  console.error('[build:web] ✗ 包内依赖缺失（CI 的 wrangler 部署会失败）：');
  missing.forEach((x) => console.error('   - ' + x));
  console.error('   → 把缺失文件加进本脚本顶部的 DIRS / FILES 清单');
  throw new Error('missing packaged dependency: ' + missing.join(', '));
}
console.log('[build:web] dependency closure OK —', jsFiles.length, 'js files checked');
