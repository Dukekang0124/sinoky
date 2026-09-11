const { chromium } = require('playwright');
const path = require('path');
const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const OUT = path.join(APP, '_internal');
const LIVE = 'https://sinoky.pages.dev/?rt=' + Date.now();

function lum(rgb) {
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
}
const parse = s => (s.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().replace('https://sinoky.pages.dev', '') + ' :: ' + ((r.failure() || {}).errorText || '')));
  await page.goto(LIVE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const out = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (el, p) => el ? getComputedStyle(el)[p] : 'n/a';
    const rect = el => { if (!el) return 'n/a'; const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
    const nav = [...document.querySelectorAll('nav button')];
    const bc = document.querySelector('.badge-cell');
    return {
      vars: {
        bg: cs.getPropertyValue('--bg').trim(), txt: cs.getPropertyValue('--txt').trim(),
        sub: cs.getPropertyValue('--sub').trim(), red: cs.getPropertyValue('--red').trim(),
        gold: cs.getPropertyValue('--gold').trim(), teal: cs.getPropertyValue('--teal').trim(),
      },
      wrap: getComputedStyle(document.querySelector('.wrap')).maxWidth + ' / pad ' + getComputedStyle(document.querySelector('.wrap')).padding,
      body_bg_img: getComputedStyle(document.body).backgroundImage.slice(0, 60),
      h1_font: getComputedStyle(document.querySelector('h1')).fontFamily,
      brand_markup: (document.querySelector('.brand') || {}).outerHTML,
      nav_icons: nav.map(b => b.querySelector('img') ? 'img' : (b.querySelector('.ic') ? 'emoji' : '?')),
      nav_h: rect(nav[0]),
      btn: { radius: g(document.querySelector('.btn'), 'borderRadius'), size: rect(document.querySelector('.btn')) },
      badge_cell: bc ? { radius: g(bc, 'borderRadius'), size: rect(bc), bg: g(bc, 'backgroundColor'), border: g(bc, 'borderColor') } : 'none',
      badge: { radius: g(document.querySelector('.badge'), 'borderRadius'), size: rect(document.querySelector('.badge')) },
      input: { radius: g(document.querySelector('input'), 'borderRadius'), h: rect(document.querySelector('input')) },
      fbopen: { radius: g(document.getElementById('fb-open'), 'borderRadius') },
      card_bg_image: g(document.querySelector('.card,.hub'), 'backgroundImage').slice(0, 40),
      hero_html: (document.querySelector('.hero') || {}).innerHTML ? 'text-only' : 'none',
      home_imgs: document.querySelectorAll('#v-home img').length,
      card_h: rect(document.querySelector('.card,.hub')),
      corner_ornament_any: !!document.querySelector('[class*=corner],[class*=ornament],[class*=meander],[class*=cloud]'),
    };
  });

  console.log('=== 运行期计算样式 ===');
  console.log(JSON.stringify(out, null, 1));
  const v = out.vars;
  console.log('\n=== 对比度（方案 2.4 红线）===');
  console.log('  正文 --txt on --bg :', contrast(parse(v.txt), parse(v.bg)), '(方案要求 ≥7:1 / AAA 13:1)');
  console.log('  次要 --sub on --bg :', contrast(parse(v.sub), parse(v.bg)), '(方案要求 AA ≥4.5:1)');
  console.log('  朱砂 --red on --bg :', contrast(parse(v.red), parse(v.bg)));
  console.log('  鎏金 --gold on --bg :', contrast(parse(v.gold), parse(v.bg)));

  console.log('\n=== 交互：诺诺面板 ===');
  await page.evaluate(() => { const f = document.querySelector('#fb-open'); if (f) f.remove(); });
  await page.evaluate(() => { if (typeof nonoOpen === 'function') nonoOpen(); });
  await page.waitForTimeout(900);
  const panel = await page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    if (!p) return 'panel 未出现';
    const sc = document.querySelector('.nc-scroll');
    const r = p.getBoundingClientRect();
    return {
      panel_h: Math.round(r.height), viewport_h: window.innerHeight,
      max_height_css: getComputedStyle(p).maxHeight,
      flex: getComputedStyle(p).display + '/' + getComputedStyle(p).flexDirection,
      scroll_el: !!sc, scroll_client: sc ? sc.clientHeight : 0, scroll_height: sc ? sc.scrollHeight : 0,
      overflow_y: sc ? getComputedStyle(sc).overflowY : 'n/a',
      mic_btn: !!document.querySelector('.nctrl-mic'), text_btn: !!document.querySelector('.nctrl-ico,.nctrl-txt button'),
      chip_count: document.querySelectorAll('.nm-chip,.np-chip').length,
      panel_bottom: Math.round(r.bottom),
    };
  });
  console.log(JSON.stringify(panel, null, 1));

  await page.screenshot({ path: path.join(OUT, 'audit_nono_panel.png') });
  await page.evaluate(() => { if (typeof nonoClose === 'function') nonoClose(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'audit_home.png') });

  console.log('\n=== 交互：跟读页按钮 ===');
  await page.evaluate(() => { if (typeof go === 'function') go('practice'); });
  await page.waitForTimeout(1400);
  const prac = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).borderRadius + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height) : 'n/a'; };
    const bare = [...document.querySelectorAll('#nono-practice button')].map(b => getComputedStyle(b).borderRadius);
    return { p_actions_btn: g('.p-actions .btn'), np_foot: g('.np-foot button'), syl: g('.syl'),
      rec: g('.record'), bare_practice_btns: bare.slice(0, 4) };
  });
  console.log(JSON.stringify(prac, null, 1));
  await page.screenshot({ path: path.join(OUT, 'audit_practice.png') });

  console.log('\n=== i18n 七语抽查 ===');
  const langs = await page.evaluate(async () => {
    const list = ['zh', 'es', 'ru', 'vi', 'id', 'th'];
    const res = {};
    for (const l of list) {
      try { const r = await fetch('langs/' + l + '.json?cb=' + Date.now()); const j = await r.json(); res[l] = r.status + ' keys=' + Object.keys(j).length; }
      catch (e) { res[l] = 'ERR ' + e.message; }
    }
    res.en = 'source(langs/en.json 不存在，英文为原文)';
    return res;
  });
  console.log(JSON.stringify(langs, null, 1));

  console.log('\nfailed requests:', failed.length ? failed : 'none');
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
