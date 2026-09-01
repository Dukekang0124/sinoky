/* Sinoky 正主验收 —— 连句训练 Sentences (v0.2.2)
   用法：NODE_PATH="C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules" node verify-sentences.cjs
   前置：python -m http.server 8125 已起 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8125';
const PASS = [], FAIL = [];
function check(n, ok, d){ (ok?PASS:FAIL).push(n + (d?' | '+d:'')); }

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
  check('T1 APP_VERSION = 0.2.2', ver === '0.2.2', 'got ' + ver);

  await page.click('#nav-sentences');
  await page.waitForTimeout(1500);
  const navTxt = await page.textContent('#nav-sentences');
  check('T2 nav has "Sentences"', /Sentences/.test(navTxt || ''), (navTxt || '').trim());

  const modeOn = await page.evaluate(() => document.querySelector('.sent-mode-btn.on') && document.querySelector('.sent-mode-btn.on').id);
  check('T3 default mode = completion', modeOn === 'sent-mode-completion', 'mode=' + modeOn);

  // Completion 第一题: front=因为我起晚了, keywords=[所以,迟到]. 全命中 = 通过.
  await page.fill('#sent-input', '所以我迟到了');
  await page.click('#sent-area button:text-is("Check")');
  await page.waitForTimeout(400);
  const res1 = await page.evaluate(() => {
    const b = document.getElementById('sent-result');
    return { ok: b && b.classList.contains('ok') };
  });
  check('T4 completion with all keywords passes', res1.ok === true, JSON.stringify(res1));

  // 切下一题, 输入无关内容, 应失败.
  await page.click('#sent-area button:text-is("Next →")');
  await page.waitForTimeout(400);
  await page.fill('#sent-input', 'something completely unrelated');
  await page.click('#sent-area button:text-is("Check")');
  await page.waitForTimeout(400);
  const res2 = await page.evaluate(() => {
    const b = document.getElementById('sent-result');
    return { bad: b && b.classList.contains('bad') };
  });
  check('T5 completion without keywords fails', res2.bad === true, JSON.stringify(res2));

  // 统计卡片应更新 (>=2 attempts)
  const statsTxt = await page.textContent('#sent-stats');
  check('T6 stats card updated', /Attempts:\s*[1-9]/.test(statsTxt || ''), (statsTxt || '').trim());

  // Connector 模式: 切到 Connector, 取正确答案 index
  await page.click('#sent-mode-connectors');
  await page.waitForTimeout(700);
  const optCount = await page.locator('.sent-option').count();
  check('T7 connector shows 3 options', optCount === 3, 'count=' + optCount);

  const correctIdx = await page.evaluate(() => {
    var t = SENT_TEMPLATES.connectors[SENT_IDX];
    return t.options.indexOf(t.answer);
  });
  await page.click('#sent-opt-' + correctIdx);
  await page.waitForTimeout(500);
  const connRes = await page.evaluate(() => {
    const b = document.getElementById('sent-result');
    return { ok: b && b.classList.contains('ok') };
  });
  check('T8 connector correct answer passes', connRes.ok === true, JSON.stringify(connRes));

  // Arrange 模式: 切过去, 词库应有点击词
  await page.click('#sent-mode-keywords');
  await page.waitForTimeout(700);
  const wbCount = await page.locator('.sent-word').count();
  check('T9 arrange shows wordbank', wbCount > 0, 'count=' + wbCount);

  // 点第一个词 → 应加入 input
  const before = await page.inputValue('#sent-input');
  await page.locator('.sent-word').first().click();
  await page.waitForTimeout(300);
  const after = await page.inputValue('#sent-input');
  check('T10 click word adds to input', after.length > before.length, before + ' -> ' + after);

  // 无中文 UI 残留
  const uiCn = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return (t.match(/完成|补全|连接词|关键词|连句/g) || []);
  });
  check('T11 no Chinese UI strings', uiCn.length === 0, uiCn.join(','));

  // 无横向溢出
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('T12 no horizontal overflow @390px', ov <= 0, 'overflow=' + ov);

  check('T13 zero JS errors', errors.length === 0, errors.slice(0,3).join(' ; '));

  console.log('\n===== PASS (' + PASS.length + ') =====');
  PASS.forEach(p => console.log('  PASS  ' + p));
  if (FAIL.length) { console.log('\n===== FAIL (' + FAIL.length + ') ====='); FAIL.forEach(f => console.log('  FAIL  ' + f)); }
  console.log('\n结果: ' + PASS.length + '/' + (PASS.length + FAIL.length));
  await browser.close();
  process.exit(FAIL.length ? 1 : 0);
})();