const { chromium } = require('playwright');
const path = require('path');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const OUT = path.join(APP, '_internal');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().replace('http://127.0.0.1:8899', '') + ' :: ' + ((r.failure() || {}).errorText || '')));
  await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    document.querySelectorAll('#splash').forEach(e => e.remove());
    const d = document.createElement('div');
    d.id = 'splash';
    d.innerHTML = '<div class="sp-brand">Sino<b>k</b>y</div><img src="assets/brand/dragon-nono.svg" alt="Sinoky">';
    document.body.appendChild(d);
  });
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const s = document.getElementById('splash');
    const im = s.querySelector('img');
    const br = s.querySelector('.sp-brand');
    const r = im.getBoundingClientRect();
    return {
      splash_bg: getComputedStyle(s).backgroundColor,
      splash_flexdir: getComputedStyle(s).flexDirection,
      brand_color: getComputedStyle(br).color,
      brand_size: getComputedStyle(br).fontSize,
      brand_family: getComputedStyle(br).fontFamily,
      img_shown: Math.round(r.width) + 'x' + Math.round(r.height),
      img_natural: im.naturalWidth + 'x' + im.naturalHeight,
      img_loaded: !!(im.complete && im.naturalWidth > 0),
      overflow_y: document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  console.log(JSON.stringify(info, null, 1));
  console.log('failed requests:', failed.length ? failed : 'none');
  await page.screenshot({ path: path.join(OUT, 'shot_splash_live.png') });

  await page.screenshot({ path: path.join(OUT, 'shot_splash_top.png'), clip: { x: 0, y: 0, width: 390, height: 844 } });
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
