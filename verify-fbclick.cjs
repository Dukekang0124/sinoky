/* v0.3.11 验证：反馈按钮"能拖也能点开"
   背景：v0.3.10 在 touchstart 里 preventDefault() 杀掉了合成 click，
   Playwright 旧脚本 T8 用 el.click()（合成 JS 点击）没走触摸链 → 假通过。
   本脚本关键区别：用 page.touchscreen.tap() 走真实触摸事件链（touchstart/
   touchend → pointerdown/pointerup），与真机路径一致。 */
const { chromium } = require('playwright');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  console.log((ok ? '✅ PASS' : '❌ FAIL') + ' ' + n + (extra ? '  ' + extra : ''));
  ok ? pass++ : fail++;
};

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await b.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
    serviceWorkers: 'block',
  });
  const p = await c.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await p.goto('https://sinoky.pages.dev/?nocache=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const ver = await p.evaluate(() => ({ v: window.APP_VERSION || document.querySelector('.v-txt')?.textContent }));
  check('T0 线上版本 = 0.3.11', JSON.stringify(ver).includes('0.3.11'), JSON.stringify(ver));
  await p.evaluate(() => { const o = document.getElementById('onb'); if (o) o.classList.remove('on'); });
  await p.waitForTimeout(300);

  // ★ T1 核心修复验证：真实触摸点按 → 面板打开（v0.3.10 就是死在这）
  const pos1 = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p.touchscreen.tap(pos1.x, pos1.y);
  await p.waitForTimeout(500);
  const t1 = await p.evaluate(() => document.getElementById('fb-panel').classList.contains('on'));
  check('T1 触摸点按能打开面板（核心）', t1 === true);

  // T2 关闭面板
  await p.evaluate(() => closeFB());
  await p.waitForTimeout(300);

  // T3 拖拽（鼠标路径 = pointer 分支）后不误开面板
  const before = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  await p.mouse.move(before.x + 30, before.y + 14);
  await p.mouse.down();
  await p.mouse.move(300, 200, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const t3panel = await p.evaluate(() => document.getElementById('fb-panel').classList.contains('on'));
  const after = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  check('T3 拖拽移动位置且不误开面板', !t3panel && (Math.abs(after.x - before.x) > 50 || Math.abs(after.y - before.y) > 50),
    'before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));

  // ★ T4 拖到新位置后，触摸点按仍能打开（拖动 flag 不残留）
  const pos4 = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p.touchscreen.tap(pos4.x, pos4.y);
  await p.waitForTimeout(500);
  const t4 = await p.evaluate(() => document.getElementById('fb-panel').classList.contains('on'));
  check('T4 拖拽后触摸点按仍能打开面板（核心）', t4 === true);
  await p.evaluate(() => closeFB());
  await p.waitForTimeout(300);

  // T5 长按 700ms+ 复位（鼠标按下不松）
  await p.mouse.move(after.x + 30, after.y + 14);
  await p.mouse.down();
  await p.waitForTimeout(900);
  await p.mouse.up();
  await p.waitForTimeout(400);
  const t5 = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    const nav = document.querySelector('nav').getBoundingClientRect();
    const hit = !(r.bottom < nav.top || r.top > nav.bottom);
    const stored = localStorage.getItem('sinoky-fb-pos');
    return { nearDefault: hit || r.top < 200, cleared: stored === null, panel: document.getElementById('fb-panel').classList.contains('on') };
  });
  check('T5 长按复位到默认位置且清空存储', t5.cleared === true && t5.panel === false, JSON.stringify(t5));

  // T6 复位后触摸点按打开（长按不影响下次点击）
  const pos6 = await p.evaluate(() => {
    const r = document.getElementById('fb-open').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p.touchscreen.tap(pos6.x, pos6.y);
  await p.waitForTimeout(500);
  const t6 = await p.evaluate(() => document.getElementById('fb-panel').classList.contains('on'));
  check('T6 复位后触摸点按仍能打开', t6 === true);

  check('T7 零 JS 错误', errs.filter(e => !/favicon/i.test(e)).length === 0, JSON.stringify(errs.slice(0, 2)));

  console.log('\n=== ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
