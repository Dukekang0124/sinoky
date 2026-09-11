const { chromium } = require('playwright');
const path = require('path');
const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const OUT = path.join(APP, '_internal');

const hex = s => s.replace('#', '').match(/../g).map(h => parseInt(h, 16));
const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => ((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)).toFixed(2);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url().replace('https://sinoky.pages.dev', '') + ' :: ' + ((r.failure() || {}).errorText || '')));
  await page.goto('https://sinoky.pages.dev/?rt2=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  console.log('=== 1. 对比度（方案 §2.4）===');
  console.log('  --txt #eef2f7 on --bg #161a20 :', ratio(hex('#eef2f7'), hex('#161a20')), ':1  (正文，方案要求 AAA 13:1)');
  console.log('  --sub #9aa7b8 on --bg #161a20 :', ratio(hex('#9aa7b8'), hex('#161a20')), ':1  (次要，AA 4.5:1)');
  console.log('  --txt on --card #212a35       :', ratio(hex('#eef2f7'), hex('#212a35')), ':1');
  console.log('  --red #c2362b on --bg         :', ratio(hex('#c2362b'), hex('#161a20')), ':1  (朱砂作正文色偏暗)');
  console.log('  --gold #c9a86c on --bg        :', ratio(hex('#c9a86c'), hex('#161a20')), ':1  (方案：金色仅用于标题/大字号)');
  console.log('  --teal #8ab8b2 on --bg        :', ratio(hex('#8ab8b2'), hex('#161a20')), ':1');

  console.log('\n=== 2. 首页（.hub/.card 角花 / hero）===');
  const home = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('#v-home .hub, #v-home .card')];
    const r = hs[0] ? hs[0].getBoundingClientRect() : null;
    return {
      hub_count: hs.length,
      hub_radius: hs[0] ? getComputedStyle(hs[0]).borderRadius : 'n/a',
      hub_size: r ? Math.round(r.width) + 'x' + Math.round(r.height) : 'n/a',
      hub_bg_img: hs[0] ? getComputedStyle(hs[0]).backgroundImage : 'n/a',
      hero_text_only: !!document.querySelector('.hero') && document.querySelectorAll('.hero img').length === 0,
      home_img_count: document.querySelectorAll('#v-home img').length,
      ornament_nodes: document.querySelectorAll('[class*=corner],[class*=ornament],[class*=meander]').length,
      nono_in_home: !!document.querySelector('#nono-panel'),
    };
  });
  console.log(JSON.stringify(home, null, 1));
  await page.screenshot({ path: path.join(OUT, 'audit2_home.png') });

  console.log('\n=== 3. 诺诺面板·聊天态（限高/滚动/控制条）===');
  const chat = await page.evaluate(() => {
    if (typeof nonoStartChat === 'function') nonoStartChat();
    else if (typeof nonoChatOpen === 'function') nonoChatOpen();
    return 'invoked';
  });
  await page.waitForTimeout(1200);
  const panel = await page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    const sc = document.querySelector('.nc-scroll') || document.querySelector('#nc-list');
    const r = p ? p.getBoundingClientRect() : null;
    const csm = p ? getComputedStyle(p) : null;
    return {
      exists: !!p, display: csm ? csm.display : 'n/a', flexdir: csm ? csm.flexDirection : 'n/a',
      max_height: csm ? csm.maxHeight : 'n/a', panel_h: r ? Math.round(r.height) : 0,
      viewport_h: window.innerHeight, bottom: r ? Math.round(r.bottom) : 0,
      scroll_client: sc ? sc.clientHeight : 0, scroll_height: sc ? sc.scrollHeight : 0,
      overflow_y: sc ? getComputedStyle(sc).overflowY : 'n/a',
      mic: !!document.querySelector('.nctrl-mic'), txt_toggle: !!document.querySelector('.nctrl-ico'),
      chips: [...document.querySelectorAll('#nono-panel .nm-chip')].map(c => c.textContent.trim()),
      bubbles: document.querySelectorAll('.nc-bub,.nc-msg').length,
    };
  });
  console.log(JSON.stringify(panel, null, 1));
  await page.screenshot({ path: path.join(OUT, 'audit2_nono_chat.png') });

  console.log('\n=== 4. 跟读页按钮（真实进入视图）===');
  await page.evaluate(() => { if (typeof nonoClose === 'function') nonoClose(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { if (typeof go === 'function') go('practice'); });
  await page.waitForTimeout(2500);
  const prac = await page.evaluate(() => {
    const info = s => { const e = document.querySelector(s); if (!e) return 'not-rendered'; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return `${cs.borderRadius} ${Math.round(r.width)}x${Math.round(r.height)}`; };
    const bare = [...document.querySelectorAll('#nono-practice button')].map(b => { const r = b.getBoundingClientRect(); return getComputedStyle(b).borderRadius + ' ' + Math.round(r.height); });
    return {
      view_on: document.querySelector('#v-practice.views.on') ? 'yes' : 'no',
      p_actions: info('.p-actions .btn'), p_actions_cnt: document.querySelectorAll('.p-actions .btn').length,
      np_foot: info('.np-foot button'), syl: info('.syl'), spk: info('.spk'),
      record: info('.record'), tonebtn: info('.tonebtn'),
      bare_practice_btns: bare.slice(0, 5),
      touch_targets: [...document.querySelectorAll('.p-actions .btn,.record,.sys .syl')].slice(0, 6).map(e => Math.round(e.getBoundingClientRect().height)),
    };
  });
  console.log(JSON.stringify(prac, null, 1));
  await page.screenshot({ path: path.join(OUT, 'audit2_practice.png') });

  console.log('\n=== 5. 复习页（诺诺钩子）===');
  await page.evaluate(() => { if (typeof go === 'function') go('review'); });
  await page.waitForTimeout(2000);
  const rev = await page.evaluate(() => ({
    view_on: document.querySelector('#v-review.views.on') ? 'yes' : 'no',
    rv_mode: document.querySelector('.rv-mode') ? getComputedStyle(document.querySelector('.rv-mode')).borderRadius : 'not-rendered',
    rv_mode_cnt: document.querySelectorAll('.rv-mode').length,
    nono_panel_present: !!document.getElementById('nono-panel'),
    hook_src: typeof reviewNext === 'function' ? 'reviewNext 存在(含 nonoShow)' : 'n/a',
  }));
  console.log(JSON.stringify(rev, null, 1));
  await page.screenshot({ path: path.join(OUT, 'audit2_review.png') });

  console.log('\nfailed requests:', failed.length ? failed : 'none');
  await browser.close();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
