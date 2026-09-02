const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const p = await c.newPage();
  const captured = [];
  p.on('request', r => {
    const u = r.url();
    if (u.includes('/api/tts')) {
      try {
        const t = decodeURIComponent(u.split('text=')[1].split('&')[0]);
        captured.push(t);
      } catch (e) {}
    }
  });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });

  const opened = await p.evaluate(() => { if (typeof openScene !== 'function') return false; openScene('emergency'); return true; });
  await p.waitForTimeout(900);
  const sceneVisible = await p.evaluate(() => { const v = document.getElementById('v-scene'); return !!(v && v.classList.contains('on')); });

  // 取 emergency 场景所有短语的英文标签（用于定位）
  const labels = await p.evaluate(() => [...document.querySelectorAll('#v-scene .phrase .p-en')].map(x => x.textContent.trim()));

  // 点 119 主句播放
  const clickByEn = async (kw) => p.evaluate((kw) => {
    const phrases = [...document.querySelectorAll('#v-scene .phrase')];
    const t = phrases.find(x => x.querySelector('.p-en') && x.querySelector('.p-en').textContent.includes(kw));
    if (t) { t.querySelector('.spk').click(); return true; }
    return false;
  }, kw);
  const clickReal = async (kw) => p.evaluate((kw) => {
    const phrases = [...document.querySelectorAll('#v-scene .phrase')];
    const t = phrases.find(x => x.querySelector('.p-en') && x.querySelector('.p-en').textContent.includes(kw));
    if (t) { const rt = t.querySelector('.real-toggle'); if (rt) rt.click(); }
    const items = [...t.querySelectorAll('.real-item')];
    if (items.length) { items[items.length - 1].click(); return true; }
    return false;
  }, kw);

  const c119 = await clickByEn('Call 119');
  await p.waitForTimeout(1200);
  const c119r = await clickReal('Call 119');
  await p.waitForTimeout(1200);
  const c110 = await clickByEn('Call the police');
  await p.waitForTimeout(1200);
  const c120 = await clickByEn('emergency number is 120');
  await p.waitForTimeout(1200);
  const c120r = await clickReal('emergency number is 120');
  await p.waitForTimeout(1200);

  console.log('labels found:', JSON.stringify(labels));
  console.log('T1 emergency opened:', opened, '| visible:', sceneVisible);
  console.log('T2 119 play clicked:', c119, '| T3 119 real clicked:', c119r);
  console.log('T4 110 play clicked:', c110, '| T5 120 play clicked:', c120, '| T6 120 real clicked:', c120r);
  console.log('T7 captured tts texts:', JSON.stringify(captured));

  const hasYaoyaojiu = captured.some(t => t.includes('幺幺九'));
  const hasRaw119 = captured.some(t => t.includes('119'));
  const hasYaoling = captured.some(t => t.includes('幺幺零'));
  const hasYa0er0ling = captured.some(t => t.includes('幺二零'));
  const hasRaw110 = captured.some(t => t.includes('110'));
  const hasRaw120 = captured.some(t => t.includes('120'));

  console.log('T8 119 reads 幺幺九 (exp true):', hasYaoyaojiu, '| no raw 119 (exp false):', hasRaw119);
  console.log('T9 110 reads 幺幺零 (exp true):', hasYaoling, '| no raw 110 (exp false):', hasRaw110);
  console.log('T10 120 reads 幺二零 (exp true):', hasYa0er0ling, '| no raw 120 (exp false):', hasRaw120);
  console.log('T11 zero JS errors:', errs.length === 0, errs.slice(0,3));

  const pass = opened && sceneVisible && c119 && c119r && hasYaoyaojiu && !hasRaw119 && hasYaoling && !hasRaw110 && hasYa0er0ling && !hasRaw120 && errs.length === 0;
  console.log('\n=== RESULT:', pass ? 'PASS 11/11' : 'FAIL', '===');
  await b.close();
  process.exit(pass ? 0 : 1);
})();
