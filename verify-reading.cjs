/* Sinoky 正主验收 —— 沉浸阅读器 Reading (v0.3.0)
   用法：NODE_PATH="C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules" node verify-reading.cjs
   前置：python -m http.server 8125 已起 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8125';
const PASS = [], FAIL = [];
function check(n, ok, d){ (ok?PASS:FAIL).push(n + (d?' | '+d:'')); }
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
  check('T1 APP_VERSION = 0.3.0', ver === '0.3.0', 'got ' + ver);

  // T2 关键：首屏未加载 pinyin-pro（懒加载验证）
  const lazy1 = await page.evaluate(() => (typeof RDPY !== 'undefined') ? (RDPY === null) : 'undef');
  check('T2 pinyin-pro NOT loaded on first paint (lazy)', lazy1 === true, 'RDPY null? ' + lazy1);

  await page.click('#nav-reading');
  await page.waitForTimeout(900);

  // T3 进入阅读视图后仍未加载（要点 Read 才加载）
  const lazy2 = await page.evaluate(() => (typeof RDPY !== 'undefined') ? (RDPY === null) : 'undef');
  check('T3 still not loaded after switching tab', lazy2 === true, 'RDPY null? ' + lazy2);

  // T4 Sample 按钮填入文本
  await page.click('#v-reading button:text-is("Sample")');
  await page.waitForTimeout(500);
  const sampleTxt = await page.inputValue('#rd-input');
  check('T4 sample loads text', (sampleTxt || '').length > 10, (sampleTxt || '').slice(0, 24));

  // T5 点 Read → 分词渲染
  await page.click('#v-reading button:text-is("Read")');
  await page.waitForSelector('#rd-text .rd-seg', { timeout: 30000 }).catch(() => {});
  const segCount = await page.locator('.rd-seg').count();
  check('T5 segments rendered', segCount > 0, 'segments=' + segCount);

  // T6 拼音标注出现
  const pyCount = await page.locator('.rd-py').count();
  check('T6 pinyin annotations shown', pyCount > 0, 'pinyin spans=' + pyCount);

  // T7 点 Read 后 pinyin-pro 已加载
  const lazy3 = await page.evaluate(() => (typeof RDPY !== 'undefined') ? (RDPY !== null) : 'undef');
  check('T7 pinyin-pro loaded after Read', lazy3 === true, 'loaded? ' + lazy3);

  // T8 拼音开关
  await page.click('#rd-py-btn');
  await page.waitForTimeout(400);
  const nopy = await page.evaluate(() => document.getElementById('rd-text').classList.contains('nopy'));
  const btnTxt = await page.textContent('#rd-py-btn');
  check('T8 pinyin toggle works', nopy === true && /off/.test(btnTxt || ''), 'nopy=' + nopy + ' btn=' + btnTxt);
  await page.click('#rd-py-btn'); // 切回 on
  await page.waitForTimeout(300);

  // T9 点第一个中文词 → 弹卡
  await page.locator('.rd-seg').first().click();
  await page.waitForTimeout(600);
  const popOn = await page.evaluate(() => document.getElementById('rd-pop').classList.contains('on'));
  check('T9 word popup opens', popOn === true, 'on=' + popOn);

  // T10 弹卡有拼音 + 释义（释义应为英文）
  const popPy = await page.textContent('.rd-pop-py').catch(() => '');
  const popMean = await page.textContent('.rd-pop-mean').catch(() => '');
  check('T10 popup has pinyin', (popPy || '').trim().length > 0, (popPy || '').trim());
  check('T11 popup meaning is English', (popMean || '').trim().length > 0 && !HAS_CN.test(popMean), (popMean || '').trim());

  // T12 弹卡 Save → 生词本 +1
  const nwBefore = await page.textContent('#nw-count');
  await page.click('#rd-pop button:text-is("☆ Save")').catch(async () => {
    await page.click('#rd-pop button:has-text("Save")');
  });
  await page.waitForTimeout(700);
  const nwAfter = await page.textContent('#nw-count');
  check('T12 save from reading adds to wordbook', nwAfter !== nwBefore, nwBefore + ' -> ' + nwAfter);

  // T13 生词本支持词（切到 Cards 看条目存在）
  await page.click('#nav-cards');
  await page.waitForTimeout(900);
  const nwItems = await page.locator('.nw-item').count();
  check('T13 wordbook lists saved word', nwItems > 0, 'items=' + nwItems);

  // T14 无中文 UI 残留
  const uiCn = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return (t.match(/阅读|分词|粘贴|词典|生词本/g) || []);
  });
  check('T14 no Chinese UI strings', uiCn.length === 0, uiCn.join(','));

  // T15 无横向溢出
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('T15 no horizontal overflow @390px', ov <= 0, 'overflow=' + ov);

  check('T16 zero JS errors', errors.length === 0, errors.slice(0, 3).join(' ; '));

  console.log('\n===== PASS (' + PASS.length + ') =====');
  PASS.forEach(p => console.log('  PASS  ' + p));
  if (FAIL.length) { console.log('\n===== FAIL (' + FAIL.length + ') ====='); FAIL.forEach(f => console.log('  FAIL  ' + f)); }
  console.log('\n结果: ' + PASS.length + '/' + (PASS.length + FAIL.length));
  await browser.close();
  process.exit(FAIL.length ? 1 : 0);
})();
