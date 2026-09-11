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

  // 跳过首次引导
  const skipped = await page.evaluate(() => {
    const el = document.querySelector('#v-onboard .ob-skip') || document.querySelector('.ob-skip');
    if (el) { el.click(); return 'clicked .ob-skip'; }
    if (typeof finishOnboard === 'function') { finishOnboard(); return 'called finishOnboard'; }
    const m = Object.keys(window).find(k => /onboard|obFinish|obDone/i.test(k));
    return 'not-found ' + (m || '');
  });
  console.log('跳过引导:', skipped);
  await page.waitForTimeout(1200);
  await page.evaluate(() => { if (typeof go === 'function') go('home'); });
  await page.waitForTimeout(1500);

  const navBox = await page.evaluate(() => {
    const nav = document.querySelector('body>nav');
    if (!nav) return 'no body>nav';
    const r = nav.getBoundingClientRect();
    const on = nav.querySelector('button.on');
    const ico = nav.querySelector('.navico');
    return {
      rect: Math.round(r.width) + 'x' + Math.round(r.height),
      view_on: document.querySelector('#v-home.views.on') ? 'home' : 'other',
      on_label: on ? on.textContent.trim() : 'none',
      on_color: on ? getComputedStyle(on).color : 'n/a',
      on_cloud: on ? getComputedStyle(on, '::before').backgroundImage.slice(0, 30) : 'n/a',
      ico_bg: ico ? getComputedStyle(ico).backgroundColor : 'n/a',
      ico_mask: ico ? (getComputedStyle(ico).maskImage || 'none').slice(-28) : 'n/a',
    };
  });
  console.log('底部导航:', JSON.stringify(navBox, null, 1));
  await page.locator('body>nav').screenshot({ path: path.join(OUT, 'v0150_nav2.png') });
  await page.screenshot({ path: path.join(OUT, 'v0150_home2.png') });

  // 进度页看勋章 + 进度条
  await page.evaluate(() => { if (typeof go === 'function') go('prog'); });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'v0150_prog2.png') });

  // 练习页看按钮金环 / 音节 chip
  await page.evaluate(() => { if (typeof go === 'function') go('practice'); });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'v0150_practice2.png') });

  // 城市页看输入框胶囊
  await page.evaluate(() => { if (typeof go === 'function') go('cities'); });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT, 'v0150_cities2.png') });

  console.log('\nfailed requests:', failed.length ? failed : 'none');
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
