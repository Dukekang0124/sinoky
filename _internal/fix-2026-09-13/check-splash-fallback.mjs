/**
 * check-splash-fallback.mjs —— 确认 v0.23.12 合并规则**没有改坏降级路径**
 *
 * 降级路径的契约（index.html 1138 行 img 的 onerror + 6369 行）：
 *   开屏图加载失败 ⇒ `#splash` 加 `.sp-fallback` ⇒ 显示 CSS 字标（display:block）、隐藏 img，
 *   并且**必须仍然消失**（onerror 里调了 go()，另有 1600ms 硬上限兜底）。
 * 合并规则会把 `.sp-fallback` 两条规则一起搬到 <head>，所以这条路径必须单独回归。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const SHOTS = path.join(HERE, 'shots');
const HTML = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log('  ✅ %s %s', id, m); };
const no = (id, m) => { fail++; console.log('  ❌ %s %s', id, m); };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/fb') {                       // 故意让开屏图 404，逼出降级态
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  res.writeHead(404); res.end();           // 一切资源（含开屏图）都 404
});
await new Promise(r => server.listen(8898, '127.0.0.1', r));

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:8898/fb', { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => {
  const sp = document.getElementById('splash');
  return sp && (sp.classList.contains('sp-fallback') || sp.dataset.gone);
}, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(200);

const st = await page.evaluate(() => {
  const sp = document.getElementById('splash');
  if (!sp) return { gone: true };
  const br = sp.querySelector('.sp-brand'), img = sp.querySelector('img');
  return {
    gone: false, fallback: sp.classList.contains('sp-fallback'),
    brand: br ? getComputedStyle(br).display : null,
    img: img ? getComputedStyle(img).display : null,
    bg: getComputedStyle(sp).backgroundColor,
  };
});
console.log('降级态：%s', JSON.stringify(st));
if (st.gone) no('D1', '开屏已移除，无法观察降级渲染');
else {
  st.fallback ? ok('D1', '.sp-fallback 已加') : no('D1', '.sp-fallback 未加');
  st.brand === 'block' ? ok('D2', 'CSS 字标显示（display:block）') : no('D2', '字标 display=' + st.brand);
  st.img === 'none' ? ok('D3', '开屏图已隐藏（display:none）') : no('D3', 'img display=' + st.img);
  st.bg === 'rgb(14, 55, 57)' ? ok('D4', '底色 = rgb(14,55,57)') : no('D4', '底色 = ' + st.bg);
  await page.screenshot({ path: path.join(SHOTS, 'ab-fallback.png') }).catch(() => {});
}

// 降级态也必须消失（onerror→go() 或 1600ms 硬上限）
const gone = await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 6000 }).then(() => true).catch(() => false);
gone ? ok('D5', '降级态最终也会消失，不留黏屏') : no('D5', '降级态未消失（黏屏）');
await b.close();
server.close();
console.log('\n降级路径回归：通过 %d / 失败 %d', pass, fail);
process.exit(fail ? 1 : 0);
