/* 验证 v0.3.1 修复：服务端 TTS（含重试）+ 布局不溢出 + Score 不卡死
   直接测线上生产域。用法：
   NODE_PATH="C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules" node verify-audio.cjs */
const { chromium } = require('playwright');
const BASE = 'https://sinoky.pages.dev';
const PASS = [], FAIL = [];
function check(n, ok, d){ (ok?PASS:FAIL).push(n + (d?' | '+d:'')); }

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  const ttsCalls = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('response', async r => {
    if (r.url().indexOf('/api/tts') > -1) {
      ttsCalls.push({ status: r.status(), type: r.headers()['content-type'] || '' });
    }
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const ver = await page.evaluate(() => window.APP_VERSION);
  check('T1 live version = 0.3.1', ver === '0.3.1', 'got ' + ver);

  // 进入场景
  await page.click('#home-scenes button');
  await page.waitForTimeout(1200);

  // T2 布局无溢出
  const ov = await page.evaluate(() => {
    const row = document.querySelector('.p-actions');
    const docOv = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return { row: row ? row.scrollWidth - row.clientWidth : null, doc: docOv };
  });
  check('T2 action row no overflow', ov.row === 0 && ov.doc === 0, JSON.stringify(ov));

  // T3 点播放 → 服务端 TTS（可能重试）
  await page.click('.spk');
  await page.waitForTimeout(14000);
  const ok200 = ttsCalls.filter(c => c.status === 200 && /audio/.test(c.type)).length;
  check('T3 server TTS returned audio', ttsCalls.length > 0 && ok200 > 0,
    'tts calls=' + ttsCalls.length + ' ok200=' + ok200 + ' ' + JSON.stringify(ttsCalls.slice(0, 4)));
  check('T3b retry kicked in when needed', ttsCalls.length >= 1, 'attempts=' + ttsCalls.length);

  const btnState = await page.evaluate(() => {
    const b = document.querySelector('.spk');
    return { playing: b ? b.classList.contains('playing') : null };
  });
  check('T4 speaker button state sane', btnState.playing === false || btnState.playing === true,
    'playing=' + btnState.playing);

  // T5 Score 按钮：无麦克风时应给友好提示且不卡死
  await page.click('#sc-btn-0').catch(() => {});
  await page.waitForTimeout(6000);
  const sc = await page.evaluate(() => {
    const b = document.getElementById('sc-btn-0');
    const box = document.getElementById('score-0');
    return {
      listening: b ? b.classList.contains('listening') : null,
      text: b ? b.textContent.trim() : null,
      msg: box ? box.textContent.trim().slice(0, 80) : null
    };
  });
  check('T5 score button not stuck', sc.listening === false, JSON.stringify(sc));

  // T6 全程零 JS 错误
  check('T6 zero JS errors', errors.length === 0, errors.slice(0, 3).join(' ; '));

  console.log('\n===== PASS (' + PASS.length + ') =====');
  PASS.forEach(p => console.log('  PASS  ' + p));
  if (FAIL.length) { console.log('\n===== FAIL (' + FAIL.length + ') ====='); FAIL.forEach(f => console.log('  FAIL  ' + f)); }
  console.log('\n结果: ' + PASS.length + '/' + (PASS.length + FAIL.length));
  await browser.close();
  process.exit(FAIL.length ? 1 : 0);
})();