#!/usr/bin/env node
/* v0.26.0 验收：Daily Session 2.0（连贯会话 + 同链回流 + 策略可见）—— **真跑**（康哥铁律）。
   本地 http server → Playwright 驱动本机 Chrome → mock 全部 /api/* → 断言**行为**。
   核心：不仅测「跑通」，还要测「因果」——学员模型状态真的改变了选句权重。
   用法：NODE_PATH=<workspace>/node_modules node _internal/test_session.cjs */
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
        if(pth === '/api/register') return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, uid:'sess-test-uid-0001' }) });
        if(pth === '/api/score')    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ overall:88, verdict:'Great',
          perSyll:[ { target:'你', user:'你', score:1, toneOk:true },
                    { target:'好', user:'好', score:1, toneOk:true },
                    { target:'吗', user:'吗', score:1, toneOk:true } ] }) });
        if(pth === '/api/asr')      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, text:'你好吗' }) });
        return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
      }
      return route.continue();
    }
    return route.abort();
  });

  await page.addInitScript(function(){
    try{
      localStorage.setItem('sinoky_lang_chosen','1');
      localStorage.removeItem('sinoky_state');
    }catch(e){}
  });

  await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(function(){ return typeof S === 'object' && typeof LM === 'object' && typeof PATH === 'object' && typeof SESSION === 'object'; }, null, { timeout:15000 });
  await page.waitForTimeout(500);

  /* ---- 0. 前置：清一个干净学员模型，设 travel 目标 → t1 节点 ---- */
  const seed = await page.evaluate(function(){
    S.lm = LM.defaults();
    LM.migrate();
    LM.setGoal({ purpose:'travel', cities:['上海'], arrive:'2026-10-05', native:'en' });
    var c = PATH.todayCard();
    return { fam:LM.get().path.fam, node:c && c.node && c.node.id };
  });
  chk('前置 · 干净学员模型置为 travel 族', seed.fam === 'travel' && seed.node === 't1', seed.fam + '/' + seed.node);

  /* ---- 1. 会话队列：1 必说 + 2 顺带 + ≤1 复习，且去重 ---- */
  const q = await page.evaluate(function(){
    var list = SESSION.queue();
    var keys = list.map(function(x){ return x.key; });
    var uniq = {}; keys.forEach(function(k){ uniq[k] = 1; });
    return { n:list.length, tags:list.map(function(x){ return x.tag; }), uniq:Object.keys(uniq).length,
             hasHz:!!(list[0] && list[0].hz), hasWhy:!!(list[0] && list[0].why && list[0].why.length) };
  });
  chk('会话 · 队列非空且去重', q.n >= 3 && q.uniq === q.n, 'n=' + q.n + ' uniq=' + q.uniq);
  chk('会话 · 队首是「必说」', q.tags[0] === 'must', q.tags.join(','));
  chk('会话 · 队列项含真实中文与选句理由', q.hasHz === true && q.hasWhy === true, JSON.stringify(q));

  /* ---- 2. 启动：面板打开 + 渲染出句子 ---- */
  const st = await page.evaluate(function(){
    var ok = SESSION.start();
    var panel = document.getElementById('sess');
    var body = document.getElementById('sess-body');
    var hz = document.querySelector('#sess-body .sess-hz');
    return { ok:ok, on:panel ? panel.classList.contains('on') : false,
             bodyLen: body ? body.innerHTML.length : 0,
             hz: hz ? hz.innerText : '', prog:(document.getElementById('sess-prog')||{}).textContent };
  });
  chk('会话 · start() 打开面板', st.ok === true && st.on === true, JSON.stringify(st));
  chk('会话 · 渲染出当前句中文 + 进度', st.hz.length > 0 && /1 \//.test(String(st.prog)), st.hz + ' | ' + st.prog);

  /* ---- 3. 同链回流：会话评分 → LM.ingestScore（与 reader 一条链）---- */
  const sc = await page.evaluate(async function(){
    var it = SESSION.item();
    var before = LM.get().abil.tone;
    var beforeM = LM.isMastered(it.key);
    await sessScore('你好吗');
    var cur = SESSION.get();
    var nx = document.getElementById('sess-next');
    var mb = document.getElementById('sess-mic');
    var out = { key:it.key, resLen:cur.res.length, beforeM:beforeM, mastered:LM.isMastered(it.key),
             toneBefore:before, toneAfter:LM.get().abil.tone,
             nextShown: nx ? nx.style.display : 'NA', micHidden: mb ? mb.style.display : 'NA',
             scored: !!document.querySelector('#sess-score .score-card') };
    SESSION.advance();   /* 模拟用户点「下一句」 */
    out.iAfter = SESSION.get().i;
    return out;
  });
  chk('同链 · 会话评分渲染出评分卡', sc.scored === true, '');
  chk('同链 · 说对(≥80)写入 mastered（与 reader 共用 ingestScore）', sc.beforeM === false && sc.mastered === true, sc.key);
  chk('同链 · 评分驱动能力向量变化', sc.toneAfter > sc.toneBefore, sc.toneBefore + ' → ' + sc.toneAfter);
  chk('同链 · 记录进会话结果集', sc.resLen === 1, 'resLen=' + sc.resLen);
  chk('会话 · 评分后出现「下一句」并收起麦克风按钮', sc.nextShown === 'inline-block' && sc.micHidden === 'none',
      sc.nextShown + ' / ' + sc.micHidden);
  chk('会话 · advance() 推进到下一句', sc.iAfter === 1, 'i=' + sc.iAfter);

  /* ---- 4. 走完全部 → 结算页 ---- */
  const end = await page.evaluate(async function(){
    var guard = 0;
    while(SESSION.item() && guard < 12){
      await sessScore('你好吗');
      SESSION.advance();
      guard++;
    }
    var s = SESSION.summary();
    var body = document.getElementById('sess-body').innerHTML;
    return { guard:guard, s:s, isSummary: body.indexOf(s.total + ' / ' + s.total) >= 0,
             prog:(document.getElementById('sess-prog')||{}).textContent };
  });
  chk('会话 · 逐句推进至结束（无死循环）', end.guard >= 2 && end.guard <= 12, 'steps=' + end.guard);
  chk('会话 · 结算页出现且显示 N / N', end.isSummary === true, JSON.stringify(end.s));
  chk('会话 · 结算统计正确（said = total）', end.s.said === end.s.total && end.s.avg > 0, JSON.stringify(end.s));

  /* ---- 5. finish：事件入短期记忆 + 节点按「说对句数」推进 ---- */
  const fin = await page.evaluate(function(){
    var doneBefore = LM.get().path.done.slice();
    var evBefore = (LM.get().buf || []).filter(function(e){ return e.k === 'session'; }).length;
    var s = SESSION.finish();
    SESSION.close();
    var m = LM.get();
    return { doneBefore:doneBefore, doneAfter:m.path.done.slice(),
             evBefore:evBefore, evAfter:(m.buf || []).filter(function(e){ return e.k === 'session'; }).length,
             closed: !document.getElementById('sess').classList.contains('on'),
             curGone: SESSION.get() === null, ok:s.ok, mustSay:3 };
  });
  chk('闭环4→5 · 会话结束写入事件流（短期记忆）', fin.evAfter === fin.evBefore + 1, fin.evBefore + ' → ' + fin.evAfter);
  chk('闭环8 · 说对句数达标即推进节点 t1', fin.doneAfter.indexOf('t1') >= 0 && fin.doneBefore.indexOf('t1') < 0, fin.doneAfter.join(','));
  chk('会话 · close() 关面板并清状态', fin.closed === true && fin.curGone === true, '');

  /* ---- 6. 策略可见（机制）：昨日卡 → 今日卡差集 ---- */
  const pol = await page.evaluate(function(){
    var c = PATH.todayCard();
    var cur = PATH.keysOf(c);
    var m = LM.get();
    /* 注入「上一次会话（不同日期）」的卡 —— 模拟策略调整后的昨日卡 */
    m.policy.cardLog = [{ d:'2026-09-20', k:'arrival#9,arrival#7', n:2 }];
    var df = PATH.cardDiff();
    return { cur:cur, df:df };
  });
  chk('闭环7 · cardDiff 能报出「今天有几句是新换上的」', !!(pol.df && typeof pol.df.changed === 'number'), JSON.stringify(pol.df));
  chk('闭环7 · 与上次会话不同的句数 > 0（可见地不同）', !!(pol.df && pol.df.changed > 0), 'changed=' + (pol.df && pol.df.changed));

  /* ---- 7. 策略可见（因果）：学员模型状态真的改变选句得分 ---- */
  /* 因果 A：已掌握 ⇒ 权重下降 */
  const causA = await page.evaluate(function(){
    var c = PATH.todayCard();
    var it = (c.extra && c.extra[0]) || (c.must && c.must[0]);
    var k = PATH.key(it);
    var s0 = PATH.score(it);
    LM.master(k);                     /* 干预：标记为已掌握 */
    return { k:k, s0:s0, s1:PATH.score(it) };
  });
  chk('闭环7 · 已掌握 ⇒ 选句权重下降（0.20 项消失）', causA.s1 < causA.s0, causA.s0 + ' → ' + causA.s1);

  /* 因果 B：声调弱点 ⇒ 权重上升（按句子真实声调选靶，确定性） */
  const causB = await page.evaluate(function(){
    var m = LM.get();
    m.weak = [];                      /* 清空既有弱点，保证对照干净 */
    var c = PATH.todayCard();
    var pool = (c.must||[]).concat(c.extra||[]).concat(c.review||[]);
    var pick = null, want = 0, i, lv, t;
    for(i=0;i<pool.length && !pick;i++){
      t = PATH.tonesOf(pool[i]);
      for(lv=1;lv<=4;lv++){ if(t[lv]){ pick = pool[i]; want = lv; break; } }
    }
    if(!pick) return { ok:false };
    var s0 = PATH.score(pick);
    LM.weakBump('tone' + want, 5);    /* 干预：制造该声调弱点 */
    return { ok:true, want:want, hz:pick.hz, s0:s0, s1:PATH.score(pick), why:PATH.whyOf(pick) };
  });
  chk('闭环7 · 弱点 ⇒ 选句权重上升（0.35 命中）', causB.ok === true && causB.s1 > causB.s0,
      'tone' + causB.want + ' ' + causB.hz + ' ' + causB.s0 + ' → ' + causB.s1);
  chk('闭环7 · 选句理由可解释（why 指向命中项）', !!(causB.why && causB.why.indexOf('weak') >= 0), JSON.stringify(causB.why));

  /* ---- 8. 首页：会话入口 + 策略变更提示 ---- */
  const home = await page.evaluate(function(){
    renderHome();
    var el = document.getElementById('home-scenes');
    var h = el ? el.innerHTML : '';
    return { hasStart: h.indexOf('SESSION.start()') >= 0, hasWhy: h.indexOf('your weak spot') >= 0 || h.indexOf('a fresh line') >= 0,
             hasPath: h.indexOf("Today's path") >= 0 };
  });
  chk('首页 · 今日路径卡保留', home.hasPath === true, '');
  chk('首页 · 新增「开始今日会话」入口', home.hasStart === true, '');
  chk('首页 · 每句展示选句理由', home.hasWhy === true, '');

  /* ---- 9. i18n：中文下新文案必须是中文 ---- */
  const zh = await page.evaluate(async function(){
    setLang('zh');
    await new Promise(function(r){ setTimeout(r, 900); });
    return { a:T('Say it'), b:T('Practice session'), c:T('Start today\u2019s session'),
             d:T('Average score'), e:T('Why this line'), f:T('Nothing queued yet \u2014 open any scene to start practising.') };
  });
  chk('i18n · 会话文案中文生效（零英文 fallback）',
      zh.a === '说这句' && zh.b === '今日练习' && zh.c === '开始今日练习' && zh.d === '平均分' && zh.e === '为什么练这句',
      [zh.a, zh.b, zh.c, zh.d, zh.e].join(' / '));

  chk('运行期无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  srv.close();

  const pass = R.filter(function(x){ return x.ok; }).length;
  R.forEach(function(x){ console.log((x.ok ? '  PASS  ' : '  FAIL  ') + x.name + (x.extra ? '   [' + x.extra + ']' : '')); });
  console.log('\n' + pass + '/' + R.length + ' passed');
  console.log(pass === R.length ? 'SESSION_CLOSURE_PASS=true' : 'SESSION_CLOSURE_PASS=false');
  process.exit(pass === R.length ? 0 : 1);
})().catch(function(e){ console.log('FATAL', e && e.message); try{ srv.close(); }catch(_){} process.exit(2); });
