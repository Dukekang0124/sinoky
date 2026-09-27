/* 线上真跑截图：证明主动智能（v0.28+）真的在线上可交互 —— 期望版本动态读仓库根 version.json
 *  ① 首页主动卡（行程临近 → 「今天练这 10 句」）
 *  ② 行程包面板（10 句 / 跨 zone / 进度）
 *  ③ 行程包评分回流（点一句 → 出评分，进度 1/10）
 *  ④ 设置页行程录入（城市下拉 + 到达日期 + 倒计时文案）
 *
 * 安全：page.route 拦截所有 /api/* 并 abort ⇒ **零生产写入**（profile 拉取/回传/评分全被拦）
 * 用法：NODE_PATH=$WS/node_modules node _internal/shot_pro_live.cjs
 * 🔴 线上一套全新 profile 有三层遮挡：① #lang-gate（点按钮，无 onclick 只能按文字点）
 *    ② 开屏 intro（点「先跳过」）③ #v-onboard。**必须逐层点掉** —— 只设 display:none 不够，
 *    主内容仍在背后隐藏，截出来会是全黑（多张图 md5 完全相同）。
 */
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '_shots');

const round = new Date(Date.now() + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10);   /* 本地「明天」 */

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_ABORTED/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.route('**/api/**', r => r.abort());   // 零生产写入

  await p.goto('https://sinoky.pages.dev/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => typeof S === 'object' && typeof PRO === 'object', { timeout: 45000 });
  const ver = await p.evaluate(() => APP_VERSION);
  const want = require('path').join(__dirname, '..', 'version.json');
  const WANT = JSON.parse(require('fs').readFileSync(want, 'utf8')).version;

  /* ① 语言门 —— 真的点掉（按钮靠 addEventListener 绑，只能用文字定位） */
  const gate = await p.evaluate(() => !!document.getElementById('lang-gate'));
  if (gate) {
    try { await p.locator('#lang-gate button', { hasText: '中文' }).first().click({ timeout: 8000 }); }
    catch (e) { errs.push('lang-gate 点击失败: ' + e.message); }
  }
  await p.waitForTimeout(1500);

  /* ② 开屏 intro + onboard：逐层点掉并用 elementFromPoint 验证中心点归属 */
  const log = [];
  for (let i = 0; i < 6; i++) {
    let clicked = '';
    try {
      const skip = p.locator('text=/^\\s*(先跳过|跳过|Skip)\\s*$/i').first();
      if (await skip.count() > 0 && await skip.isVisible()) { await skip.click({ timeout: 3000 }); clicked = 'skip'; }
    } catch (e) { /* 没有就继续 */ }
    const snap = await p.evaluate(() => {
      var o = {};
      ['lang-gate', 'splash', 'onboard', 'intro', 'v-onboard'].forEach(function (id) {
        var e = document.getElementById(id);
        if (e) { o[id] = getComputedStyle(e).display; e.style.display = 'none'; }
      });
      return o;
    });
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
  try { await p.locator('nav >> text=/^\\s*首页\\s*$/').first().click({ timeout: 4000 }); }
  catch (e) { try { await p.locator('text=/^\\s*首页\\s*$/').last().click({ timeout: 3000 }); } catch (e2) { log.push({ navClick: 'failed' }); } }
  await p.waitForTimeout(1200);

  /* ③ seed 行程：明天到上海（走产品自己的 API，不手改字段） */
  const seeded = await p.evaluate(function (arrive) {
    S.onboarded = true;
    if (typeof LM.setTrip === 'function') LM.setTrip('上海', arrive, 0);
    go('home'); renderHome();
    var d = PRO.decide();
    return { kind: d.kind, cityId: d.cityId, days: d.daysToTrip, set: d.set,
             cities: Object.keys(CITY_GUIDES).length };
  }, round);
  await p.waitForTimeout(600);

  /* ① 首页主动卡 */
  const card = await p.evaluate(() => {
    var html = (document.getElementById('home-scenes') || {}).innerHTML || '';
    return { chips: document.querySelectorAll('#home-scenes [onclick*="openTrip"]').length,
             noCn: !/[一-龥]/.test((html.match(/Trip pack[^<]{0,60}/) || [''])[0]),
             snippet: (html.match(/>([^<>]*Trip pack[^<>]*)</) || [])[1] || '' };
  });
  await p.screenshot({ path: path.join(OUT, 'P1-home-card-live.png') });

  /* ② 行程包面板 */
  const panel = await p.evaluate(() => {
    openTrip('shanghai', 10);
    var ov = document.getElementById('trip');
    if (!ov) return { open: false };
    return { open: true, on: ov.classList.contains('on'),
             rows: document.querySelectorAll('#trip-body .trip-row').length,
             title: (document.getElementById('trip-t') || {}).textContent || '',
             prog: (document.getElementById('trip-prog') || {}).textContent || '' };
  });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, 'P2-trip-pack-live.png') });

  /* ③ 评分回流（/api/score 被 abort ⇒ 走降级路径也要能出结果，绝不静默无反应） */
  const scored = await p.evaluate(async () => {
    var it = tripItems[0];
    if (!it) return { skipped: true };
    var box = document.getElementById('tp-score-0');
    if (!box) { renderTrip(); box = document.getElementById('tp-score-0'); }
    var before = box ? box.innerHTML.length : 0;
    try { await sendTripScore(it, it.hz, 0, box); } catch (e) { return { err: String(e && e.message).slice(0, 80) }; }
    var b2 = document.getElementById('tp-score-0');
    return { before: before, after: b2 ? b2.innerHTML.length : 0,
             hasResult: !!(b2 && /score-result|score-err/.test(b2.innerHTML || '')),
             prog: (document.getElementById('trip-prog') || {}).textContent || '' };
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: path.join(OUT, 'P3-trip-score-live.png') });

  /* ④ 设置页行程录入 */
  const setting = await p.evaluate(() => {
    closeTrip();
    go('settings'); renderSettings();
    var sel = document.getElementById('trip-city'), dt = document.getElementById('trip-arrive');
    if (sel) sel.scrollIntoView({ block: 'center' });
    return { hasSelect: !!sel, options: sel ? sel.options.length : 0,
             selected: sel ? sel.value : '',
             hasDate: !!dt, dateVal: dt ? dt.value : '',
             hint: (document.getElementById('set-triphint') || {}).textContent || '' };
  });
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'P4-trip-setting-live.png') });

  console.log('线上 APP_VERSION = ' + ver + (ver === WANT ? ' ✅' : ' ❌ 期望 ' + WANT));
  console.log('语言门 = ' + gate + ' | 摘遮挡后中心点 = ' + JSON.stringify(log[log.length - 1]));
  console.log('seed 决策树 = ' + JSON.stringify(seeded));
  console.log('首页主动卡 = ' + JSON.stringify(card));
  console.log('行程包面板 = ' + JSON.stringify(panel));
  console.log('评分回流 = ' + JSON.stringify(scored));
  console.log('设置页行程录入 = ' + JSON.stringify(setting));
  console.log('页面错误(已排除被拦的 /api) = ' + (errs.length ? JSON.stringify(errs.slice(0, 5)) : '0 ✅'));
  await b.close();
})();
