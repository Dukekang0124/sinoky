/* 终局诊断：逐视图找出超出右边界的所有元素 + 徽章气泡文案源 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8899';
const SEED = { phrases: { arrival: [0,1,2,3], chengdu: [0,1,2] }, streak: 7, onboarded: true,
  days: ['2026-09-09','2026-09-10','2026-09-11'], tone: { right: 18, total: 20 }, rv: {},
  feat: { tone: 3, cards: 2, reading: 1, sentences: 4, prog: 5 } };
const VIEWS = ['home','practice','explore','prog','me','settings','cards','sentences','reading','days','cities','tone','dialog','review'];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript(s => {
    localStorage.setItem('sinoky_state', JSON.stringify(s));
    localStorage.setItem('sinoky_lang', 'zh');
    localStorage.setItem('sinoky_badges_on', JSON.stringify({ 'first-speak': 1, 'streak7': 1 }));
  }, SEED);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  for (const v of VIEWS) {
    await page.evaluate(x => { go(x); try { nonoMin(); } catch (e) {} }, v);
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad = [];
      document.querySelectorAll('*').forEach(e => {
        const b = e.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        if (b.right > vw + 1 && b.width > 3 && b.height > 3) {
          const s = getComputedStyle(e);
          if (s.position === 'fixed' || s.visibility === 'hidden' || +s.opacity < 0.05) return;
          bad.push({ cls: (e.className||'').toString().slice(0,44), tag: e.tagName, id: e.id,
                     l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height),
                     t: (e.textContent||'').trim().slice(0,28) });
        }
      });
      return { sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 8), hash: bad.length };
    });
    if (r.bad.length) console.log(`[${v}] scrollWidth=${r.sw} (vw=${r.vw}) 溢出元素 ${r.hash}:\n   ` + JSON.stringify(r.bad));
  }

  // Nono 气泡跨视图残留验证（不手动隐藏）
  await page.evaluate(() => { try { nonoToggle(); } catch (e) {} });
  await page.evaluate(() => go('cards'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => go('days'));
  await page.waitForTimeout(800);
  const linger = await page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    return { disp: p ? p.style.display : 'n/a', vis: p ? (getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0) : false,
             msg: ((document.getElementById('nono-msg')||{}).textContent||'').slice(0, 70) };
  });
  console.log('\n[Nono 残留] cards→days:', JSON.stringify(linger));

  // 徽章气泡原文
  await page.evaluate(() => {
    const on = ['streak3', 'first_city'];
    try { nonoBadgeToast ? nonoBadgeToast(on) : null; } catch (e) { console.log('no nonoBadgeToast', e.message); }
  });
  await page.waitForTimeout(500);
  const bt = await page.evaluate(() => ((document.getElementById('nono-msg')||{}).textContent||'').slice(0, 160));
  console.log('[徽章气泡]', JSON.stringify(bt));
  await browser.close();
})();
