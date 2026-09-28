#!/usr/bin/env node
/* 抠图三版并排采集（原版 / v3 现上线 / v4 本次）—— 真站点样式 + 真 Chrome。
 * 用法：node capture_ab4.cjs [--port=8791]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const PORT = (args.find((a) => a.startsWith('--port=')) || '--port=8791').split('=')[1];
const HERE = __dirname;
const OUT = path.join(HERE, "ab4");
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(`${BASE}/_internal/fix-2026-09-28/_ab4.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });

  const rows = await page.$$('.row');
  const info = [];
  for (const row of rows) {
    const name = await row.getAttribute('data-name');
    const imgs = await row.$$('img');
    const boxes = [];
    for (const im of imgs) {
      const b = await im.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { nw: el.naturalWidth, nh: el.naturalHeight, w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
      });
      boxes.push(b);
    }
    await row.screenshot({ path: path.join(OUT, name + '.png') });
    info.push({ name, boxes, sameBox: boxes.every((b) => b.w === boxes[0].w && b.h === boxes[0].h) });
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ url: BASE + '/_internal/fix-2026-09-28/_ab4.html', info, errors }, null, 2));

  console.log('='.repeat(90));
  console.log(`三版 A/B 采集  →  ${OUT}`);
  console.log('='.repeat(90));
  for (const r of info) {
    const f = (x) => `${x.nw}x${x.nh}→${x.w}x${x.h}`;
    console.log(`${r.name.padEnd(17)}${r.boxes.map(f).join('  ')}  同盒:${r.sameBox ? 'ok' : '✗'}`);
  }
  console.log('\n页面错误: ' + (errors.length ? errors.join(' | ') : '无'));
})().catch((e) => { console.error('✗ 采集脚本异常：' + (e && e.stack || e)); process.exit(2); });
