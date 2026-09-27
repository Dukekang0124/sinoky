/* 线上真跑截图：证明 v0.29 闭环收口真的在线上可交互（期望版本动态读仓库根 version.json）
 *  ① 首页：复盘入口卡（行程结束后自动出现）+ 路径卡上的「换做法」出口（策略切换）
 *  ② 复盘卡分享面板（SHARE 面板，retro 主题，含二维码与分享链）
 *  ③ 复盘卡本体 PNG（直接导出 canvas 1080×1080 —— 这是「卡长什么样」最硬的证据）
 *
 * 安全：page.route 拦截所有 /api/* 并 abort ⇒ **零生产写入**（profile 拉取/回传/评分全被拦）
 * 状态注入：线上是全新 profile，不会有行程/策略数据 ⇒ 用 addInitScript 预置一份 localStorage
 *   （只在**页面脚本执行前**写入一次，不触发任何网络）
 * 用法：NODE_PATH=$WS/node_modules node _internal/shot_retro_live.cjs
 * 🔴 线上一套全新 profile 有三层遮挡：① #lang-gate（点按钮，无 onclick 只能按文字点）
 *    ② 开屏 intro（点「先跳过」）③ #v-onboard。**必须逐层点掉** —— 只设 display:none 不够，
 *    主内容仍在背后隐藏，截出来会是全黑（多张图 md5 完全相同）。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '_shots');

const day = function(ago){ return new Date(Date.now() - ago * 86400e3).toISOString().slice(0, 10); };

/* 预置的学员模型：行程已结束（3 天前到达 / 行程 2 天）+ 跨天摘要 + 一条命中策略 */
function seedState(){
  var arrive = day(3);
  return {
    onboarded: true,
    goal: 'travel',
    streak: 7,
    lastDone: day(0),
    days: [day(1), day(2), day(3), day(5), day(6)],
    phrases: {},
    rev: {},
    lm: {
      v: 1,
      goal: { native: 'en', purpose: 'travel', cities: ['上海'], arrive: arrive, days: 2 },
      level: { band: 'A2', conf: 0.6, testedAt: day(12) },
      abil: { tone: 0.52, initial: 0.66, final: 0.61, fluency: 0.44,
              listening: 0.5, vocab: 0.31, grammar: 0.4, pragmatics: 0.35 },
      weak: [ { k: 'tone4', n: 6 }, { k: 'tone3', n: 4 }, { k: 'final', n: 2 } ],
      mastered: [],
      path: { fam: 'travel', node: 't7', done: ['t1','t2','t3','t4','t5','t6'], startedAt: day(12) },
      trip: { city: '上海', arrive: arrive, dayIdx: 3, plan: [] },
      mile: [ { id: 'rp:order-food', at: day(4), v: 3 }, { id: 'node:t6', at: day(4), node: 't6' } ],
      policy: { hint: 'standard', weights: {}, cardLog: [],
                strategy: [ { k: 'arrival#0', n: 3, m: 'syllable', at: day(0) } ] },
      stats: { days: 5, said: 23, dueCount: 2 },
      buf: [],
      digest: [
        { d: day(4), n: 6, sc: 6, avg: 71 },
        { d: day(3), n: 5, sc: 5, avg: 74 },
        { d: day(2), n: 7, sc: 7, avg: 78 }
      ],
      updatedAt: Date.now()
    }
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_ABORTED/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.route('**/api/**', r => r.abort());   // 零生产写入

  await p.addInitScript(function(state){
    try{
      localStorage.setItem('sinoky_lang_chosen', '1');
      localStorage.setItem('sinoky_state', JSON.stringify(state));
    }catch(e){}
  }, seedState());

  await p.goto('https://sinoky.pages.dev/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => typeof S === 'object' && typeof RETRO === 'object', { timeout: 45000 });
  const ver = await p.evaluate(() => APP_VERSION);
  const want = path.join(__dirname, '..', 'version.json');
  const WANT = JSON.parse(fs.readFileSync(want, 'utf8')).version;
  console.log('线上 APP_VERSION = ' + ver + (ver === WANT ? ' ✅' : ' ❌ 期望 ' + WANT));

  /* ① 语言门 —— 真的点掉（按钮靠 addEventListener 绑，只能用文字定位）
     ⚠️ 判据是「门还在不在」，不是「click 有没有抛异常」：v0.29.0 收尾时线上其实已全绿，
     却因为 click 超时被计成页面错误而报了 ❌（过渡动画/定位抖动会让 locator 超时）。 */
  const gateVisible = () => p.evaluate(() => {
    const e = document.getElementById('lang-gate');
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return getComputedStyle(e).display !== 'none' && r.height > 0;
  });
  for (let i = 0; i < 3 && await gateVisible(); i++) {
    try { await p.locator('#lang-gate button', { hasText: '中文' }).first().click({ timeout: 5000 }); }
    catch (e) {
      try { await p.evaluate(() => { const b = document.querySelector('#lang-gate button'); if (b) b.click(); }); } catch (e2) {}
    }
    await p.waitForTimeout(900);
  }
  if (await gateVisible()) errs.push('lang-gate 仍未关闭');
  await p.waitForTimeout(700);

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
  await p.waitForTimeout(1400);

  /* ---- 0. 状态自检：注入的状态是否真的生效 ---- */
  const st = await p.evaluate(function(){
    try{
      return {
        ver: APP_VERSION,
        onboarded: !!S.onboarded,
        tripCity: (LM.get().trip && LM.get().trip.city) || '',
        daysToTrip: LM.daysToTrip(),
        ended: RETRO.ended(),
        available: RETRO.available(),
        digest: LM.digestOf(30).length,
        strategy: LM.strategyAll().length,
        cardHtml: (typeof retroCardHtml === 'function') ? retroCardHtml().length : -1,
        retroBtn: /Make my trip card|生成我的行程卡/.test(document.body.innerHTML)
      };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  console.log('状态自检:', JSON.stringify(st));

  /* ---- ① 首页（滚到复盘卡） ---- */
  await p.evaluate(function(){
    var els = document.querySelectorAll('#home-scenes .card');
    for (var i = 0; i < els.length; i++){
      if (/🧳/.test(els[i].textContent || '')) { els[i].scrollIntoView({ block:'start' }); return; }
    }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(OUT, 'R1-home-retro-live.png') });
  console.log('① R1-home-retro-live.png');

  /* ---- ② 策略切换出口（路径卡） ---- */
  const stratUi = await p.evaluate(function(){
    var h = '';
    try{ h = pathCardHtml(); }catch(e){ return { err:String(e && e.message) }; }
    return { hasSwap: /🎚/.test(h), hasBtn: /🔤|🔄/.test(h), len: h.length };
  });
  console.log('策略出口自检:', JSON.stringify(stratUi));
  await p.evaluate(function(){
    var els = document.querySelectorAll('#home-scenes .card');
    for (var i = 0; i < els.length; i++){
      if (/🧭/.test(els[i].textContent || '')) { els[i].scrollIntoView({ block:'start' }); return; }
    }
  });
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(OUT, 'R3-path-strategy-live.png') });
  console.log('② R3-path-strategy-live.png');

  /* ---- ③ 复盘卡本体 PNG（方图 1080×1080 + 竖版 1080×1920）
         并在**线上真实代码**上跑一遍「正文不越界」几何断言（与本地 test_retro C12 同一判据）---- */
  const png = await p.evaluate(function(){
    try{
      SHARE.theme = 'retro'; SHARE.code = 'sinoky29';
      var out = {};
      ['square','story'].forEach(function(fmt){
        var cv = SHARE.draw(fmt);
        if (cv) out[fmt] = { url: cv.toDataURL('image/png'), w: cv.width, h: cv.height };
      });
      /* 几何：临时关掉注入层两块覆盖物再画一版，量主代码正文（方图） */
      var W = 1080, BOT = 806, DIV = 1080 - 228;
      var savedLink = SHARE.link, im = window.NONO_SHARE_IMG, stubbed = false;
      try{
        SHARE.link = function(){ return ''; };
        if (im){ Object.defineProperty(im,'complete',{value:false,configurable:true});
                 Object.defineProperty(im,'naturalWidth',{value:0,configurable:true}); stubbed = true; }
      }catch(e){}
      var off = SHARE.draw('square');
      try{ SHARE.link = savedLink; }catch(e){}
      if (stubbed){ try{ delete im.complete; delete im.naturalWidth; }catch(e){} }
      if (off){
        var d = off.getContext('2d').getImageData(0, 0, W, 1080).data;
        function at(x,y){ var i = (y*W + x)*4; return [d[i], d[i+1], d[i+2]]; }
        var cnt = {}, best = '', bn = 0, k;
        for(var y = 0; y < 1080; y += 4) for(var x = 0; x < W; x += 4){
          var q = at(x,y); k = q[0] + ',' + q[1] + ',' + q[2];
          cnt[k] = (cnt[k]||0) + 1; if(cnt[k] > bn){ bn = cnt[k]; best = k; }
        }
        var bg = best.split(',').map(Number), maxY = -1;
        for(var yy = 230; yy <= DIV-4; yy++){
          for(var xx = 0; xx < W; xx++){
            var pp = at(xx,yy);
            if (Math.abs(pp[0]-bg[0]) + Math.abs(pp[1]-bg[1]) + Math.abs(pp[2]-bg[2]) > 26){ if(yy > maxY) maxY = yy; break; }
          }
        }
        out.geo = { contentMaxY:maxY, BOT:BOT, DIV:DIV, stubbed:stubbed, ok: maxY > 0 && maxY <= BOT };
      }
      return out;
    }catch(e){ return { err:String(e && e.message) }; }
  });
  if (png && png.square && png.square.url) {
    fs.writeFileSync(path.join(OUT, 'R2-retro-card-live.png'), Buffer.from(png.square.url.split(',')[1], 'base64'));
    console.log('③ R2-retro-card-live.png (' + png.square.w + '×' + png.square.h + ')');
    if (png.story && png.story.url) {
      fs.writeFileSync(path.join(OUT, 'R2b-retro-story-live.png'), Buffer.from(png.story.url.split(',')[1], 'base64'));
      console.log('③b R2b-retro-story-live.png (' + png.story.w + '×' + png.story.h + ')');
    }
    console.log('复盘卡几何（线上真码）:', JSON.stringify(png.geo));
  } else {
    console.log('❌ 复盘卡导出失败:', JSON.stringify(png));
  }

  /* ---- ④ 分享面板（拆开归档路径：先真点按钮，失败再直接调 open） ---- */
  let opened = '';
  try {
    await p.locator('button:has-text("生成我的行程卡"), button:has-text("Make my trip card")').first().click({ timeout: 4000 });
    opened = 'click';
  } catch (e) {
    await p.evaluate(function(){ try{ RETRO.open(); }catch(err){} });
    opened = 'RETRO.open()';
  }
  await p.waitForTimeout(1600);
  const panel = await p.evaluate(function(){
    var m = document.getElementById('share-mask'), pa = document.getElementById('share-panel');
    var cv = document.querySelector('#share-panel canvas');
    return { mask: m ? getComputedStyle(m).display : '-', panel: pa ? getComputedStyle(pa).display : '-',
             theme: SHARE.theme, hasCanvas: !!cv };
  });
  console.log('分享面板:', opened, JSON.stringify(panel));
  await p.screenshot({ path: path.join(OUT, 'R4-share-panel-live.png') });
  console.log('④ R4-share-panel-live.png');

  /* ---- ⑤ 归档是否真的写进 mile（线上状态的因果证据） ---- */
  const arch = await p.evaluate(function(){
    try{
      var m = LM.get(), hit = null;
      for (var i = 0; i < m.mile.length; i++) if (String(m.mile[i].id).indexOf('retro:') === 0) hit = m.mile[i];
      return { mile: hit, said: RETRO.build().said, avg: RETRO.build().avg,
               next: RETRO.build().next && RETRO.build().next.hz };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  console.log('归档:', JSON.stringify(arch));

  await p.waitForTimeout(300);
  console.log('页面错误数:', errs.length, errs.slice(0, 3).join(' | '));

  const okAll = /^(1|true)$/.test(String(st.available)) && !!(png.square && png.square.url)
             && !!(png.geo && png.geo.ok)            /* v0.29.1：线上真码排版不越界 */
             && stratUi.hasSwap === true             /* v0.29.1：复盘节点下策略出口必须在场 */
             && errs.length === 0;
  console.log(okAll ? '✅ 线上真跑截图全绿' : '❌ 线上真跑有问题 — 见上');
  await b.close();
  process.exit(okAll ? 0 : 1);
})().catch(e => { console.error('FATAL', e && (e.stack || e.message)); process.exit(1); });
