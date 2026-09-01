const { chromium } = require('playwright');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  console.log((ok ? '✅ PASS' : '❌ FAIL') + ' ' + n + (extra ? '  ' + extra : ''));
  ok ? pass++ : fail++;
};

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p = await c.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });
  await p.waitForTimeout(300);

  // T1 默认位置不遮挡底部导航
  const overlap = await p.evaluate(() => {
    const fb = document.getElementById('fb-open').getBoundingClientRect();
    const nav = document.querySelector('nav').getBoundingClientRect();
    const home = document.querySelector('#nav-home').getBoundingClientRect();
    const cards = document.querySelector('#nav-cards').getBoundingClientRect();
    const hit = (a, bb) => !(a.right < bb.left || a.left > bb.right || a.bottom < bb.top || a.top > bb.bottom);
    return {
      fb: { top: Math.round(fb.top), bottom: Math.round(fb.bottom), left: Math.round(fb.left) },
      navTop: Math.round(nav.top),
      hitsNav: hit(fb, nav),
      hitsHome: hit(fb, home),
      hitsCards: hit(fb, cards),
    };
  });
  check('T1 默认位置不压住导航栏', overlap.hitsNav === false, JSON.stringify(overlap));
  check('T2 不遮挡 Home 按钮', overlap.hitsHome === false);
  check('T3 不遮挡 Cards 按钮', overlap.hitsCards === false);

  // T4 拖拽到右上
  const before = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  await p.mouse.move(before.x + 30, before.y + 14);
  await p.mouse.down();
  await p.mouse.move(300, 200, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  check('T4 可拖拽移动位置', Math.abs(after.x - before.x) > 50 || Math.abs(after.y - before.y) > 50,
    'before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));

  // T5 拖拽后不误开面板（关键）
  const panelOpenAfterDrag = await p.evaluate(() =>
    document.getElementById('fb-panel').classList.contains('on'));
  check('T5 拖拽后不误开反馈面板', panelOpenAfterDrag === false);

  // T6 位置已持久化
  const stored = await p.evaluate(() => localStorage.getItem('sinoky-fb-pos'));
  check('T6 位置存入 localStorage', !!stored && /"x"/.test(stored), stored);

  // T7 刷新后位置保持
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  const afterReload = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  check('T7 刷新后位置保持', Math.abs(afterReload.x - after.x) < 12 && Math.abs(afterReload.y - after.y) < 12,
    'reload=' + JSON.stringify(afterReload) + ' expected≈' + JSON.stringify(after));

  // T8 单击仍能打开面板
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });
  await p.evaluate(() => document.getElementById('fb-open').click());
  await p.waitForTimeout(500);
  const opened = await p.evaluate(() => document.getElementById('fb-panel').classList.contains('on'));
  check('T8 单击仍能打开反馈面板', opened === true);

  // T9 分类标签仍可切换（回归：之前误删过绑定）
  await p.evaluate(() => {
    const cats = document.querySelectorAll('#fb-cats .fb-cat');
    if (cats[1]) cats[1].click();
  });
  await p.waitForTimeout(300);
  const catSwitched = await p.evaluate(() => {
    const on = document.querySelector('#fb-cats .fb-cat.on');
    return on ? on.getAttribute('data-cat') : null;
  });
  check('T9 分类标签可切换（回归）', catSwitched === 'audio', 'cat=' + catSwitched);

  check('T10 零 JS 错误', errs.filter(e => !/favicon/i.test(e)).length === 0, JSON.stringify(errs.slice(0, 2)));

  console.log('\n=== ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
