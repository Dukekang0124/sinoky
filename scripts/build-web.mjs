// 把"真正属于 App 的文件"拷贝到 www/，供 Capacitor 打包。
// 目的：webDir 不能指向仓库根（会把 node_modules/android 一起塞进 APK）。
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, '..');           // sinoky-app/
const out = path.join(src, 'www');

// 需要进包的目录 / 文件（其余一律不带）
const DIRS = ['assets', 'audio', 'data', 'icons', 'vendor', 'langs'];
const FILES = [
  'index.html', 'sw.js', 'version.json', 'manifest.webmanifest',
  'ARPHICPL.TXT', 'privacy.html', 'stats.html', 'robots.txt', 'sitemap.xml', '_headers'
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
