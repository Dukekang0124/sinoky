const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8123/index.html';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  const errs = [];
  // getDate mock → 期望轮换结果（(d-1)%3：1→b1, 2→b2, 3→b3, 15→b3, 31→b1）
  const expect = { 1: 'b1-restaurant', 2: 'b2-offline', 3: 'b3-door', 15: 'b3-door', 31: 'b1-restaurant' };
  for (const day of Object.keys(expect)) {
    const page = await browser.newPage();
    page.on('pageerror', e => errs.push('day' + day + ' pageerror: ' + e));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('day' + day + ' console: ' + m.text()); });
    await page.addInitScript('(() => { const d = Number(' + day + '); Date.prototype.getDate = function(){ return d; }; })();');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async (day) => {
      const html = bannerHtml();
      const m = html.match(/assets\/banner\/([^']+)\.webp/);
      const name = m ? m[1] : null;
      const box = document.getElementById('me-banner');
      const uiSrc = (box && typeof bannerHtml === 'function') ? (box.innerHTML = html, (box.querySelector('img') || {}).src || null) : null;
      const ok = await new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = 'assets/banner/' + name + '.webp'; });
      return { name, ok, uiSrc };
    }, day);
    const pass = r.name === expect[day] && r.ok === true;
    results.push('day=' + day + ' expect=' + expect[day] + ' got=' + r.name + ' imgLoaded=' + r.ok + ' uiSrc=' + (r.uiSrc || 'n/a') + ' -> ' + (pass ? 'OK' : 'FAIL'));
    await page.close();
  }
  const p2 = await browser.newPage();
  p2.on('pageerror', e => errs.push('splash pageerror: ' + e));
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  const splashOk = await p2.evaluate(() => new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth + 'x' + i.naturalHeight); i.onerror = () => res(false); i.src = 'assets/splash/a8_9x16.webp?t=' + Date.now(); }));
  results.push('splash new image load -> ' + splashOk);
  const legacy = await p2.evaluate(() => new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = 'assets/banner/square.webp?t=' + Date.now(); }));
  results.push('legacy square.webp still served -> ' + legacy);
  await browser.close();
  console.log(results.join('\n'));
  if (errs.length) { console.log('PAGE_ERRORS:\n' + errs.join('\n')); process.exit(2); }
  const allOk = results.every(r => !r.includes('FAIL')) && String(splashOk) === '1080x1920' && legacy === true;
  console.log(allOk ? 'SMOKE_ALL_OK' : 'SMOKE_FAIL');
  process.exit(allOk ? 0 : 3);
})().catch(e => { console.error('FATAL', e); process.exit(3); });
