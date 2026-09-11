/* 补充诊断：右下角元素 / .btn CSS / 徽章气泡文案 / me 页杂散元素 / 触控目标明细 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8899';
const SEED = { phrases: { arrival: [0,1,2,3], chengdu: [0,1,2] }, streak: 7, onboarded: true,
  days: ['2026-09-09','2026-09-10','2026-09-11'], tone: { right: 18, total: 20 }, rv: {} };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript(s => { localStorage.setItem('sinoky_state', JSON.stringify(s)); localStorage.setItem('sinoky_lang','zh'); }, SEED);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { try { nonoMin(); } catch (e) {} });

  // 1) 右下角是什么
  const corner = await page.evaluate(() => {
    const pts = [[385, 800], [385, 820], [370, 790], [380, 812]];
    return pts.map(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      if (!e) return { pt: [x,y], el: null };
      const chain = [];
      let c = e; while (c && c !== document.body && chain.length < 4) { chain.push({ tag: c.tagName, id: c.id, cls: (c.className||'').toString().slice(0,36) }); c = c.parentElement; }
      return { pt: [x, y], chain, txt: (e.textContent||'').trim().slice(0, 30) };
    });
  });
  console.log('[右下角]', JSON.stringify(corner, null, 1));

  // 2) .btn 基础 CSS
  const btnCss = await page.evaluate(() => {
    const out = [];
    for (const ss of document.styleSheets) {
      try { for (const r of ss.cssRules) {
        if (r.selectorText && /(^|[\s,])\.btn(\s|$|\.|:|,)/.test(r.selectorText) && r.style && (r.style.width || r.style.flex))
          out.push(r.selectorText + ' {' + ['width','flex','min-width','box-sizing'].map(k => r.style[k] ? k+':'+r.style[k] : '').filter(Boolean).join(';') + '}');
      } } catch (e) {}
    }
    return out;
  });
  console.log('\n[.btn width/flex 规则]', JSON.stringify(btnCss, null, 1));

  // 3) 徽章气泡文案
  const badgeTxt = await page.evaluate(() => {
    const fns = Object.keys(window).filter(k => /badge/i.test(k));
    return { fns };
  });
  console.log('\n[badge 相关全局]', JSON.stringify(badgeTxt));

  // 4) me 页杂散元素（无可视文字但占位 / 空白块）
  await page.evaluate(() => go('me'));
  await page.waitForTimeout(1000);
  const meOdd = await page.evaluate(() => {
    const root = document.getElementById('v-me');
    const odd = [];
    root.querySelectorAll('*').forEach(e => {
      const b = e.getBoundingClientRect();
      if (b.height < 24 || b.width < 24) return;
      const own = Array.from(e.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
      if (!own && e.children.length === 0) odd.push({ tag: e.tagName, id: e.id, cls: (e.className||'').toString().slice(0,40),
        box: [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)] });
    });
    return odd.slice(0, 10);
  });
  console.log('\n[me 页空块]', JSON.stringify(meOdd));

  // 5) 触控目标明细（全站）
  const taps = [];
  for (const v of ['home','scene','days','prog','cities','me']) {
    if (v === 'scene') await page.evaluate(() => openScene('arrival', 1, 'home'));
    else await page.evaluate(x => go(x), v);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const out = [];
      const sc = document.querySelector('.views.on'); if (!sc) return out;
      sc.querySelectorAll('button,a,[onclick],[role=button]').forEach(e => {
        const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
        if (b.width === 0 || b.height === 0 || s.visibility === 'hidden') return;
        if (b.height < 44 || b.width < 44) out.push({ cls: (e.className||'').toString().slice(0,34), w: Math.round(b.width), h: Math.round(b.height), t: (e.textContent||'').trim().slice(0,20) });
      });
      return out;
    });
    if (r.length) taps.push({ v, n: r.length, sample: r.slice(0, 5) });
  }
  console.log('\n[小触控目标]', JSON.stringify(taps, null, 1));
  await browser.close();
})();
