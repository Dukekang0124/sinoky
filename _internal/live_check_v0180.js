/* v0.18.0 生产环境真浏览器终验 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const OUT = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/_internal';
const BASE = 'https://sinoky.pages.dev';
const SEED = { phrases: { arrival: [0,1,2,3], chengdu: [0,1,2] }, streak: 7, onboarded: true,
  days: ['2026-09-09','2026-09-10','2026-09-11'], tone: { right: 18, total: 20 }, rv: {} };
const out = []; const ok = (n, p, i) => out.push({ n, pass: !!p, info: String(i == null ? '' : i) });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(s => { localStorage.setItem('sinoky_state', JSON.stringify(s)); localStorage.setItem('sinoky_lang','zh'); }, SEED);
  const page = await ctx.newPage();
  const errs = [], bad = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('response', r => { if (r.status() >= 400 && !r.url().startsWith('data:')) bad.push(r.status() + ' ' + r.url()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  ok('生产页 APP_VERSION = 0.18.0', await page.evaluate(() => APP_VERSION) === '0.18.0', await page.evaluate(() => APP_VERSION));
  ok('语言包已加载(zh)', await page.evaluate(() => Object.keys(LANG_PACK).length >= 1 && !!LANG_PACK.zh), await page.evaluate(() => Object.keys(LANG_PACK).join(',')));

  // 逐视图：零横向溢出 + 零转义泄漏 + 中文
  const ovf = [], leak = [];
  for (const v of ['home','practice','explore','prog','me','settings','cards','sentences','reading','days','cities','tone','dialog','review']) {
    await page.evaluate(x => { try{nonoMin();}catch(e){} go(x); }, v);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const found = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const t = n.textContent || '';
        if (/\\u\{[0-9A-Fa-f]{4,6}\}/.test(t)) { const p = n.parentElement; if (p && p.closest('script,style')) continue; found.push(t.trim().slice(0,40)); } }
      return { f: found.slice(0,2), sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth };
    });
    if (r.f.length) leak.push(v + ':' + r.f.join('|'));
    if (r.sw > r.vw + 1) ovf.push(`${v}(${r.sw}>${r.vw})`);
  }
  ok('生产全站零横向溢出', ovf.length === 0, ovf.join(' ; ') || '(none)');
  ok('生产全站零转义泄漏', leak.length === 0, leak.join(' ; ') || '(none)');

  // 中文渲染实证
  await page.evaluate(() => go('days')); await page.waitForTimeout(800);
  const d = await page.evaluate(() => ({
    count: (document.getElementById('days-count')||{}).textContent || '',
    first: (document.getElementById('v-days')||{innerText:''}).innerText || ''
  }));
  ok('天数计数器已中文化', /第\s*\d+\s*天/.test(d.count), d.count);
  ok('天数标题已中文化', d.first.indexOf('第 1 天') >= 0, d.first.slice(0, 40).replace(/\s+/g,' '));

  await page.evaluate(() => go('cities')); await page.waitForTimeout(800);
  const c = await page.evaluate(() => ({ n: (document.getElementById('city-count')||{}).textContent||'', hk: document.body.innerText.includes('中国香港') }));
  ok('城市计数已中文化', /个城市/.test(c.n), c.n);
  ok('中国香港标注在位', c.hk, '');

  await page.evaluate(() => { try{nonoMin();}catch(e){} go('review'); }); await page.waitForTimeout(900);
  const rv = await page.evaluate(() => ({
    h: (document.querySelector('#v-review h2')||{}).textContent || '',
    cnt: (document.getElementById('rv-count')||{}).textContent || '',
    sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth
  }));
  ok('复习页标题无转义', /u\{1F501\}/.test(rv.h) === false && rv.h.indexOf('Smart review') >= 0, rv.h);
  ok('复习计数已中文化', /条待复习/.test(rv.cnt), rv.cnt);
  ok('复习页无横向溢出', rv.sw <= rv.vw + 1, `${rv.sw}/${rv.vw}`);

  // 诺诺气泡不串页
  await page.evaluate(() => { try{ nonoToggle(); }catch(e){} });
  await page.evaluate(() => go('cards')); await page.waitForTimeout(1500);
  await page.evaluate(() => go('days')); await page.waitForTimeout(700);
  const linger = await page.evaluate(() => { const p = document.getElementById('nono-panel'); return p ? (getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0) : false; });
  ok('生产环境诺诺气泡不串页', linger === false, 'visible=' + linger);

  ok('零运行时 JS 错误', errs.length === 0, errs.slice(0,3).join(' | '));
  const realBad = bad.filter(u => !/\/api\/(register|profile|badge|events)/.test(u));
  ok('无异常失败请求（排除本地化端点）', realBad.length === 0, realBad.slice(0,4).join(' | ') || '(none)');

  await page.evaluate(() => go('review')); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'v0180_live_review.png') });
  await page.evaluate(() => go('days')); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'v0180_live_days.png') });

  const pass = out.filter(x => x.pass).length;
  console.log('\n===== v0.18.0 生产终验 =====');
  out.forEach(x => console.log(`  ${x.pass ? 'PASS' : 'FAIL'}  ${x.n}${x.info ? '  :: ' + x.info : ''}`));
  console.log(`\n合计 ${pass}/${out.length}`);
  fs.writeFileSync(path.join(OUT, 'v0180_live_verify.json'), JSON.stringify(out, null, 1), 'utf8');
  await browser.close();
})();
