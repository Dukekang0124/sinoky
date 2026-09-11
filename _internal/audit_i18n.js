/* 权威 i18n 判定：T(s)!==s 说明有译文但没被应用（渲染 bug）；T(s)===s 说明字典真缺 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8899';
const SEED = { phrases: { arrival: [0,1,2,3], chengdu: [0,1,2] }, streak: 7, onboarded: true,
  days: ['2026-09-09','2026-09-10','2026-09-11'], tone: { right: 18, total: 20 }, rv: {},
  feat: { tone: 3, cards: 2, reading: 1, sentences: 4, prog: 5 } };
const VIEWS = ['home','practice','explore','prog','me','settings','cards','sentences','reading','days','cities','tone','dialog','review'];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript(s => { localStorage.setItem('sinoky_state', JSON.stringify(s)); localStorage.setItem('sinoky_lang','zh'); }, SEED);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log('lang =', await page.evaluate(() => (S.lang || 'en')), '| LANG_PACK keys =', await page.evaluate(() => Object.keys(LANG_PACK).length));

  const gap = {}, applyBug = {};
  for (const v of [...VIEWS, 'scene']) {
    await page.evaluate(x => {
      try { nonoMin(); } catch (e) {}
      if (x === 'scene') openScene('arrival', 1, 'home'); else go(x);
    }, v);
    await page.waitForTimeout(900);
    await page.evaluate(() => { try { nonoMin(); } catch (e) {} });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const sc = document.querySelector('.views.on'); if (!sc) return { gap: [], bug: [] };
      const g = [], b = [], seen = new Set();
      const w = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = (n.textContent || '').trim();
        if (t.length < 3 || !/^[A-Za-z0-9][A-Za-z0-9 ,.'!?&:/()·\-]{2,}$/.test(t)) continue;
        if (!/[A-Za-z]{2,}/.test(t)) continue;
        const p = n.parentElement; if (!p) continue;
        const r = p.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (p.closest('[data-i18n-skip]')) continue;
        if (seen.has(t)) continue; seen.add(t);
        let tr = t; try { tr = T(t); } catch (e) {}
        if (tr && tr !== t) b.push(t); else g.push(t);
      }
      return { gap: g, bug: b };
    });
    r.gap.forEach(x => gap[x] = (gap[x] || 0) + 1);
    r.bug.forEach(x => applyBug[x] = (applyBug[x] || 0) + 1);
  }
  require('fs').writeFileSync('D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/_internal/i18n_gaps.json', JSON.stringify({gap:Object.keys(gap).sort(), bug:Object.keys(applyBug).sort()}, null, 1));
  console.log('\n=== ❌ 字典真缺 ===');
  Object.keys(gap).sort().forEach(k => console.log('  ' + JSON.stringify(k)));
  console.log('\n=== ⚠ 有译文但未应用（T(s)!==s，渲染/观察器漏了）===');
  Object.keys(applyBug).sort().forEach(k => console.log('  ' + JSON.stringify(k)));
  await browser.close();
})();
