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
  await page.waitForTimeout(3000);

  const r = await page.evaluate(async () => {
    const cs = getComputedStyle(document.documentElement);
    const bodyCS = getComputedStyle(document.body);
    const btn = document.querySelector('.btn');
    const badge = document.querySelector('.badge');
    const nav = [...document.querySelectorAll('nav button')].map(b => b.querySelector('img') ? 'svg' : 'emoji');
    const sp = document.getElementById('splash');
    const spSrc = sp ? (sp.querySelector('img') || {}).getAttribute('src') : 'REMOVED(已淡出)';
    return {
      theme_red: cs.getPropertyValue('--red').trim(),
      theme_gold: cs.getPropertyValue('--gold').trim(),
      theme_teal: cs.getPropertyValue('--teal').trim(),
      lattice_bg: /repeating-linear-gradient/.test(bodyCS.backgroundImage),
      h_serif: /Songti|Noto Serif|serif/.test(getComputedStyle(document.querySelector('h1,h2')).fontFamily),
      btn_radius: btn ? getComputedStyle(btn).borderRadius : 'n/a',
      badge_radius: badge ? getComputedStyle(badge).borderRadius : 'n/a',
      badge_border: badge ? getComputedStyle(badge).borderColor : 'n/a',
      nav_icons: nav.join(','),
      splash_src: spSrc,
      app_version: (document.documentElement.innerHTML.match(/APP_VERSION = '([^']+)'/) || [])[1] || '?',
    };
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('failed requests:', failed.length ? failed : 'none');
  await page.screenshot({ path: path.join(OUT, 'shot_regress_home.png') });
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
