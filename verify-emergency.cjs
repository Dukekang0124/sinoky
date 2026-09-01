const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR:' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text()); });
  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });
  await p.waitForTimeout(500);

  // T1 首页存在 emergency 卡
  const cardCount = await p.locator('.card', { hasText: 'Emergency · Survival' }).count();
  console.log('T1 emergency card on home:', cardCount > 0 ? 'PASS' : 'FAIL');

  // 进场景：点 Start 按钮
  await p.locator('.card', { hasText: 'Emergency · Survival' }).getByRole('button').first().click();
  await p.waitForTimeout(900);

  // T2 场景视图含 8 条 hz
  const hzList = ['帮忙！', '我需要帮助。', '医院在哪里？', '我病了。', '请打警察。', '我迷路了。', '我的手机 / 钱包丢了。', '我不会说中文。'];
  let ok = 0;
  for (const t of hzList) { if (await p.locator('#sc-list').getByText(t, { exact: true }).count() > 0) ok++; }
  console.log('T2 8 phrases in scene view:', ok === 8 ? 'PASS' : 'FAIL', '(' + ok + '/8)');

  // T3 展开真实口语变体（默认折叠）
  const toggle = p.locator('#sc-list .real-toggle').first();
  if (await toggle.count() > 0) { await toggle.click(); await p.waitForTimeout(400); }
  const realOk = await p.locator('#sc-list').getByText('帮帮我！', { exact: true }).count() > 0;
  console.log('T3 real-life variant reveals:', realOk ? 'PASS' : 'FAIL');

  // T4 三档语速播放不崩
  const slow = p.getByText('🐢 Slow').first();
  if (await slow.count() > 0) { await slow.click(); await p.waitForTimeout(1500); }
  console.log('T4 slow speak no crash: done');

  console.log('JS errors:', errs.length ? JSON.stringify(errs) : 'NONE');
  await b.close();
})();
