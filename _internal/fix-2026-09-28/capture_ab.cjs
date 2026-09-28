#!/usr/bin/env node
/* 抠图 before/after 真跑并排采集 —— 用**真实站点样式**（landing/site.css 的 .shot）
 * 在真 Chrome 里同屏对照，避免"我自己拼图"引入偏差。
 *
 * 为什么必须在真浏览器里跑：本次要判的是「边缘观感」。我在 Python 里手工
 * 合成卡片底色再拼板，等价于自己给自己出题；真浏览器用的是 .shot 的
 * border/圆角/box-shadow + 真实缩放，才是用户看到的东西。
 *
 * 产出：ab/<name>.png（每行：左 BEFORE / 右 AFTER，元素级 2x）
 * 判据：两张都非空 + 尺寸一致 + 零页面错误。
 *
 * 用法：node capture_ab.cjs [--port=8790]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const PORT = (args.find((a) => a.startsWith('--port=')) || '--port=8790').split('=')[1];
const HERE = __dirname;
const OUT = path.join(HERE, 'ab');
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  /* 404 只会在 console 里留一句没头没尾的 "Failed to load resource" ⇒ 单独点名 URL，
     否则闸门给出的是「有错误但不知道是谁」，等于没落地（审计纪律：未执行/未点名的盲区） */
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(`${BASE}/_internal/fix-2026-09-28/_ab.html`, { waitUntil: 'load', timeout: 60000 });
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
    info.push({ name, before: boxes[0], after: boxes[1],
                sameBox: boxes[0].w === boxes[1].w && boxes[0].h === boxes[1].h });
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ url: BASE + '/_internal/fix-2026-09-28/_ab.html', info, errors }, null, 2));

  console.log('='.repeat(90));
  console.log(`A/B 采集  →  ${OUT}`);
  console.log('='.repeat(90));
  console.log('素材              BEFORE(natural→渲染盒)      AFTER(natural→渲染盒)       同尺寸  两版字节不同');
  for (const r of info) {
    const md5 = (p) => require('crypto').createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
    const bBak = path.join(HERE, '_backup', r.name + '.webp');
    const bCur = path.join(HERE, '..', '..', 'assets', 'onboard', r.name + '.webp');
    const diff = fs.existsSync(bBak) ? (md5(bBak) !== md5(bCur) ? '是' : '否 ✗同字节') : '备份缺失 ✗';
    const f = (x) => `${x.nw}x${x.nh}→${x.w}x${x.h}`;
    console.log(`${r.name.padEnd(17)}${f(r.before).padEnd(28)}${f(r.after).padEnd(28)}${(r.sameBox ? 'ok' : '✗ 不一致').padEnd(8)}${diff}`);
  }
  console.log('\n页面错误: ' + (errors.length ? errors.join(' | ') : '无'));
})().catch((e) => { console.error('✗ 采集脚本异常：' + (e && e.stack || e)); process.exit(2); });
