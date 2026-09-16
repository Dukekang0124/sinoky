// 线上真机视觉确认（v0.23.13 配图升级）：
// 打开线上 scenes-read 视图，等 6 张 read 图 + 诺诺姿态图真实解码完成，截图；
// 再逐张 openReader 取大图截图。判据：naturalWidth>0（真加载）、img 未被 onerror 降透明度。
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const APP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const SHOTS = path.join(APP, '_internal/fix-2026-09-16/shots');
mkdirSync(SHOTS, { recursive: true });
const URL = 'https://sinoky.pages.dev/?cb=' + Date.now();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  serviceWorkers: 'block',
});
const page = await ctx.newPage();
const bad = [];
page.on('requestfailed', r => { if (/assets\//.test(r.url())) bad.push('FAILED ' + r.url()); });
page.on('response', r => { const u = r.url(); if (/assets\/(read|mascot|empty|onboard)\//.test(u) && r.status() >= 400) bad.push(r.status() + ' ' + u); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
// 进入场景阅读视图
await page.evaluate(() => { if (typeof go === 'function') go('scenes-read'); });
await page.waitForTimeout(600);

// 等 read 图 + 姿态图解码完成
const res = await page.evaluate(async () => {
  const imgs = Array.from(document.querySelectorAll('#sr-grid img, .nono-pose img, #nono-fab img'));
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const pend = imgs.filter(i => !i.complete || i.naturalWidth === 0);
    if (!pend.length) break;
    await new Promise(r => setTimeout(r, 300));
  }
  for (const i of imgs) {
    try { if (i.decode) await i.decode(); } catch (e) {}
    out.push({
      src: i.getAttribute('src'),
      nw: i.naturalWidth, nh: i.naturalHeight,
      complete: i.complete,
      opacity: getComputedStyle(i).opacity,
    });
  }
  return out;
});

console.log('=== 线上 read 视图图片加载情况 ===');
let okn = 0;
for (const r of res) {
  const good = r.nw > 0 && r.complete && Number(r.opacity) > 0.9;
  if (good) okn++;
  console.log('  %s %-34s %dx%d opacity=%s', good ? '✓' : '✗', r.src, r.nw, r.nh, r.opacity);
}
console.log('真加载 %d / %d', okn, res.length);
if (bad.length) { console.log('网络异常：'); bad.forEach(b => console.log('  ' + b)); }

await page.screenshot({ path: path.join(SHOTS, 'live-scenes-read-2313.png'), fullPage: true });
console.log('已截图 live-scenes-read-2313.png');

// 逐张打开 reader 大图
for (let i = 0; i < 6; i++) {
  await page.evaluate((k) => { if (typeof openReader === 'function') openReader(k); }, i);
  await page.waitForTimeout(700);
  const info = await page.evaluate(async () => {
    const im = document.getElementById('reader-img');
    if (!im) return null;
    try { if (im.decode) await im.decode(); } catch (e) {}
    return { src: im.getAttribute('src'), nw: im.naturalWidth, nh: im.naturalHeight };
  });
  console.log('  reader[%d] %s %s', i, info && info.src, info && (info.nw + 'x' + info.nh));
  await page.screenshot({ path: path.join(SHOTS, 'live-reader-' + i + '.png') });
}

await browser.close();
