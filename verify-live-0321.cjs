// 线上真机验收：确认 0.3.21 已生效（self-intro 的 student/teacher 已拆成两句独立短语）
const { chromium } = require('playwright');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const errors = [];
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto('https://sinoky.pages.dev/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  const res = await page.evaluate(() => {
    try {
      if (typeof openScene !== 'function') return { err: 'openScene not a function' };
      openScene('self-intro');
    } catch (e) { return { err: String(e) }; }
    const v = document.querySelector('#v-scene');
    const text = v ? v.innerText : '';
    return {
      hasStudent: /I'm a student\./i.test(text),
      hasTeacher: /I'm a teacher\./i.test(text),
      noCombined: !/student \/ teacher/i.test(text)
    };
  });
  await page.waitForTimeout(400);
  await browser.close();

  console.log('RESULT:', JSON.stringify(res, null, 2));
  console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');

  const ok = res && res.hasStudent && res.hasTeacher && res.noCombined && errors.length === 0;
  console.log(ok ? 'LIVE_VERIFY: PASS' : 'LIVE_VERIFY: FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
