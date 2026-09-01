/* 诊断康哥报的 4 个 bug：播放无声 / Score 卡 listening / 布局溢出 / slow 无反应 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8125';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', r => {
    const u = r.url();
    if (/tts|translate|speech|baidu|score|api/i.test(u)) reqs.push(r.method() + ' ' + u.slice(0, 100));
  });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 进入第一个场景
  await page.click('#home-scenes button');
  await page.waitForTimeout(1200);

  // 1) 布局诊断：p-actions 三按钮是否溢出
  const layout = await page.evaluate(() => {
    const row = document.querySelector('.p-actions');
    if (!row) return null;
    return {
      scrollW: row.scrollWidth,
      clientW: row.clientWidth,
      overflow: row.scrollWidth - row.clientWidth,
      btns: [...row.querySelectorAll('button')].map(b => ({
        text: b.textContent.trim(),
        w: Math.round(b.getBoundingClientRect().width),
        right: Math.round(b.getBoundingClientRect().right)
      }))
    };
  });
  console.log('=== [1] p-actions 布局（操作行）===');
  console.log(JSON.stringify(layout, null, 1));
  const docOv = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('页面横向溢出:', docOv);

  // 2) 点播放按钮，看发起了什么请求
  console.log('\n=== [2] 点播放按钮 ▶ ===');
  await page.click('.spk');
  await page.waitForTimeout(3000);
  console.log('音频相关请求:', reqs.length ? reqs.join('\n  ') : '(无请求)');
  const audioState = await page.evaluate(() => {
    const a = document.querySelector('audio');
    return { hasAudioEl: !!a, speechSynthesisSupported: 'speechSynthesis' in window, voices: (window.speechSynthesis ? speechSynthesis.getVoices().length : -1) };
  });
  console.log('音频环境:', JSON.stringify(audioState));

  // 3) 点 Score（麦克风）
  console.log('\n=== [3] 点 Score ===');
  const srSupported = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  console.log('SpeechRecognition 可用:', srSupported);
  await page.click('#sc-btn-0').catch(e => console.log('click err', e.message));
  await page.waitForTimeout(3000);
  const btnState = await page.evaluate(() => {
    const b = document.getElementById('sc-btn-0');
    const row = b && b.closest('.p-actions');
    return {
      text: b ? b.textContent.trim() : null,
      listening: b ? b.classList.contains('listening') : null,
      rowOverflow: row ? (row.scrollWidth - row.clientWidth) : null,
      rowScrollW: row ? row.scrollWidth : null,
      rowClientW: row ? row.clientWidth : null,
      resultBox: (document.getElementById('score-0') || {}).textContent
    };
  });
  console.log(JSON.stringify(btnState, null, 1));

  // 4) 点 slow
  console.log('\n=== [4] 点 slow ===');
  const before = reqs.length;
  await page.click('.speed').catch(e => console.log('slow click err', e.message));
  await page.waitForTimeout(2500);
  console.log('slow 触发的请求:', reqs.slice(before).join('\n  ') || '(无)');

  console.log('\n=== JS 错误 ===');
  console.log(errs.length ? errs.join('\n') : '(无)');
  await browser.close();
})();
