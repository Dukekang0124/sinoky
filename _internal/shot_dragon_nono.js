const { chromium } = require('playwright');
const path = require('path');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const OUT = path.join(APP, '_internal');
const URL = 'file:///' + (APP + '\\_internal\\_view_dragon.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 760, height: 860 }, deviceScaleFactor: 1 });
  await page.goto(URL);
  await page.waitForTimeout(700);
  const info = await page.evaluate(() => {
    const im = document.getElementById('hero');
    return { w: im.naturalWidth, h: im.naturalHeight, ok: im.complete && im.naturalWidth > 0, shown: Math.round(im.getBoundingClientRect().width) };
  });
  console.log(`svg natural=${info.w}x${info.h} loaded=${info.ok} shown=${info.shown}px`);
  await page.screenshot({ path: path.join(OUT, 'shot_dragon_teal.png') });
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
