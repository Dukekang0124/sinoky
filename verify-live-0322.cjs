// verify-live-0322.cjs — 线上真机验收 0.3.22（Playwright + 系统 Chrome）
const { chromium } = require('playwright');
(async () => {
  const errors = [];
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ hasTouch: true, isMobile: true });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));

  await page.goto('https://sinoky.pages.dev/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  const verObj = await page.evaluate(async () => {
    try { const r = await fetch('/version.json'); return await r.json(); } catch (e) { return null; }
  });
  const liveVer = verObj && verObj.version;

  async function sceneText(id) {
    await page.evaluate((sid) => { if (typeof openScene === 'function') openScene(sid); }, id);
    await page.waitForTimeout(800);
    return await page.evaluate(() => {
      const el = document.getElementById('v-scene');
      return el ? el.innerText : document.body.innerText;
    });
  }

  const arrival = await sceneText('arrival');
  const food = await sceneText('food');
  const emergency = await sceneText('emergency');

  const checks = [];
  const add = (n, c) => checks.push({ n, c: !!c });
  add('线上版本 0.3.22', liveVer === '0.3.22');
  add('arrival 含 洗手间', arrival.includes('洗手间'));
  add('food 含 请给我水', food.includes('请给我水'));
  add('food 含 我不吃肉', food.includes('我不吃肉'));
  add('emergency 含 过敏', emergency.includes('过敏'));
  add('emergency 含 我的手机丢了', emergency.includes('我的手机丢了'));
  add('emergency 含 我的钱包丢了', emergency.includes('我的钱包丢了'));
  add('emergency 无 "My phone / wallet" 合并残留', !emergency.includes('My phone / wallet'));

  let pass = 0, fail = 0;
  console.log('线上版本:', liveVer);
  checks.forEach(c => { if (c.c) { pass++; console.log('  PASS  ' + c.n); } else { fail++; console.log('  FAIL  ' + c.n); } });
  console.log('JS 错误数: ' + errors.length);
  errors.slice(0, 8).forEach(e => console.log('   ! ' + e));
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败' + (errors.length ? ' (有 JS 错误)' : ' (零 JS 错误)'));
  await browser.close();
  process.exit((fail || errors.length) ? 1 : 0);
})();
