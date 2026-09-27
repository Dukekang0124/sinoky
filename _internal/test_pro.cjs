#!/usr/bin/env node
/* v0.28.0 验收：M5 主动引擎（Proactive Engine）—— **真跑**（康哥铁律）。
   本地 http server → Playwright 驱动本机 Chrome → mock 全部 /api/* → 断言**行为**。

   重点不是「跑通」，而是五条**因果**：
     ① 决策树真的随画像变（行程 → trip；连胜 → streak；到期 → due；全无 → **skip**）
     ② 行程包真的零新增教学内容（每句都能在既有 CITY_GUIDES 里原样找到）
     ③ 深链真的直达（?go=trip 打开行程包 / ?go=roleplay 开扮演 / ?go=review 切视图），
        且**一次性消费**（query 被 replaceState 清掉，刷新不重复跳）
     ④ 行程包评分真的走**唯一回流入口** LM.ingestScore（干预式 A/B：tone 真的上升）
     ⑤ 未订阅时 syncSnapshot() 真的**不发请求**（KV 写 = 0 的纪律）

   用法：NODE_PATH=<workspace>/node_modules node _internal/test_pro.cjs */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8',
  '.json':'application/json;charset=utf-8', '.webp':'image/webp', '.png':'image/png',
  '.css':'text/css', '.mp3':'audio/mpeg', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

const srv = http.createServer(function(req, res){
  var p = decodeURIComponent(String(req.url).split('?')[0]);
  if(p === '/') p = '/index.html';
  var f = path.join(ROOT, p.replace(/^\//, ''));
  fs.readFile(f, function(e, d){
    if(e){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
});

const R = [];
function chk(name, val, extra){ R.push({ name:name, ok:!!val, extra: extra === undefined ? '' : String(extra) }); }

/* mock 捕获桶 */
const seen = { pushSub: [], score: 0 };

(async function(){
  await new Promise(function(r){ srv.listen(0, '127.0.0.1', r); });
  const PORT = srv.address().port, BASE = 'http://127.0.0.1:' + PORT;
  console.log('server on', BASE);

  const browser = await chromium.launch({ channel:'chrome' });
  const ctx = await browser.newContext({ locale:'en-US' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', function(e){ errs.push(String(e.message).slice(0,160)); });

  await page.route('**/*', async function(route){
    const u = route.request().url();
    if(u.indexOf(BASE) === 0){
      const pth = new URL(u).pathname;
      if(pth.indexOf('/api/') === 0){
        if(pth === '/api/register') return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, uid:'pro-test-uid-0001' }) });
        if(pth === '/api/push-sub'){
          try{ seen.pushSub.push(JSON.parse(route.request().postData() || '{}')); }catch(e){}
          return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
        }
        if(pth === '/api/score'){
          seen.score++;
          return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ overall:88, verdict:'Great',
            perSyll:[ { target:'请', user:'请', score:1, toneOk:true },
                      { target:'问', user:'问', score:1, toneOk:true } ] }) });
        }
        if(pth === '/api/asr')  return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, text:'请问行李在哪儿取' }) });
        return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
      }
      return route.continue();
    }
    return route.abort();
  });

  await page.addInitScript(function(){
    try{
      localStorage.setItem('sinoky_lang_chosen','1');
      /* 🔴 只在**首次**导航清空 state。
         若每次导航都清，深链测试（page.goto ?go=...）拿到的永远是「未 onboard 的新用户」，
         boot() 会把深链排进 _pending（等向导走完才 flush）→ exec() 永不执行 → 面板恒 off。
         真实场景里点推送的必然是老用户（订阅入口在设置页），所以保留 state 才是对的前提。 */
      if(!sessionStorage.getItem('__pro_seeded')){
        localStorage.removeItem('sinoky_state');
        sessionStorage.setItem('__pro_seeded','1');
      }
    }catch(e){}
  });

  const BOOT = function(){
    return typeof S === 'object' && typeof LM === 'object' && typeof PRO === 'object'
        && typeof PATH === 'object' && typeof RP === 'object';
  };

  await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(BOOT, null, { timeout:15000 });
  await page.waitForTimeout(400);

  /* ---- 0. 干净学员模型 + 进入首页 ---- */
  const seed = await page.evaluate(function(){
    S.onboarded = true;
    S.lm = LM.defaults(); LM.migrate();
    S.rev = {}; S.streak = 0; S.lastDone = null;
    delete S.pushEnabled;
    LM.setTrip('', '', 0);
    go('home'); renderHome();
    saveState();
    return { pur: LM.get().goal.purpose, hasPRO: typeof PRO.decide === 'function' };
  });
  chk('前置 · 学员模型初始化', seed.pur === 'travel', '');
  chk('前置 · PRO 引擎就位', seed.hasPRO === true, '');

  /* ================= A. 前端决策树（干预式因果 A/B） ================= */
  const dec0 = await page.evaluate(function(){ return PRO.decide().kind; });
  chk('决策树 · 全无触发 → skip（D 分支：宁可不推）', dec0 === 'skip', dec0);

  const decTrip = await page.evaluate(function(){
    var t = new Date(Date.now() + 8*3600e3 + 86400e3).toISOString().slice(0,10);   /* 本地明天 */
    LM.setTrip('上海', t, 0);
    var d = PRO.decide();
    return { kind:d.kind, cityId:d.cityId, days:d.daysToTrip, set:d.set };
  });
  chk('决策树 · 设行程（明天到上海）→ trip', decTrip.kind === 'trip', decTrip.kind);
  chk('决策树 · 命中城市 id = shanghai', decTrip.cityId === 'shanghai', decTrip.cityId);
  chk('决策树 · daysToTrip = 1', decTrip.days === 1, decTrip.days);
  chk('决策树 · 行程包默认 10 句', decTrip.set === 10, decTrip.set);

  const decPri = await page.evaluate(function(){
    S.streak = 12; S.rev = { 'food#0': { ef:2.5, reps:1, iv:1, due:'2020-01-01' } };
    return PRO.decide().kind;      /* 行程 + 连胜 + 到期 同时命中 */
  });
  chk('决策树 · 优先级 A(trip) > B > C', decPri === 'trip', decPri);

  const decStreak = await page.evaluate(function(){
    LM.setTrip('', '', 0);         /* 清行程 → 落到 B */
    /* B 的判据是「连胜 ≥3 **且** 距上次开口 > 20h」。只设 streak 不设上次开口时间，
       hoursSince() 返回 null（从没开口过的人不可能有连胜，这是自相矛盾的人造状态），
       B 就不命中。真实老用户（v0.25 前无 buf）走的是 lastDone 兜底，所以这里补上。*/
    S.lastDone = new Date(Date.now() - 2*86400e3).toISOString().slice(0,10);
    return PRO.decide().kind;
  });
  chk('决策树 · 清行程后 → streak', decStreak === 'streak', decStreak);

  const decDue = await page.evaluate(function(){
    S.streak = 0;                  /* 清连胜 → 落到 C（S.rev 仍有到期项）*/
    return { kind: PRO.decide().kind, due: LM.dueCount() };
  });
  chk('决策树 · 清连胜后 → due', decDue.kind === 'due', decDue.kind);
  chk('决策树 · due 计数来自既有 S.rev（不自建调度）', decDue.due >= 1, decDue.due);

  const decSkipAgain = await page.evaluate(function(){
    S.rev = {};                    /* 清到期 → 回到 skip */
    return PRO.decide().kind;
  });
  chk('决策树 · 清到期后 → 回到 skip（干预可逆）', decSkipAgain === 'skip', decSkipAgain);

  const decToday = await page.evaluate(function(){
    /* 「刚刚开口」→ B（距上次 >20h）与 C（今天还没开口）都必须不命中。
       用 buf 注入一条当前时间戳的事件而不是只写 lastDone：lastDone 只有日期精度，
       UTC 20:00 之后跑测试会算出 h>20 → 误命中 B，断言随运行时刻抖动（假失败）。
       注入后立刻 pop 复原，不影响后续断言。 */
    var b = LM.get().buf;
    b.push({ k:'say', t:Date.now(), d:{} });
    S.streak = 12; S.lastDone = new Date().toISOString().slice(0,10);   /* 今天已开口 */
    var k = PRO.decide().kind;
    b.pop();
    S.lastDone = null;
    return k;
  });
  chk('决策树 · 连胜但今天已开口 → 不打扰', decToday === 'skip', decToday);

  /* ================= B. 行程包：零新增教学内容 ================= */
  const pk = await page.evaluate(function(){
    var p = PRO.tripPack('shanghai', 10);
    return { n:p.length, zones:p.map(function(x){ return x.zoneId; }),
             first:p[0], second:p[1],
             shapeOK:p.every(function(x){ return !!(x.hz && x.py && x.en && x.zoneId && x.idx !== undefined); }) };
  });
  chk('行程包 · shanghai 取到 10 句', pk.n === 10, pk.n);
  chk('行程包 · 字段齐备（hz/py/en/zoneId/idx）', pk.shapeOK === true, '');
  chk('行程包 · 跨 zone 轮转（前两句来自不同 zone）', pk.first.zoneId !== pk.second.zoneId, pk.first.zoneId + ' vs ' + pk.second.zoneId);
  chk('行程包 · 覆盖 ≥3 个 zone', new Set(pk.zones).size >= 3, 'zones=' + new Set(pk.zones).size);

  const pkSrc = await page.evaluate(function(){
    /* 结构性断言：行程包每一句都能在既有 CITY_GUIDES 里**原样**找到 → 零新增教学内容 */
    var found = {}, zones = {};
    Object.keys(CITY_GUIDES).forEach(function(cid){
      (CITY_GUIDES[cid].zones || []).forEach(function(z){
        zones[cid + ':' + z.id] = true;
        (z.phrases || []).forEach(function(p){ found[p.hz + '|' + p.py] = 1; });
      });
    });
    var miss = [];
    ['shanghai', 'beijing', 'chengdu'].forEach(function(cid){
      PRO.tripPack(cid, 10).forEach(function(it){
        if(!found[it.hz + '|' + it.py]) miss.push(cid + ':' + it.hz);
        if(!zones[cid + ':' + it.zoneId]) miss.push('zone?' + cid + ':' + it.zoneId);
      });
    });
    return { miss: miss.slice(0, 6), n: miss.length };
  });
  chk('行程包 · 每一句都原样来自既有 CITY_GUIDES（零新增教学内容）', pkSrc.n === 0, pkSrc.miss.join(', '));

  const pkEdge = await page.evaluate(function(){
    return { unknown: PRO.tripPack('atlantis', 10).length,
             bj: PRO.tripPack('beijing', 10).length,
             cd: PRO.tripPack('chengdu', 10).length,
             cap: PRO.tripPack('shanghai', 999).length,
             name: PRO.packFor('上海', 4).length,
             idOf: PRO.cityIdOf('北京'), nameOf: PRO.cityNameOf('chengdu') };
  });
  chk('行程包 · 未知城市 → 空数组（不抛）', pkEdge.unknown === 0, pkEdge.unknown);
  chk('行程包 · 北京可打包', pkEdge.bj === 10, pkEdge.bj);
  chk('行程包 · 成都可打包', pkEdge.cd === 10, pkEdge.cd);
  chk('行程包 · 超量请求被内容总量封顶', pkEdge.cap > 10 && pkEdge.cap <= 40, pkEdge.cap);
  chk('行程包 · 传中文城市名也能取（packFor）', pkEdge.name === 4, pkEdge.name);
  chk('城市映射 · 中文名 → id', pkEdge.idOf === 'beijing', pkEdge.idOf);
  chk('城市映射 · id → 中文名', pkEdge.nameOf === '成都', pkEdge.nameOf);

  /* ================= C. 首页主动卡 ================= */
  const cardSkip = await page.evaluate(function(){
    S.lm = LM.defaults(); LM.migrate(); LM.setTrip('', '', 0);
    S.streak = 0; S.rev = {}; S.lastDone = null;
    renderHome();
    return document.getElementById('home-scenes').innerHTML.indexOf('Trip pack') > -1;
  });
  chk('首页卡 · skip 状态不渲染主动卡（不占位）', cardSkip === false, '');

  const cardTrip = await page.evaluate(function(){
    var t = new Date(Date.now() + 8*3600e3 + 86400e3).toISOString().slice(0,10);
    LM.setTrip('上海', t, 0);
    renderHome();
    var h = document.getElementById('home-scenes').innerHTML;
    return { hasText: h.indexOf('Trip pack') > -1,
             chips: document.querySelectorAll('#home-scenes [onclick*="openTrip"]').length,
             hasCity: /Shanghai/.test(h) };
  });
  chk('首页卡 · trip 状态渲染主动卡', cardTrip.hasText === true, '');
  chk('首页卡 · 带 openTrip 入口', cardTrip.chips === 1, cardTrip.chips);
  chk('首页卡 · 英文文案用罗马化城市名（不出现中文）', cardTrip.hasCity === true, '');

  /* ================= D. 行程包面板 + 评分回流（同链原则） ================= */
  const panel = await page.evaluate(function(){
    var ok = openTrip('shanghai', 10);
    var ov = document.getElementById('trip');
    return { ok:ok, on: ov && ov.classList.contains('on'),
             rows: document.querySelectorAll('#trip-body .trip-row').length,
             title: (document.getElementById('trip-t')||{}).textContent || '',
             prog: (document.getElementById('trip-prog')||{}).textContent || '' };
  });
  chk('面板 · openTrip 打开', panel.ok === true && panel.on === true, '');
  chk('面板 · 渲染 10 行', panel.rows === 10, panel.rows);
  chk('面板 · 标题含「行程包」+ 城市', /Trip pack/.test(panel.title) && /上海/.test(panel.title), panel.title);
  chk('面板 · 进度 0 / 10', panel.prog === '0 / 10', panel.prog);

  const flow = await page.evaluate(async function(){
    /* 干预式 A/B：前后比对 tone 维度，证明行程包评分**真的回流**（不是只画了个分数） */
    var before = LM.get().abil.tone;
    var bufBefore = LM.get().buf.length;
    var it = PRO.tripPack('shanghai', 10)[0];
    var box = document.getElementById('tp-score-0');
    if(!box){ renderTrip(); box = document.getElementById('tp-score-0'); }
    await sendTripScore(it, it.hz, 0, box);
    var m = LM.get();
    /* 抓「存在 score 事件」而不是「最后一条事件」：ingestScore 在命中的每一句上还会
       顺链调 PATH.markSaid → LM.event('say')，所以 score 之后必然还有 say。
       用存在性断言既更稳，也更精确地表达「走的是唯一回流入口 ingestScore」。*/
    var sc = null;
    for(var i=m.buf.length-1; i>=0; i--){ if(m.buf[i] && m.buf[i].k === 'score'){ sc = m.buf[i]; break; } }
    return { before: before, after: m.abil.tone, bufGrew: m.buf.length > bufBefore,
             lastK: (m.buf[m.buf.length-1]||{}).k,
             scoreK: sc ? sc.k : '(none)', lastS: (sc && sc.d && sc.d.s) || '',
             boxLen: (box.innerHTML || '').length, boxErr: /score-err/.test(box.innerHTML || '') };
  });
  chk('回流 · tone 维度真的上升（干预式 A/B）', flow.after > flow.before, flow.before + ' → ' + flow.after);
  chk('回流 · LM.buf 新增事件', flow.bufGrew === true, '');
  chk('回流 · 存在 score 事件（走唯一入口 ingestScore）', flow.scoreK === 'score', flow.scoreK + ' / 末条=' + flow.lastK);
  chk('回流 · 事件 key 用 city:<zoneId>（不污染 SCENES 的 key 空间）', flow.lastS.indexOf('city:') === 0, flow.lastS);
  chk('回流 · 渲染了评分结果', flow.boxLen > 0 && flow.boxErr === false, flow.boxLen);

  /* ================= E. 里程碑（整包说完） ================= */
  const mile = await page.evaluate(function(){
    for(var i=0;i<tripItems.length;i++){ tripDone[i] = true; }
    tripMark(0); tripMark(0);                 /* 触发一次判定（幂等：先标记再取消再标记）*/
    for(var j=0;j<tripItems.length;j++){ tripDone[j] = true; }
    tripMark(0); tripMark(0);
    var m = LM.get();
    return { has: (m.mile || []).some(function(x){ return x.id === 'trip:shanghai'; }),
             len: (m.mile || []).length, prog: (document.getElementById('trip-prog')||{}).textContent };
  });
  chk('里程碑 · 整包说完写入 trip:shanghai', mile.has === true, 'mile=' + mile.len);
  chk('里程碑 · 进度显示 10 / 10', mile.prog === '10 / 10', mile.prog);

  const closeOk = await page.evaluate(function(){
    closeTrip();
    var ov = document.getElementById('trip');
    return { on: ov.classList.contains('on'), items: tripItems.length };
  });
  chk('面板 · closeTrip 关闭并清空队列', closeOk.on === false && closeOk.items === 0, '');

  /* ================= F. 快照（PUSH KV 的 payload 形状） ================= */
  const snap = await page.evaluate(function(){
    var t = new Date(Date.now() + 8*3600e3 + 86400e3).toISOString().slice(0,10);
    LM.setTrip('北京', t, 0);
    S.streak = 7;
    S.rev = { 'food#0': { ef:2.5, reps:1, iv:1, due:'2020-01-01' } };
    var s = PRO.snapshotPlus();
    return { keys: Object.keys(s).sort().join(','), city: s.city, cityId: s.cityId, cityEn: s.cityEn,
             arrive: s.arrive, tz: s.tz, lang: s.lang, streak: s.streak, due: s.due,
             atOK: typeof s.at === 'number' && s.at > 1600000000000,
             cnInEn: /[\u4e00-\u9fa5]/.test(s.cityEn) };
  });
  chk('快照 · 含 city/cityId/cityEn/arrive', snap.city === '北京' && snap.cityId === 'beijing' && snap.cityEn === 'Beijing', JSON.stringify(snap));
  chk('快照 · cityEn 已罗马化（英文推送不会出现中文）', snap.cnInEn === false, snap.cityEn);
  chk('快照 · arrive 存原始日期（不是会过期的差值）', /^\d{4}-\d{2}-\d{2}$/.test(snap.arrive), snap.arrive);
  chk('快照 · 带 tz 与时区偏移', typeof snap.tz === 'number', snap.tz);
  chk('快照 · 带 lang（推送文案语言）', !!snap.lang, snap.lang);
  chk('快照 · 带 streak / due（粗桶）', snap.streak === 7 && snap.due >= 1, snap.streak + '/' + snap.due);
  chk('快照 · 带 at 时间戳', snap.atOK === true, '');

  const noPush = await page.evaluate(function(){
    S.pushEnabled = false;
    PRO.syncSnapshot();
    return true;
  });
  void noPush;
  await page.waitForTimeout(400);
  chk('KV 纪律 · 未订阅时 syncSnapshot 不发请求（新增 KV 写 = 0）', seen.pushSub.length === 0, seen.pushSub.length);

  /* ================= G. 行程录入 UI ================= */
  const setting = await page.evaluate(function(){
    go('settings');
    renderTripSetting();
    var sel = document.getElementById('trip-city');
    return { opts: sel ? sel.options.length : 0,
             value: sel ? sel.value : '',
             date: (document.getElementById('trip-arrive')||{}).value || '',
             hint: (document.getElementById('set-triphint')||{}).textContent || '' };
  });
  chk('设置页 · 城市下拉有 3 城 + 「不设置」', setting.opts === 4, setting.opts);
  chk('设置页 · 回填已存行程（beijing）', setting.value === 'beijing', setting.value);
  chk('设置页 · 回填到达日期', /^\d{4}-\d{2}-\d{2}$/.test(setting.date), setting.date);
  chk('设置页 · 提示显示倒计时', /Beijing/.test(setting.hint) || /天|day/.test(setting.hint), setting.hint);

  const save = await page.evaluate(function(){
    document.getElementById('trip-city').value = 'chengdu';
    document.getElementById('trip-arrive').value = '2026-12-24';
    saveTrip();
    var m = LM.get();
    return { city: m.trip && m.trip.city, arrive: m.trip && m.trip.arrive, goalCities: (m.goal.cities || []).join(','), pur: m.goal.purpose };
  });
  chk('设置页 · saveTrip 写入中文城市名', save.city === '成都', save.city);
  chk('设置页 · saveTrip 写入日期', save.arrive === '2026-12-24', save.arrive);
  chk('设置页 · 同步 lm.goal.cities（既有读取点不破）', save.goalCities === '成都', save.goalCities);

  const clear = await page.evaluate(function(){
    document.getElementById('trip-city').value = '';
    saveTrip();
    var m = LM.get();
    return { trip: m.trip, city: (document.getElementById('trip-city')||{}).value };
  });
  chk('设置页 · 选「不设置」→ 清空行程', clear.trip === null, JSON.stringify(clear.trip));

  /* ================= H. 深链路由（含一次性消费）================= */
  const routeT = await (async function(){
    await page.goto(BASE + '/index.html?go=trip&city=shanghai&set=10', { waitUntil:'domcontentloaded' });
    await page.waitForFunction(BOOT, null, { timeout:15000 });
    await page.waitForTimeout(1500);                 /* boot() 内 900ms 延迟执行 */
    return page.evaluate(function(){
      var ov = document.getElementById('trip');
      return { search: location.search, on: !!ov && ov.classList.contains('on'),
               rows: document.querySelectorAll('#trip-body .trip-row').length };
    });
  })();
  chk('深链 ?go=trip · 直达行程包面板', routeT.on === true, JSON.stringify(routeT));
  chk('深链 ?go=trip · 按 set=10 渲染 10 句', routeT.rows === 10, routeT.rows);
  chk('深链 · 一次性消费（query 被 replaceState 清掉）', routeT.search === '', routeT.search);

  const routeR = await (async function(){
    await page.goto(BASE + '/index.html?go=roleplay&task=order-food', { waitUntil:'domcontentloaded' });
    await page.waitForFunction(BOOT, null, { timeout:15000 });
    await page.waitForTimeout(1500);
    return page.evaluate(function(){
      var ov = document.getElementById('rp');
      return { search: location.search, on: !!ov && ov.classList.contains('on'),
               task: (typeof RP.get === 'function' && RP.get() && RP.get().task && RP.get().task.id) || '' };
    });
  })();
  chk('深链 ?go=roleplay · 直达点餐扮演', routeR.on === true && routeR.task === 'order-food', JSON.stringify(routeR));
  chk('深链 ?go=roleplay · query 已清', routeR.search === '', routeR.search);

  const routeV = await (async function(){
    await page.goto(BASE + '/index.html?go=review&due=1', { waitUntil:'domcontentloaded' });
    await page.waitForFunction(BOOT, null, { timeout:15000 });
    await page.waitForTimeout(1500);
    return page.evaluate(function(){
      var v = document.getElementById('v-review');
      return { search: location.search, on: !!v && v.classList.contains('on') };
    });
  })();
  chk('深链 ?go=review · 切到复习视图', routeV.on === true, JSON.stringify(routeV));

  const routeBad = await (async function(){
    await page.goto(BASE + '/index.html?go=nonsense', { waitUntil:'domcontentloaded' });
    await page.waitForFunction(BOOT, null, { timeout:15000 });
    await page.waitForTimeout(900);
    return page.evaluate(function(){
      return { search: location.search, home: !!document.getElementById('v-home') };
    });
  })();
  chk('深链 · 未知 go 不动作且**不吞掉** query（不误伤其他参数）', routeBad.search.indexOf('go=nonsense') > -1, routeBad.search);

  /* ================= I. 回归与稳定性 ================= */
  const reg = await page.evaluate(function(){
    return { rp: typeof RP.tasks === 'function' && RP.tasks().length === 6,
             session: typeof SESSION.start === 'function',
             path: typeof PATH.todayCard === 'function',
             share: typeof SHARE.draw === 'function',
             city3: Object.keys(CITY_GUIDES).length === 3,
             noDay1: Object.keys(CITY_GUIDES).every(function(cid){
                        return (CITY_GUIDES[cid].zones || []).every(function(z){ return z.day1 === undefined; });
                      }) };
  });
  chk('回归 · RP 场景教练仍 6 场景', reg.rp === true, '');
  chk('回归 · SESSION / PATH / SHARE 未受影响', reg.session && reg.path && reg.share, '');
  chk('回归 · CITY_GUIDES 三城齐备', reg.city3 === true, '');
  chk('红线 · 新增 zone 未带 day1 字段（防污染城市识别）', reg.noDay1 === true, '');

  /* ---- 汇总 ---- */
  chk('稳定性 · 零页面错误', errs.length === 0, errs.join(' | '));
  const pass = R.filter(function(x){ return x.ok; }).length;
  const fails = R.filter(function(x){ return !x.ok; });
  R.forEach(function(x){ console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.name + (x.extra ? '  → ' + x.extra : '')); });
  console.log('\n页面错误 = ' + (errs.length ? JSON.stringify(errs.slice(0,5)) : '0 ✅'));
  console.log('──────────────────────────────────────────────');
  console.log((fails.length === 0 ? '✅ 主动引擎真跑验收全绿' : '❌ 主动引擎真跑验收有失败') + ' — ' + pass + ' / ' + R.length);
  console.log('──────────────────────────────────────────────');

  await browser.close();
  srv.close();
  process.exit(fails.length === 0 && errs.length === 0 ? 0 : 1);
})().catch(function(e){ console.error('FATAL', e); process.exit(1); });
