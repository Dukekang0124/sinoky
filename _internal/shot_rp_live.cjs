/* 线上真跑截图：证明 v0.27.0 场景教练真的在线上可交互
 * 安全：page.route 拦截所有 /api/* 并 abort ⇒ 零生产写入（不污染 KV）
 * 用法：NODE_PATH=$WS/node_modules node _internal/shot_rp_live.cjs
 * 🔴 关键：线上全新 profile 先弹 #lang-gate（z100）+ #splash（z9999）。**必须真的点掉语言门**
 *    （按钮无 onclick/data-lang，靠 addEventListener 绑，只能用文字定位点）。
 *    只把 lang-gate 设 display:none 不够 —— 主内容还藏着，截出来是全黑（三张图 md5 会一模一样）。
 */
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '_shots');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_ABORTED/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.route('**/api/**', r => r.abort());   // 零生产写入

  await p.goto('https://sinoky.pages.dev/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => typeof S === 'object' && typeof RP === 'object', { timeout: 45000 });
  const ver = await p.evaluate(() => APP_VERSION);

  // 真的点掉语言门
  const gate = await p.evaluate(() => !!document.getElementById('lang-gate'));
  if (gate) {
    try { await p.locator('#lang-gate button', { hasText: '中文' }).first().click({ timeout: 8000 }); }
    catch (e) { errs.push('lang-gate 点击失败: ' + e.message); }
  }
  await p.waitForTimeout(1500);

  // 🔴 语言门之后还有一层「开屏 intro」（文案：别再死记硬背… / 开始学习 / 先跳过），
  //    它的 z 高于 #rp(z71)，不点掉的话后面三张截图会字节级完全相同（都拍到它）。
  //    做法：反复点「先跳过 / 跳过」，每轮再用 elementFromPoint 探测中心点归属，直到露到主界面。
  const log = [];
  for (let i = 0; i < 6; i++) {
    let clicked = '';
    try {
      const skip = p.locator('text=/^\s*(先跳过|跳过|Skip)\s*$/i').first();
      if (await skip.count() > 0 && await skip.isVisible()) { await skip.click({ timeout: 3000 }); clicked = 'skip'; }
    } catch (e) { /* 没有就继续 */ }
    // 摘掉残留遮挡
    const snap = await p.evaluate(() => {
      var o = {};
      ['lang-gate', 'splash', 'onboard', 'intro', 'v-onboard'].forEach(function (id) {
        var e = document.getElementById(id);
        if (e) { o[id] = getComputedStyle(e).display; e.style.display = 'none'; }
      });
      return o;
    });
    // 中心点归属 = 真正在屏幕最上层的元素
    const top = await p.evaluate(() => {
      var e = document.elementFromPoint(195, 420);
      if (!e) return '(null)';
      var chain = [], n = e;
      while (n && chain.length < 4) { chain.push(n.id ? '#' + n.id : (n.className ? '.' + String(n.className).split(' ')[0] : n.tagName)); n = n.parentElement; }
      return chain.join(' < ');
    });
    log.push({ round: i, clicked, snap, top });
    if (/home-scenes|home/.test(top)) break;
    await p.waitForTimeout(600);
  }
  // 摘掉遮挡后仍停在 onboard 视图 ⇒ 点底部导航「首页」把 home 视图切出来
  try { await p.locator('nav >> text=/^\s*首页\s*$/').first().click({ timeout: 4000 }); }
  catch (e) { try { await p.locator('text=/^\s*首页\s*$/').last().click({ timeout: 3000 }); } catch (e2) { log.push({ navClick: 'failed' }); } }
  await p.waitForTimeout(1200);
  const after = log[log.length - 1];

  // ① 首页（含场景教练入口卡）
  const cardInfo = await p.evaluate(() => {
    var html = (document.getElementById('home-scenes') || {}).innerHTML || '';
    return { chips: document.querySelectorAll('#home-scenes [onclick*="rpStart"]').length,
             hasText: /场景教练|Scenario Coach/.test(html) };
  });
  await p.screenshot({ path: path.join(OUT, 'L1-home-live.png') });

  // ② 场景教练面板 · 第 1 轮
  const panel = await p.evaluate(() => {
    openRp(); rpStart('order-food');
    var ov = document.getElementById('rp'); if (!ov) return { open: false };
    var r = ov.querySelector('.sess-box').getBoundingClientRect();
    return { open: true, display: getComputedStyle(ov).display,
             w: Math.round(r.width), h: Math.round(r.height),
             head: (document.getElementById('rp-t') || {}).textContent || '',
             prog: (document.getElementById('rp-prog') || {}).textContent || '',
             bubbles: document.querySelectorAll('#rp-body .rp-b').length };
  });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, 'L2-panel-live.png') });

  // ③ 点出提示（验证 hintOn 在线上真的生效）
  const hint = await p.evaluate(() => {
    var before = document.querySelectorAll('#rp-body .rp-goal-hz').length;
    var btn = document.querySelector('#rp-body .rp-goal');
    if (btn) btn.click();
    var after = document.querySelectorAll('#rp-body .rp-goal-hz').length;
    return { before: before, after: after };
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, 'L3-hint-live.png') });

  console.log('线上 APP_VERSION = ' + ver);
  console.log('语言门 = ' + gate + ' | 摘遮挡前 = ' + JSON.stringify(after));
  console.log('首页入口卡 = ' + JSON.stringify(cardInfo));
  console.log('面板 = ' + JSON.stringify(panel));
  console.log('提示态 = ' + JSON.stringify(hint));
  console.log('页面错误(已排除被拦的 /api) = ' + (errs.length ? JSON.stringify(errs.slice(0, 5)) : '0 ✅'));
  await b.close();
})();
