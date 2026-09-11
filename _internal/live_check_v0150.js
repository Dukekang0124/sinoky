const { chromium } = require('playwright');
const path = require('path');
const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const OUT = path.join(APP, '_internal');
const LIVE = 'https://sinoky.pages.dev/?v150=' + Date.now();

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().replace('https://sinoky.pages.dev', '') + ' :: ' + ((r.failure() || {}).errorText || '')));
  await page.goto(LIVE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // 生产启动屏（重注入，用线上真实 CSS + 真实资产）
  await page.evaluate(() => {
    document.querySelectorAll('#splash').forEach(e => e.remove());
    const d = document.createElement('div');
    d.id = 'splash';
    d.innerHTML = '<div class="sp-brand">Sino<b>k</b>y</div><img src="assets/brand/dragon-nono.svg" alt="Sinoky">';
    document.body.appendChild(d);
  });
  await page.waitForTimeout(1500);
  const sp = await page.evaluate(() => {
    const s = document.getElementById('splash');
    const im = s.querySelector('img');
    return { bg: getComputedStyle(s).backgroundColor, img: im.complete && im.naturalWidth > 0 ? im.naturalWidth + 'x' + im.naturalHeight : 'NOT LOADED' };
  });
  console.log('生产启动屏:', JSON.stringify(sp));
  await page.screenshot({ path: path.join(OUT, 'v0150_live_splash.png') });
  await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });

  // 跳过引导后看导航 / 表单 / 模块
  await page.evaluate(() => { const el = document.querySelector('#v-onboard .ob-skip'); if (el) el.click(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { if (typeof go === 'function') go('home'); });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const g = (e, p) => { if (!e) return 'n/a'; if (p.indexOf('::') === 0) return getComputedStyle(e, p).backgroundImage; return getComputedStyle(e)[p]; };
    const ico = [...document.querySelectorAll('body>nav .navico')];
    const on = document.querySelector('body>nav button.on');
    const hub = document.querySelector('.hub, .card');
    return {
      ver: (document.documentElement.innerHTML.match(/APP_VERSION = '([^']+)'/) || [])[1],
      nav_icons: ico.length,
      nav_ico_sizes: ico.map(e => Math.round(e.getBoundingClientRect().width)).join(','),
      nav_on_color: on ? g(on, 'color') : 'n/a',
      nav_cloud: on ? String(g(on, '::before')).slice(0, 40) : 'n/a',
      nav_border_top: g(document.querySelector('body>nav'), 'borderTopColor'),
      hub_corner: g(hub, 'backgroundImage').slice(0, 26),
      header_rule: (() => { const h = document.querySelector('header'); return h ? getComputedStyle(h, '::after').height : 'n/a'; })(),
      input_radius: g(document.querySelector('input'), 'borderRadius'),
      btn_ring: g(document.querySelector('.btn'), 'boxShadow').slice(0, 40),
      overflow_x: document.documentElement.scrollWidth > window.innerWidth + 1,
      gold_dim: getComputedStyle(document.documentElement).getPropertyValue('--gold-dim').trim(),
      paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
    };
  });
  console.log('\n生产运行期核验:', JSON.stringify(r, null, 1));
  await page.locator('body>nav').screenshot({ path: path.join(OUT, 'v0150_live_nav.png') });
  await page.screenshot({ path: path.join(OUT, 'v0150_live_home.png') });

  const pass = r.ver === '0.15.0' && r.nav_icons === 5 && r.nav_on_color === 'rgb(194, 54, 43)'
    && r.input_radius === '99px' && !r.overflow_x && r.gold_dim === '#8a7448' && r.header_rule === '7px';
  console.log('\n判定:', pass ? '✅ 全部达标' : '❌ 有项不达标');
  console.log('failed requests:', failed.length ? failed : 'none');
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
