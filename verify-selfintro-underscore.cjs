const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });

  const opened = await p.evaluate(() => { if (typeof openScene !== 'function') return false; openScene('self-intro'); return true; });
  await p.waitForTimeout(800);

  // 收集 self-intro 场景里所有拼音(py)文本和汉字(hz)文本
  const data = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#v-scene .phrase').forEach(ph => {
      const en = ph.querySelector('.p-en') ? ph.querySelector('.p-en').textContent.trim() : '';
      const py = ph.querySelector('.p-py') ? ph.querySelector('.p-py').textContent : '';
      const hz = ph.querySelector('.p-hz') ? ph.querySelector('.p-hz').textContent : '';
      out.push({ en, py, hz });
    });
    return out;
  });

  const targets = data.filter(x => /My name is|I'm from/.test(x.en));
  console.log('T1 self-intro opened:', opened);
  console.log('T2 phrase count:', data.length);
  console.log('T3 target phrases:', JSON.stringify(targets, null, 0));
  const anyUnder = data.some(x => /[_]/.test(x.py) || /[_]/.test(x.hz));
  console.log('T4 any underscore in py/hz (expected false):', anyUnder);
  console.log('T5 zero JS errors:', errs.length === 0, errs.slice(0,3));

  const pass = opened && data.length === 8 && targets.length === 2 && !anyUnder && errs.length === 0;
  console.log('\n=== RESULT:', pass ? 'PASS' : 'FAIL', '===');
  await b.close();
  process.exit(pass ? 0 : 1);
})();
