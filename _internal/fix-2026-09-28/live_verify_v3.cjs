#!/usr/bin/env node
/* 线上官网真跑截图：v3 上线后的 4 张诺诺卡片（用户视角的最终验收） */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'live-after-v3');
const URL = 'https://sinoky.pages.dev/landing/features.html?cb=' + Date.now();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  /* loading="lazy" 必须「先滚再等」：只等不等滚 ⇒ 图永不加载，naturalWidth=0 假失败 */
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() =>
    [...document.images].every(i => i.complete && i.naturalWidth > 0) && document.fonts.status === 'loaded',
    { timeout: 30000 });

  const shots = await page.$$('.split .shot');
  const info = [];
  for (let i = 0; i < shots.length; i++) {
    const img = await shots[i].$('img');
    const b = img ? await img.evaluate(el => ({ src: el.getAttribute('src'), nw: el.naturalWidth, nh: el.naturalHeight })) : null;
    await shots[i].screenshot({ path: path.join(OUT, `card-${i}.png`) });
    info.push({ i, ...b });
  }
  await page.screenshot({ path: path.join(OUT, 'full.png'), fullPage: true });
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ url: URL, info, errors }, null, 2));
  console.log('采集 ' + info.length + ' 张卡片 → ' + OUT);
  console.log('图片加载: ' + info.map(x => `${x.src}@${x.nw}x${x.nh}`).join('  '));
  console.log('页面错误: ' + (errors.length ? errors.join(' | ') : '无'));
})().catch((e) => { console.error('✗ ' + (e && e.message)); process.exit(2); });
