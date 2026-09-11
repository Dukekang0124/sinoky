/* 定向定位：review 溢出源 / 导航重叠元素 / Nono 气泡跨视图残留 / 未转义 \\u{...} 字面量 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8899';
const SEED = { phrases: { arrival: [0,1,2,3], chengdu: [0,1,2] }, streak: 7, onboarded: true,
  days: ['2026-09-09','2026-09-10','2026-09-11'], tone: { right: 18, total: 20 }, rv: {} };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(s => {
    localStorage.setItem('sinoky_state', JSON.stringify(s));
    localStorage.setItem('sinoky_lang', 'zh');
  }, SEED);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 1) review 溢出源
  await page.evaluate(() => go('review'));
  await page.waitForTimeout(900);
  const ov = await page.evaluate(() => {
    const root = document.getElementById('v-review');
    const rw = root.getBoundingClientRect();
    const bad = [];
    root.querySelectorAll('*').forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width === 0) return;
      if (r.right > rw.right + 1 || r.left < rw.left - 1) {
        bad.push({ cls: (e.className||'').toString().slice(0,50), tag: e.tagName,
                   l: Math.round(r.left), rr: Math.round(r.right), w: Math.round(r.width),
                   t: (e.textContent||'').trim().slice(0,30) });
      }
    });
    return { root: { l: Math.round(rw.left), r: Math.round(rw.right), w: Math.round(rw.width) },
             docSW: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
             rootSW: root.scrollWidth, rootCW: root.clientWidth, bad: bad.slice(0, 14) };
  });
  console.log('=== review 溢出 ===');
  console.log(JSON.stringify(ov, null, 1));

  // 2) 底部导航区域重叠元素
  const navOverlap = await page.evaluate(() => {
    const nav = document.querySelector('body>nav');
    if (!nav) return { err: 'no nav' };
    const r = nav.getBoundingClientRect();
    const out = [];
    document.querySelectorAll('body *').forEach(e => {
      if (nav.contains(e)) return;
      if (!e.id && !e.className) return;
      const b = e.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return;
      const inter = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
      const interX = Math.min(b.right, r.right) - Math.max(b.left, r.left);
      if (inter > 4 && interX > 4) {
        const s = getComputedStyle(e);
        out.push({ id: e.id, cls: (e.className||'').toString().slice(0,40), z: s.zIndex,
                   pos: s.position, box: [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)],
                   t: (e.textContent||'').trim().slice(0,40) });
      }
    });
    return { navBox: [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], items: out };
  });
  console.log('\n=== 导航区域重叠 ===');
  console.log(JSON.stringify(navOverlap, null, 1));

  // 3) Nono 气泡跨视图残留
  await page.evaluate(() => { try { nonoClose && nonoClose(); } catch(e){} });
  await page.evaluate(() => go('cards'));
  await page.waitForTimeout(2500);
  const onCards = await page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    return { vis: p ? getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0 : false,
             msg: p ? (document.getElementById('nono-msg')||{}).textContent || '' : '' };
  });
  await page.evaluate(() => go('days'));
  await page.waitForTimeout(1200);
  const onDays = await page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    return { vis: p ? getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0 : false,
             msg: p ? (document.getElementById('nono-msg')||{}).textContent || '' : '' };
  });
  console.log('\n=== Nono 气泡跨视图 ===');
  console.log('cards:', JSON.stringify(onCards));
  console.log('days :', JSON.stringify(onDays));

  // 4) 页面里未转义的 \u{...} 字面量
  const leaks = await page.evaluate(() => {
    const found = [];
    const re = /\\u\{[0-9A-Fa-f]{4,6}\}/;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      const t = n.textContent || '';
      if (re.test(t)) found.push({ t: t.trim().slice(0, 110),
        p: n.parentElement ? (n.parentElement.className||n.parentElement.id||n.parentElement.tagName).toString().slice(0,40) : '' });
    }
    return found;
  });
  console.log('\n=== 页面渲染出的 \\u{...} 字面量 ===');
  console.log(JSON.stringify(leaks, null, 1));

  await browser.close();
})();
