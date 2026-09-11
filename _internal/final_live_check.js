const { chromium } = require('playwright');
const path = require('path');
const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const OUT = path.join(APP, '_internal');
const NEW_RED = 'rgb(194, 54, 43)';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().replace('https://sinoky.pages.dev', '') + ' :: ' + ((r.failure() || {}).errorText || '')));
  await page.goto('https://sinoky.pages.dev/?live11=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const r = await page.evaluate((NEW_RED) => {
    const hl = document.querySelector('#v-onboard h1 .hl');
    const cta = document.getElementById('obNext');
    const all = [...document.querySelectorAll('*')].map(e => {
      const cs = getComputedStyle(e);
      return cs.color + ' ' + cs.backgroundColor + ' ' + cs.borderTopColor + ' ' + cs.borderLeftColor + ' ' + cs.borderBottomColor;
    }).join(' ');
    return {
      ver: (document.documentElement.innerHTML.match(/APP_VERSION = '([^']+)'/) || [])[1],
      hl: hl ? getComputedStyle(hl).color : 'n/a',
      cta_radius: cta ? getComputedStyle(cta).borderRadius : 'n/a',
      cta_bg: cta ? getComputedStyle(cta).backgroundColor : 'n/a',
      old_red_nodes: (all.match(/230, 57, 70/g) || []).length,
      new_red_nodes: (all.match(/194, 54, 43/g) || []).length,
      theme_color: (document.querySelector('meta[name=theme-color]') || {}).content,
      pass: (hl && getComputedStyle(hl).color === NEW_RED) && !(all.match(/230, 57, 70/g) || []).length,
    };
  }, NEW_RED);

  console.log('=== 线上 v0.14.11 引导页终验 ===');
  console.log(JSON.stringify(r, null, 1));
  console.log('判定:', r.pass ? '✅ 生产已无旧洋红，引导页为新朱砂' : '❌ 仍有残留');
  console.log('failed requests:', failed.length ? failed : 'none');
  await page.screenshot({ path: path.join(OUT, 'final_onboard_production.png') });
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
