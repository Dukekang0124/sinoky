const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const p = await c.newPage();
  const captured = [];
  p.on('request', r => {
    const u = r.url();
    if (u.includes('/api/tts')) {
      try { captured.push(decodeURIComponent(u.split('text=')[1].split('&')[0])); } catch (e) {}
    }
  });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });
  await p.evaluate(() => openScene('emergency'));
  await p.waitForTimeout(900);

  // 点 "emergency number is 120" 主句播放
  const clicked120 = await p.evaluate(() => {
    const ph = [...document.querySelectorAll('#v-scene .phrase')].find(x => x.querySelector('.p-en') && x.querySelector('.p-en').textContent.includes('emergency number is 120'));
    if (ph) { ph.querySelector('.spk').click(); return true; }
    return false;
  });
  await p.waitForTimeout(800);

  // 点 "Call the police" 主句播放（回归：仍读幺幺零）
  const clicked110 = await p.evaluate(() => {
    const ph = [...document.querySelectorAll('#v-scene .phrase')].find(x => x.querySelector('.p-en') && x.querySelector('.p-en').textContent.includes('Call the police'));
    if (ph) { ph.querySelector('.spk').click(); return true; }
    return false;
  });
  await p.waitForTimeout(800);

  // 展开 120 的 real 变体并点 "打120！"
  const clickedReal = await p.evaluate(() => {
    const ph = [...document.querySelectorAll('#v-scene .phrase')].find(x => x.querySelector('.p-en') && x.querySelector('.p-en').textContent.includes('emergency number is 120'));
    if (!ph) return false;
    const tog = ph.querySelector('.real-toggle');
    if (tog) tog.click();
    const ri = [...ph.querySelectorAll('.real-item')].find(x => x.textContent.includes('打120'));
    if (ri) { ri.click(); return true; }
    return false;
  });
  await p.waitForTimeout(1000);

  console.log('T1 120 phrase play clicked:', clicked120);
  console.log('T2 110 phrase play clicked (regression):', clicked110);
  console.log('T3 120 real variant play clicked:', clickedReal);
  console.log('T4 captured texts:', JSON.stringify(captured));
  const yao20 = captured.some(t => t.includes('幺二零'));
  const yao10 = captured.some(t => t.includes('幺幺零'));
  const raw120 = captured.some(t => t.includes('120'));
  const raw110 = captured.some(t => t.includes('110'));
  console.log('T5 120 reads 幺二零 (true):', yao20);
  console.log('T6 110 reads 幺幺零 (true):', yao10);
  console.log('T7 no raw 120 chars (true):', !raw120);
  console.log('T8 no raw 110 chars (true):', !raw110);
  console.log('T9 zero JS errors:', errs.length === 0, errs.slice(0,3));

  const pass = clicked120 && clicked110 && yao20 && yao10 && !raw120 && !raw110 && errs.length === 0;
  console.log('\n=== RESULT:', pass ? 'PASS' : 'FAIL', '===');
  await b.close();
  process.exit(pass ? 0 : 1);
})();
