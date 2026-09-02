const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const p = await c.newPage();
  let errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  let pass = 0, total = 0;
  function ck(name, cond) { total++; if (cond) { pass++; console.log('✅ T' + total + ' ' + name); } else console.log('❌ T' + total + ' ' + name); }

  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });
  await p.waitForTimeout(300);

  // T1 Day 1 卡渲染
  const day1 = await p.evaluate(() => {
    const card = document.querySelector('.day1');
    const steps = document.querySelectorAll('.day1-step');
    return { has: !!card, steps: steps.length, titles: Array.from(steps).map(s => s.textContent.replace(/\s+/g, ' ').trim()) };
  });
  ck('Day 1 引导卡渲染', day1.has);
  ck('Day 1 三步走 (arrival→self-intro→emergency)', day1.steps === 3);
  console.log('   steps:', JSON.stringify(day1.titles));

  // T2 点 Day1 step 2 (self-intro) 进场景视图
  await p.evaluate(() => { document.querySelectorAll('.day1-step')[1].click(); });
  await p.waitForTimeout(800);
  const sc = await p.evaluate(() => ({
    sceneVisible: document.getElementById('scene').classList.contains('on'),
    phrases: document.querySelectorAll('#sc-list .phrase').length,
    title: document.getElementById('sc-title').textContent
  }));
  ck('self-intro 进场景视图且 8 条短语', sc.sceneVisible && sc.phrases === 8);
  ck('场景标题含 Self-intro', /Self-intro/.test(sc.title));

  // T3 首句 hz 含 "我叫"
  const firstHz = await p.evaluate(() => { const el = document.querySelector('#sc-list .p-hz'); return el ? el.textContent : ''; });
  ck('首句含"我叫"', /我叫/.test(firstHz));

  // T4 慢速播放按钮不崩
  await p.evaluate(() => { const btns = document.querySelectorAll('#sc-list .btn.speed'); if (btns[0]) btns[0].click(); });
  await p.waitForTimeout(1200);

  // T5 展开真实口语变体
  await p.evaluate(() => { const t = document.querySelector('#sc-list .real-toggle'); if (t) t.click(); });
  await p.waitForTimeout(400);
  const realOpen = await p.evaluate(() => { const el = document.querySelector('#sc-list .real-list'); return el && el.style.display !== 'none'; });
  ck('真实口语变体可展开', realOpen);

  // T6 返回 Home，Day 1 卡仍在
  await p.evaluate(() => { const h = document.getElementById('nav-home'); if (h) h.click(); });
  await p.waitForTimeout(600);
  const back = await p.evaluate(() => ({ day1: !!document.querySelector('.day1'), steps: document.querySelectorAll('.day1-step').length }));
  ck('返回 Home Day 1 卡仍在', back.day1 && back.steps === 3);

  ck('零 JS 错误', errs.length === 0);
  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));

  console.log('\n结果: ' + pass + '/' + total);
  await b.close();
  process.exit(pass === total ? 0 : 1);
})();
