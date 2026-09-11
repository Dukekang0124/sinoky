const { chromium } = require('playwright');
const path = require('path');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const OUT = path.join(APP, '_internal');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url() + ' :: ' + ((r.failure() || {}).errorText || '')));
  await page.goto('https://sinoky.pages.dev/?live=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const live = await page.evaluate(async () => {
    const r = await fetch('assets/brand/dragon-nono.svg?cb=' + Date.now());
    const t = await r.text();
    const g = await fetch('sw.js?cb=' + Date.now()).then(x => x.text());
    return { svgStatus: r.status, svgBytes: t.length, sw: (g.match(/sinoky-v[\w.]+/) || ['?'])[0] };
  });
  console.log('live asset check:', JSON.stringify(live));

  await page.evaluate(() => {
    document.querySelectorAll('#splash').forEach(e => e.remove());
    const d = document.createElement('div');
    d.id = 'splash';
    d.innerHTML = '<div class="sp-brand">Sino<b>k</b>y</div><img src="assets/brand/dragon-nono.svg" alt="Sinoky">';
    document.body.appendChild(d);
  });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const s = document.getElementById('splash');
    const im = s.querySelector('img');
    return {
      bg: getComputedStyle(s).backgroundColor,
      brand: getComputedStyle(s.querySelector('.sp-brand')).fontSize + ' ' + getComputedStyle(s.querySelector('.sp-brand')).color,
      img: im.complete && im.naturalWidth > 0 ? im.naturalWidth + 'x' + im.naturalHeight : 'NOT LOADED',
    };
  });
  console.log('live splash render:', JSON.stringify(info));
  console.log('failed requests:', failed.length ? failed : 'none');
  await page.screenshot({ path: path.join(OUT, 'shot_splash_production.png') });
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
