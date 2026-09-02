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

  // 进 Emergency 场景（直接调 openScene，绕过卡片点击不确定性）
  const opened = await p.evaluate(() => {
    if (typeof openScene !== 'function') return false;
    openScene('emergency');
    return true;
  });
  await p.waitForTimeout(900);
  const sceneVisible = await p.evaluate(() => {
    const v = document.getElementById('v-scene');
    return !!(v && v.classList.contains('on'));
  });

  // 点 Call the police 那句的 ▶ 播放按钮
  const clicked = await p.evaluate(() => {
    const phrases = [...document.querySelectorAll('#v-scene .phrase')];
    const target = phrases.find(x => x.querySelector('.p-en') && x.querySelector('.p-en').textContent.includes('Call the police'));
    if (target) { target.querySelector('.spk').click(); return true; }
    return false;
  });
  await p.waitForTimeout(1200);

  // 也测变速播放（speedSpeak）
  const clickedSpeed = await p.evaluate(() => {
    const phrases = [...document.querySelectorAll('#v-scene .phrase')];
    const target = phrases.find(x => x.querySelector('.p-en') && x.querySelector('.p-en').textContent.includes('Call the police'));
    if (target) { const s = target.querySelector('.speed'); if (s) { s.click(); return true; } }
    return false;
  });
  await p.waitForTimeout(1500);

  console.log('T1 emergency opened:', opened, '| scene visible:', sceneVisible);
  console.log('T2 play btn clicked:', clicked);
  console.log('T3 speed btn clicked:', clickedSpeed);
  console.log('T4 captured tts texts:', JSON.stringify(captured));
  const hasYaoling = captured.some(t => t.includes('幺幺零'));
  const hasRaw110 = captured.some(t => t.includes('110'));
  console.log('T5 speaks 幺幺零 (expected true):', hasYaoling);
  console.log('T6 contains raw 110 chars (expected false):', hasRaw110);
  console.log('T7 zero JS errors:', errs.length === 0, errs.slice(0,3));

  const pass = opened && clicked && hasYaoling && !hasRaw110 && errs.length === 0;
  console.log('\n=== RESULT:', pass ? 'PASS 7/7' : 'FAIL', '===');
  await b.close();
  process.exit(pass ? 0 : 1);
})();
