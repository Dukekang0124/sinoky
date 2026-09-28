#!/usr/bin/env node
/* 官网 features 页「诺诺卡片」真跑采集 —— 修复前 / 修复后 A/B 对比用
 *
 * 为什么必须真跑：这次要判的是「边缘看起来干不干净」，唯一可信的判据是
 * 真浏览器在真尺寸下的渲染结果。图片在自己尺寸下好看、缩到 340px 卡片里
 * 露馅（或反过来）都很常见。
 *
 * 同时量三个几何量：
 *   ① img.naturalWidth/Height  —— 素材真实像素
 *   ② img 渲染盒（getBoundingClientRect）—— 浏览器实际把它画成多大
 *   ③ 渲染宽高比 vs 素材宽高比 —— 不等即「被拉伸变形」，是 HTML `width/height`
 *      属性与 CSS 打架的典型症状（属性写 720x540 而素材是 512x512）
 *
 * 用法：node capture_cards.cjs [--tag=before|after] [--port=8790]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const TAG = (args.find((a) => a.startsWith('--tag=')) || '--tag=run').split('=')[1];
const PORT = (args.find((a) => a.startsWith('--port=')) || '--port=8790').split('=')[1];
const HERE = __dirname;
const OUT = path.resolve(HERE, 'cards-' + TAG);
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });

  /* 零生产写入：任何 /api/* 一律掐断。官网只读 version.json，也一并放行本地。 */
  await page.route('**/api/**', (r) => r.abort());

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(`${BASE}/landing/features.html`, { waitUntil: 'load', timeout: 60000 });

  /* ⚠️ 顺序：**先滚再等**。features 的图是 loading="lazy" —— 首屏之外的图在滚动前
     根本不会发起加载，`complete` 永远是 false。先等后滚 = 必然 30s 超时。
     （这条和 promo 采集器里踩过的「先 go 再 prep」是同一类顺序坑。） */
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40));
    }
  });
  /* 等条件不等时间：滚动触发后才等「所有图完成 + 字体就绪」 */
  await page.waitForFunction(() => {
    const bad = [...document.images].filter((i) => !(i.complete && i.naturalWidth > 0));
    return bad.length === 0 && document.fonts.status === 'loaded';
  }, { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.split').forEach((sp, i) => {
      const img = sp.querySelector('.shot img');
      const shot = sp.querySelector('.shot');
      const h3 = sp.querySelector('h3');
      if (!img) return;
      const r = img.getBoundingClientRect();
      const rs = shot.getBoundingClientRect();
      out.push({
        idx: i,
        title: (h3 ? h3.textContent : '').trim().slice(0, 48),
        src: img.getAttribute('src'),
        attrW: img.getAttribute('width'), attrH: img.getAttribute('height'),
        naturalW: img.naturalWidth, naturalH: img.naturalHeight,
        cssW: +(r.width.toFixed(2)), cssH: +(r.height.toFixed(2)),
        shotW: +(rs.width.toFixed(2)), shotH: +(rs.height.toFixed(2)),
        naturalAR: +(img.naturalWidth / img.naturalHeight).toFixed(4),
        cssAR: +(r.width / r.height).toFixed(4),
      });
    });
    return out;
  });

  for (const row of rows) {
    const el = page.locator('.split').nth(row.idx);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    await el.screenshot({ path: path.join(OUT, `card-${row.idx}-${path.basename(row.src).replace(/\.webp$/, '')}.png`) });
  }

  await browser.close();

  const report = { tag: TAG, viewport: '1500x1000 @2x', url: BASE + '/landing/features.html', rows, errors };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  console.log('='.repeat(96));
  console.log(`卡片采集 [${TAG}]  →  ${OUT}`);
  console.log('='.repeat(96));
  console.log('idx 素材            natural     attr      CSS渲染盒      shot盒       宽高比(natural/css) 变形');
  for (const r of rows) {
    const distort = Math.abs(r.naturalAR - r.cssAR) > 0.01 ? '  ✗ 变形' : '  ok';
    console.log(
      `${r.idx}  ${path.basename(r.src).padEnd(16)}${(r.naturalW + 'x' + r.naturalH).padEnd(12)}`
      + `${(r.attrW + 'x' + r.attrH).padEnd(10)}${(r.cssW + 'x' + r.cssH).padEnd(15)}`
      + `${(r.shotW + 'x' + r.shotH).padEnd(14)}${r.naturalAR} / ${r.cssAR}${distort}`
    );
  }
  console.log('\n页面错误: ' + (errors.length ? errors.join(' | ') : '无'));
  console.log('标题对照：' + rows.map((r) => `${r.idx}:${r.title.slice(0, 22)}`).join('  '));
})().catch((e) => { console.error('✗ 采集脚本异常：' + (e && e.stack || e)); process.exit(2); });
