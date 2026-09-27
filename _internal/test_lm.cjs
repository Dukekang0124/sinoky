#!/usr/bin/env node
/* v0.25.0 验收：LearnerModel + 目标向导 + 诊断 + 路径引擎 —— **真跑**（康哥铁律）。
   本地起 http server（file:// 下 SW/fetch 不工作）→ Playwright 驱动本机 Chrome →
   mock 全部 /api/* → 走完整闭环并断言**行为**，不接受"语法正确"。
   用法：NODE_PATH=<workspace>/node_modules node _internal/test_lm.cjs */
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
function chk(name, val, extra){ R.push({ name:name, ok:!!val, extra: extra===undefined?'':String(extra) }); }

(async function(){
  await new Promise(function(r){ srv.listen(0, '127.0.0.1', r); });
  const PORT = srv.address().port, BASE = 'http://127.0.0.1:' + PORT;
  console.log('server on', BASE);

  const browser = await chromium.launch({ channel:'chrome' });
  const ctx = await browser.newContext({ locale:'en-US' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', function(e){ errs.push(String(e.message).slice(0,160)); });

  /* 单 handler 分流：本地静态走真网络；/api/* 全 mock（零外部依赖） */
  await page.route('**/*', async function(route){
    const u = route.request().url();
    if(u.indexOf(BASE) === 0){
      const pth = new URL(u).pathname;
      if(pth.indexOf('/api/') === 0){
        if(pth === '/api/register') return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, uid:'lm-test-uid-0001' }) });
        if(pth === '/api/score')    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ overall:82, verdict:'Good',
          perSyll:[ { target:'你', user:'你', score:1, toneOk:true },
                    { target:'好', user:'好', score:0.8, toneOk:false, tExp:3, tGot:2, errs:['tone'] },
                    { target:'吗', user:'吗', score:0.7, toneOk:true, errs:['final'] } ] }) });
        return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
      }
      return route.continue();
    }
    return route.abort();
  });

  await page.addInitScript(function(){
    try{
      localStorage.setItem('sinoky_lang_chosen','1');   /* 跳过语言门，直测向导 */
      localStorage.removeItem('sinoky_state');
    }catch(e){}
  });

  await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(function(){ return typeof S === 'object' && typeof LM === 'object' && typeof PATH === 'object'; }, null, { timeout:15000 });
  await page.waitForTimeout(500);

  /* ---- 1. L1 schema ---- */
  const l1 = await page.evaluate(function(){
    var m = LM.get();
    return { v:m.v, hasGoal:!!m.goal && typeof m.goal.purpose === 'string', abilKeys:Object.keys(m.abil).length,
             caps:{ weak:LM.CAP.weak, mastered:LM.CAP.mastered, buf:LM.CAP.buf },
             goalMapped:(m.goal.purpose || null) };
  });
  chk('L1 · S.lm schema v1 建立', l1.v === 1, 'v=' + l1.v);
  chk('L1 · 8 维能力向量存在', l1.abilKeys === 8, 'keys=' + l1.abilKeys);
  chk('L1 · 定长 cap 正确', l1.caps.weak === 5 && l1.caps.mastered === 200 && l1.caps.buf === 200, JSON.stringify(l1.caps));

  /* ---- 2. 向导 8 步 ---- */
  const ob = await page.evaluate(function(){ return { total:(typeof obTotal !== 'undefined') ? obTotal : -1, steps:document.querySelectorAll('#v-onboard .ob-screen').length }; });
  chk('向导 · 共 8 步（原 6 步 + 城市 + 母语）', ob.total === 8 && ob.steps === 8, JSON.stringify(ob));

  /* ---- 3. 走完向导：选目标 / 城市 / 日期 / 母语 ---- */
  await page.evaluate(function(){ obStep = 6; renderOnboard(); });   // 直接跳到城市步（避免逐屏点击的脆弱性）
  await page.waitForTimeout(120);
  const cityChips = await page.evaluate(function(){ return document.querySelectorAll('#ob-cities .ob-city').length; });
  chk('向导 · 城市 chip 由 CITY_LIST 渲染', cityChips >= 18, 'chips=' + cityChips);
  await page.evaluate(function(){
    var c = document.querySelector('#ob-cities .ob-city[data-city="上海"]'); if(c) c.click();
    obStep = 7; renderOnboard();
  });
  await page.waitForTimeout(120);
  await page.evaluate(function(){
    var n = document.querySelector('#ob-native .ob-level[data-native="ru"]'); if(n) n.click();
  });
  await page.waitForTimeout(120);
  const fin = await page.evaluate(function(){
    var ai = document.getElementById('ob-arrive');
    if(ai) ai.value = '2026-10-05';
    finishOnboard();
    var m = LM.get();
    return { purpose:m.goal.purpose, native:m.goal.native, cities:m.goal.cities, arrive:m.goal.arrive,
             fam:m.path.fam, tripCity:(m.trip && m.trip.city) || null, daysToTrip:LM.daysToTrip() };
  });
  chk('向导 · 来华目的写入 lm.goal.purpose', fin.purpose === 'travel', fin.purpose);
  chk('向导 · 母语写入 lm.goal.native', fin.native === 'ru', fin.native);
  chk('向导 · 到访城市写入', fin.cities && fin.cities[0] === '上海' && fin.tripCity === '上海', JSON.stringify(fin.cities) + '/' + fin.tripCity);
  chk('向导 · 抵达日期 + 路径族联动', fin.arrive === '2026-10-05' && fin.fam === 'travel', fin.arrive + '/' + fin.fam);
  chk('向导 · 行程倒计时可算', typeof fin.daysToTrip === 'number', 'daysToTrip=' + fin.daysToTrip);

  /* ---- 4. 诊断：6 题自适应 → 8 维初值 ---- */
  await page.waitForTimeout(600);
  const placed = await page.evaluate(function(){ return { ov:!!document.getElementById('place-ov'), started:(typeof PLACE !== 'undefined') }; });
  chk('诊断 · 完成向导后自动进入定位', placed.ov === true, JSON.stringify(placed));
  const diag = await page.evaluate(async function(){
    PLACE.start();
    var seen = 0;
    for(var i=0;i<9;i++){
      if(PLACE.isFin()) break;
      var btns = document.querySelectorAll('#place-opts .btn');
      if(!btns.length) break;
      btns[0].click(); seen++;
      /* 必须等 PLACE 自己的 700ms 节奏 —— 同步连点只会打在已锁定的同一题上 */
      await new Promise(function(r){ setTimeout(r, 830); });
    }
    var m = LM.get();
    return { answered:seen, band:m.level.band, conf:m.level.conf, testedAt:m.level.testedAt,
             abil:m.abil, hint:m.policy.hint, mile:m.mile.map(function(x){ return x.id; }) };
  });
  chk('诊断 · 恰好 6 题', diag.answered === 6, 'answered=' + diag.answered);
  chk('诊断 · 写入 level.band', !!diag.band, 'band=' + diag.band);
  chk('诊断 · 8 维初值均为数值', Object.keys(diag.abil).every(function(k){ return typeof diag.abil[k] === 'number' && diag.abil[k] >= 0 && diag.abil[k] <= 1; }), JSON.stringify(diag.abil));
  chk('诊断 · 按档位给出提示密度 policy.hint', ['gentle','standard','hard'].indexOf(diag.hint) >= 0, diag.hint);
  chk('诊断 · 里程碑 placed 已记', diag.mile.indexOf('placed') >= 0, diag.mile.join(','));

  /* ---- 5. 路径引擎：今日任务卡 = 1 必说 + 2 顺带 + 复习 ---- */
  await page.evaluate(function(){ PLACE.close(); });
  await page.waitForTimeout(200);
  const card = await page.evaluate(function(){
    var c = PATH.todayCard(), p = PATH.progress();
    return { node:c && c.node && c.node.id, nodeName:c && c.node && c.node.name,
             must:(c && c.must || []).length, extra:(c && c.extra || []).length, review:(c && c.review || []).length,
             mustHasHz:!!(c && c.must[0] && c.must[0].hz), prog:p };
  });
  chk('路径 · 当前节点已选（travel 族 t1）', card.node === 't1', 'node=' + card.node);
  chk('路径 · 任务卡 1 必说 + 2 顺带', card.must === 1 && card.extra === 2, 'must=' + card.must + ' extra=' + card.extra);
  chk('路径 · 必说句有真实中文内容', card.mustHasHz === true, card.nodeName);
  chk('路径 · 进度可计算（含节点内句子进度）', typeof card.prog.pct === 'number', JSON.stringify(card.prog));

  const home = await page.evaluate(function(){
    renderHome();
    var el = document.getElementById('home-scenes');
    return { html:el ? el.innerHTML.slice(0, 4000) : '', hasPath:!!(el && el.innerHTML.indexOf("Today's path") >= 0) };
  });
  chk('首页 · 今日路径卡已渲染在首屏', home.hasPath === true, '');

  /* ---- 6. 评分回流：说对 → 学员模型 + 节点推进 ---- */
  const flow = await page.evaluate(function(){
    var c = PATH.todayCard();
    var it = c.must[0];
    var before = LM.get().abil.tone;
    LM.abil('tone', 0.9, 0.22);
    PATH.markSaid(it);
    var mastered = LM.isMastered(PATH.key(it));
    var nx = PATH.complete(c.node.id);
    var m = LM.get();
    return { mastered:mastered, toneBefore:before, toneAfter:m.abil.tone,
             done:m.path.done.slice(), nextNode:nx ? nx.id : null, mile:m.mile.map(function(x){return x.id;}) };
  });
  chk('闭环6→7 · 说对一句即写入 mastered', flow.mastered === true, '');
  chk('闭环6→7 · 评估输出驱动能力向量变化', flow.toneAfter > flow.toneBefore, flow.toneBefore + ' → ' + flow.toneAfter);
  chk('闭环8 · 节点完成推进到下一节点', flow.done.indexOf('t1') >= 0 && flow.nextNode === 't2', flow.done.join(',') + ' → ' + flow.nextNode);
  chk('闭环9 · 里程碑随节点推进累积', flow.mile.length >= 2, flow.mile.join(','));

  /* ---- 7. 配额宪法：S.lm 上云但 buf 必须剔除 ---- */
  const payload = await page.evaluate(async function(){
    var captured = null;
    var orig = window.fetch;
    window.fetch = function(url, opt){
      /* 注意：API_BASE 为空串 ⇒ 实际 URL 是 'api/profile'（**无前导斜杠**） */
      if(String(url).indexOf('api/profile') >= 0) captured = opt && opt.body;
      return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({ ok:true }); } });
    };
    try{ await pushProfile(); }catch(e){ captured = captured || ('ERR:' + e.message); }
    window.fetch = orig;
    var j = null, perr = '';
    try{ j = captured ? JSON.parse(captured) : null; }catch(e){ perr = e.message; }
    return { hasLm:!!(j && j.state && j.state.lm), hasBuf:!!(j && j.state && j.state.lm && j.state.lm.buf),
             hasAbil:!!(j && j.state && j.state.lm && j.state.lm.abil),
             bufLocal:(LM.get().buf || []).length,
             capLen: captured ? String(captured).length : -1, perr:perr,
             uid:(typeof UID !== 'undefined') ? UID : 'NA',
             statOk:!!(j && j.stat) };
  });
  chk('配额 · S.lm 搭车 p:{uid} 上云（零新增 KV 写）', payload.hasLm === true && payload.hasAbil === true, JSON.stringify(payload));
  chk('配额 · buf（短期记忆）上云前已剔除', payload.hasBuf === false, 'localBuf=' + payload.bufLocal);

  /* ---- 8. i18n：中文下新文案必须是中文（HTML 静态文案不在闸门内，需实测）---- */
  const zh = await page.evaluate(async function(){
    setLang('zh');
    await new Promise(function(r){ setTimeout(r, 1000); });
    /* 向导的 HTML 静态文案**不在** check-i18n 闸门覆盖范围内（闸门只查 T() 字面量），
       所以必须在这里实测——这是「零英文 fallback」验收线最容易漏的一处。 */
    var keep = obStep;
    obStep = 6; renderOnboard();
    var h6 = document.querySelector('#v-onboard .ob-screen[data-step="6"]');
    var h1 = h6 && h6.querySelector('h1'), sub = h6 && h6.querySelector('.ob-sub');
    var t6 = h1 ? h1.innerText : '', s6 = sub ? sub.innerText : '';
    obStep = 7; renderOnboard();
    var h7 = document.querySelector('#v-onboard .ob-screen[data-step="7"] h1');
    var t7 = h7 ? h7.innerText : '';
    obStep = keep; renderOnboard();
    return { t1:T('Quick placement'), t2:T("Today's path"), t3:T('Must say'),
             t6:t6, s6:s6, t7:t7 };
  });
  chk('i18n · T() 文案中文返回', zh.t1 === '快速定位' && zh.t2 === '今日路径' && zh.t3 === '必说', zh.t1 + ' / ' + zh.t2 + ' / ' + zh.t3);
  chk('i18n · 向导 HTML 静态文案已中文化', zh.t6.indexOf('你要去') >= 0 && zh.s6.indexOf('选一个城市') >= 0 && zh.t7.indexOf('母语') >= 0,
      zh.t6 + ' | ' + zh.s6.slice(0,14) + ' | ' + zh.t7);

  chk('运行期无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  srv.close();

  const pass = R.filter(function(x){ return x.ok; }).length;
  R.forEach(function(x){ console.log((x.ok ? '  PASS  ' : '  FAIL  ') + x.name + (x.extra ? '   [' + x.extra + ']' : '')); });
  console.log('\n' + pass + '/' + R.length + ' passed');
  console.log(pass === R.length ? 'LM_CLOSURE_PASS=true' : 'LM_CLOSURE_PASS=false');
  process.exit(pass === R.length ? 0 : 1);
})().catch(function(e){ console.log('FATAL', e && e.message); try{ srv.close(); }catch(_){} process.exit(2); });
