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

  // 1) 启动屏
  await page.evaluate(() => {
    document.querySelectorAll('#splash').forEach(e => e.remove());
    const d = document.createElement('div');
    d.id = 'splash';
    d.innerHTML = '<div class="sp-brand">Sino<b>k</b>y</div><img src="assets/brand/dragon-nono.svg" alt="Sinoky">';
    document.body.appendChild(d);
  });
  await page.waitForTimeout(1400);
  const sp = await page.evaluate(() => {
    const s = document.getElementById('splash');
    const im = s.querySelector('img');
    return { bg: getComputedStyle(s).backgroundColor, brand: getComputedStyle(s.querySelector('.sp-brand')).fontSize,
             img: im.complete && im.naturalWidth > 0 ? im.naturalWidth + 'x' + im.naturalHeight : 'NOT LOADED' };
  });
  console.log('启动屏:', JSON.stringify(sp));
  await page.screenshot({ path: path.join(OUT, 'v0150_splash.png') });

  // 2) 首页 + 导航特写
  await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'v0150_home.png') });
  await page.locator('nav').screenshot({ path: path.join(OUT, 'v0150_nav.png') });

  const r = await page.evaluate(() => {
    const g = (e, p) => e ? getComputedStyle(e)[p] : 'n/a';
    const nav = [...document.querySelectorAll('body>nav button')];
    const ico = [...document.querySelectorAll('.navico')];
    const hub = document.querySelector('#v-home .hub, #v-home .card, .hub, .card');
    const btn = document.querySelector('.btn');
    return {
      nav_icon_count: ico.length,
      nav_text: nav.map(b => b.textContent.trim()),
      nav_active_color: nav[0] ? g(nav[0], 'color') : 'n/a',
      mask_ok: ico.map(e => (getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage || 'none').slice(0, 46)),
      ico_sizes: ico.map(e => Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)),
      nav_border: g(document.querySelector('body>nav'), 'borderTopColor'),
      hub_radius: g(hub, 'borderRadius'), hub_bgimg: g(hub, 'backgroundImage').slice(0, 30),
      hub_after: hub ? getComputedStyle(hub, '::after').content : 'n/a',
      btn_shadow: g(btn, 'boxShadow'),
      input_radius: g(document.querySelector('input'), 'borderRadius'),
      pbar_bg: g(document.querySelector('.pbar'), 'backgroundColor'),
      header_after: (() => { const h = document.querySelector('header'); return h ? getComputedStyle(h, '::after').height : 'n/a'; })(),
      gold_dim: getComputedStyle(document.documentElement).getPropertyValue('--gold-dim').trim(),
      paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
      overflow_x: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log('\n运行期核验:');
  console.log(JSON.stringify(r, null, 1));

  // 3) 进度/勋章页
  await page.evaluate(() => { if (typeof go === 'function') go('prog'); });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'v0150_prog.png') });
  const badge = await page.evaluate(() => {
    const c = document.querySelector('.badge-cell');
    const img = document.querySelector('.badge-cell img');
    return { cells: document.querySelectorAll('.badge-cell').length,
             img_radius: img ? getComputedStyle(img).borderRadius : 'n/a',
             img_shadow: img ? getComputedStyle(img).boxShadow : 'n/a' };
  });
  console.log('\n勋章:', JSON.stringify(badge));

  console.log('\nfailed requests:', failed.length ? failed : 'none');
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
