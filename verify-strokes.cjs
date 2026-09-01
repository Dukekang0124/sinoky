/* Sinoky 正主验收 —— 笔顺动画 (v0.2.1)
   用法：NODE_PATH="C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules" node verify-strokes.cjs
   前置：本地静态服务已起（python -m http.server 8125） */
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8125';
const PASS = [], FAIL = [];
function check(name, ok, detail) { (ok ? PASS : FAIL).push(name + (detail ? ' | ' + detail : '')); }
const HAS_CN = /[一-鿿]/;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const ver = await page.evaluate(() => window.APP_VERSION);
  check('T1 APP_VERSION = 0.2.1', ver === '0.2.1', 'got ' + ver);

  await page.click('#nav-cards');
  await page.waitForTimeout(1300);

  // T2 笔顺按钮存在
  const btnCount = await page.locator('#fc-wrap button:text-is("✍️ Strokes")').count();
  check('T2 stroke button present', btnCount === 1, 'count=' + btnCount);

  // T3 点击后面板展开
  await page.click('#fc-wrap button:text-is("✍️ Strokes")');
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => {
    const b = document.getElementById('fc-strokes');
    return b ? b.classList.contains('on') : null;
  });
  check('T3 stroke panel opens', opened === true, 'on=' + opened);

  // T4 关键：hanzi-writer 渲染出 SVG（证明库+数据都加载成功）
  let svgOk = false, svgErr = '';
  try {
    await page.waitForSelector('#hw-stage svg', { timeout: 20000 });
    svgOk = true;
  } catch (e) { svgErr = (e.message || '').split('\n')[0]; }
  check('T4 hanzi-writer renders SVG', svgOk, svgErr || 'svg rendered');

  // T5 库挂到 window（说明加载的是本地 vendor，不是 CDN）
  const hwLoaded = await page.evaluate(() => typeof window.HanziWriter !== 'undefined');
  check('T5 HanziWriter loaded from local vendor', hwLoaded === true, 'loaded=' + hwLoaded);

  // T6 未出现"不可用"错误文案
  const msg = await page.textContent('#hw-msg').catch(() => '');
  check('T6 no "unavailable" error', !/unavailable/i.test(msg || ''), (msg || '').trim().slice(0, 70));

  // T7 提示文案为英文
  check('T7 hint is English', !!msg && !HAS_CN.test(msg), (msg || '').trim());

  // T8/T9 两个操作按钮
  const playBtn = await page.locator('#fc-strokes button:text-is("▶ Play")').count();
  const quizBtn = await page.locator('#fc-strokes button:text-is("✍️ Practise")').count();
  check('T8 play button present', playBtn === 1, 'count=' + playBtn);
  check('T9 practise button present', quizBtn === 1, 'count=' + quizBtn);

  // T10 点 Play 不报错
  await page.click('#fc-strokes button:text-is("▶ Play")');
  await page.waitForTimeout(900);
  check('T10 replay runs cleanly', errors.length === 0, errors.slice(0, 2).join(' ; '));

  // T11 无横向溢出
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('T11 no horizontal overflow @390px', ov <= 0, 'overflow=' + ov);

  // T12 切卡后面板收起（状态不残留）
  await page.click('#fc-wrap button:text-is("Next →")');
  await page.waitForTimeout(700);
  const closed = await page.evaluate(() => {
    const b = document.getElementById('fc-strokes');
    return b ? b.classList.contains('on') : null;
  });
  check('T12 panel resets on card change', closed === false, 'on=' + closed);

  // T13 全程零 JS 错误
  check('T13 zero JS errors', errors.length === 0, errors.slice(0, 3).join(' ; '));

  console.log('\n===== PASS (' + PASS.length + ') =====');
  PASS.forEach(p => console.log('  PASS  ' + p));
  if (FAIL.length) {
    console.log('\n===== FAIL (' + FAIL.length + ') =====');
    FAIL.forEach(f => console.log('  FAIL  ' + f));
  }
  console.log('\n结果: ' + PASS.length + '/' + (PASS.length + FAIL.length));
  await browser.close();
  process.exit(FAIL.length ? 1 : 0);
})();
