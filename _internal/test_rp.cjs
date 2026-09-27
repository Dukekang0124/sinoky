#!/usr/bin/env node
/* v0.27.0 验收：M3 场景教练（Roleplay Engine）—— **真跑**（康哥铁律）。
   本地 http server → Playwright 驱动本机 Chrome → mock 全部 /api/* → 断言**行为**。
   重点不是「跑通」，而是三条**因果**：
     ① 提示密度真的随 Adaptation Policy 变（gentle/standard/hard 可见地不同）
     ② 连续未命中真的会强制给提示（防挫败策略生效）
     ③ 达成率真的写进 pragmatics（方案 M4 指定的唯一信号源）
   外加一条**结构性**断言：所有目标句都能在既有内容库里找到 → 证明「零新增教学内容」。
   用法：NODE_PATH=<workspace>/node_modules node _internal/test_rp.cjs */
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

/* LLM 兜底的三种可切换行为（测「兜底」与「离线降级」两条路） */
let chatMode = 'miss';      // 'miss' | 'hit' | 'down'

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
        if(pth === '/api/register') return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, uid:'rp-test-uid-0001' }) });
        if(pth === '/api/score')    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ overall:88, verdict:'Great',
          perSyll:[ { target:'你', user:'你', score:1, toneOk:true },
                    { target:'好', user:'好', score:1, toneOk:true } ] }) });
        if(pth === '/api/asr')      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, text:'你好' }) });
        if(pth === '/api/chat'){
          if(chatMode === 'down') return route.fulfill({ status:502, contentType:'application/json', body:JSON.stringify({ ok:false, error:'down' }) });
          var payload = (chatMode === 'hit')
            ? { ok:true, reply:'{"hit":true,"reply":"好的，两位里面请"}' }
            : { ok:true, reply:'{"hit":false,"reply":"嗯……"}' };
          return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(payload) });
        }
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
  await page.waitForFunction(function(){
    return typeof S === 'object' && typeof LM === 'object' && typeof PATH === 'object'
        && typeof SESSION === 'object' && typeof RP === 'object';
  }, null, { timeout:15000 });
  await page.waitForTimeout(500);

  /* ---- 0. 前置：干净学员模型 ---- */
  const seed = await page.evaluate(function(){
    S.lm = LM.defaults(); LM.migrate();
    LM.setGoal({ purpose:'travel', cities:['上海'], arrive:'2026-10-05', native:'en' });
    return { ok:!!LM.get().goal.purpose };
  });
  chk('前置 · 学员模型初始化', seed.ok === true, '');

  /* ---- 1. 任务清单：6 个场景，每个 ≥3 轮（方案验收口径）---- */
  const ts = await page.evaluate(function(){
    var list = RP.tasks();
    return { n:list.length, min:Math.min.apply(null, list.map(function(x){ return x.n; })),
             ids:list.map(function(x){ return x.id; }).join(','),
             allHaveName:list.every(function(x){ return !!x.name && !!x.who && !!x.setup; }) };
  });
  chk('场景 · 6 个任务场景齐备', ts.n === 6, ts.ids);
  chk('场景 · 每个场景 ≥3 轮（验收口径）', ts.min >= 3, 'min=' + ts.min);
  chk('场景 · 每个任务都有名称/对手角色/开场情境', ts.allHaveName === true, '');

  /* ---- 2. 结构断言：目标句 100% 来自既有内容库 → 「零新增教学内容」---- */
  const reuse = await page.evaluate(function(){
    var lib = {};
    (typeof DIALOGS !== 'undefined' ? DIALOGS : []).forEach(function(d){
      (d.lines||[]).forEach(function(l){ if(l.hz) lib[l.hz] = 1; });
    });
    SCENES.forEach(function(s){ (s.phrases||[]).forEach(function(p){ if(p.hz) lib[p.hz] = 1; }); });
    var missing = [], blank = [], empty = [], inlineThem = 0, totalTurns = 0;
    RP.TASKS.forEach(function(t){
      t.turns.forEach(function(tn){
        totalTurns++;
        if(!tn.them || !tn.them.hz) inlineThem++;
      });
      RP.turns(t).forEach(function(r){
        if(!r.you || !r.you.hz) { empty.push(t.id); return; }
        if(!lib[r.you.hz]) missing.push(r.you.hz);
        if(/[_]{2,}|\(|\)/.test(r.you.hz)) blank.push(r.you.hz);   // 含占位符的填空题不能当评分 target
      });
    });
    /* 引用必须按 hz 解析 —— 内容库插句/调序不能让引用错位（v0.27 真跑抓到的回归） */
    var bg = RP.turns(RP.taskById('bargain'));
    return { missing:missing, blank:blank, empty:empty, totalTurns:totalTurns, nTasks:RP.TASKS.length,
             resolved:RP.tasks().reduce(function(a,x){ return a + x.n; }, 0),
             bargain3:(bg[2] && bg[2].you.hz) || '', bargain2:(bg[1] && bg[1].you.hz) || '' };
  });
  chk('内容 · 所有目标句都来自既有内容库（零新增教学内容）', reuse.missing.length === 0,
      'missing=' + (reuse.missing.join(' | ') || 'none') + ' turns=' + reuse.totalTurns);
  chk('内容 · 目标句不含占位符（评分 target 不能是填空题）', reuse.blank.length === 0, reuse.blank.join(' | '));
  chk('内容 · 每一轮都能 resolve 出内容库真句（引用不错位）',
      reuse.empty.length === 0 && reuse.resolved === reuse.totalTurns,
      'empty=' + reuse.empty.join(',') + ' resolved=' + reuse.resolved + '/' + reuse.totalTurns);
  chk('内容 · 引用按 hz 命中（bargain 第 3 轮 = 能给我一个袋子吗？）',
      reuse.bargain3 === '能给我一个袋子吗？' && reuse.bargain2 === '好吧，四十块，成交！',
      reuse.bargain2 + ' / ' + reuse.bargain3);

  /* ---- 3. 判定因果：关键词真的在区分「说了意思」与「答非所问」---- */
  const jd = await page.evaluate(function(){
    RP.start('order-food');
    var t = RP.turn();
    return { tgt:t.you.hz, kw:t.kw.join('/'),
             hit:RP.match(t.kw, '两个人，谢谢'),
             hit2:RP.match(t.kw, '两位'),
             miss:RP.match(t.kw, '今天天气很好') };
  });
  chk('判定 · 关键词命中真句 → 达成', jd.hit === true, jd.tgt + ' kw=' + jd.kw);
  chk('判定 · 同义口语说法（两位）也算达成', jd.hit2 === true, '');
  chk('判定 · 无关句 → 不达成（checkpoint 不形同虚设）', jd.miss === false, '');

  /* ---- 4. 面板：start → 打开 + 渲染对方第一句 + 我的目标 ---- */
  const st = await page.evaluate(function(){
    RP.start('order-food');
    openRp(); renderRp();
    var p = document.getElementById('rp');
    var feed = document.querySelectorAll('#rp-feed .rp-b');
    var goal = document.querySelector('#rp-body .rp-goal .v');
    return { on: p ? p.classList.contains('on') : false, bubbles:feed.length,
             first: feed.length ? feed[0].innerText.slice(0,12) : '',
             goal: goal ? goal.innerText.slice(0,24) : '',
             prog:(document.getElementById('rp-prog')||{}).textContent };
  });
  chk('面板 · rpStart 打开场景教练面板', st.on === true, '');
  chk('面板 · 对话流已有对方开场白', st.bubbles >= 1 && st.first.length > 0, st.first);
  chk('面板 · 显示本轮要说的话（意图）', st.goal.length > 0, st.goal);
  chk('面板 · 进度显示为第 1 轮', /1 \//.test(String(st.prog)), st.prog);

  /* ---- 5. 因果 A/B：提示密度随 Adaptation Policy 变化 ---- */
  const ab1 = await page.evaluate(function(){
    RP.start('order-food');
    var m = LM.get(), r = {};
    m.policy.hint = 'gentle';   r.gentle = RP.hintOn();
    m.policy.hint = 'hard';     r.hard   = RP.hintOn();
    m.policy.hint = 'standard'; r.std0   = RP.hintOn();
    return r;
  });
  chk('因果A · 提示密度随策略可见地不同（gentle=true / hard=false）',
      ab1.gentle === true && ab1.hard === false, JSON.stringify(ab1));
  chk('因果A · standard 档第 1 轮给提示', ab1.std0 === true, '');

  /* ---- 6. 因果 B：连续未命中 2 次强制给提示（防挫败策略）---- */
  const ab2 = await page.evaluate(function(){
    RP.start('order-food');
    LM.get().policy.hint = 'hard';
    var before = RP.hintOn();
    RP.tick(false); RP.tick(false);
    var after = RP.hintOn();
    return { before:before, after:after, miss:RP.get().miss, all:RP.get().misall };
  });
  chk('因果B · hard 档默认不给提示', ab2.before === false, '');
  chk('因果B · 连续未命中 2 次后强制给提示（不重复打击）',
      ab2.after === true && ab2.miss === 2 && ab2.all === 2, JSON.stringify(ab2));

  /* ---- 7. 达成：渲染既有评分卡 + 自动推进（pragmatics 的因果留到整场结算后测）---- */
  chatMode = 'miss';
  const sc = await page.evaluate(async function(){
    RP.start('bargain');
    await rpScore('太贵了，三十块行吗？');
    var c = RP.get();
    var me = document.querySelectorAll('#rp-feed .rp-b.me');
    return { i:c.i,
             hits:c.res.filter(function(x){ return x.hit; }).length,
             feeds:c.feed.length,
             scored:!!document.querySelector('#rp-score .score-card'),
             lastMe: me.length ? me[me.length-1].className : '' };
  });
  chk('回流 · 命中后渲染既有评分卡（判分链路复用，参数零改动）', sc.scored === true, '');
  chk('流程 · 达成后自动推进到下一轮', sc.i === 1 && sc.hits === 1, 'i=' + sc.i + ' hits=' + sc.hits);
  chk('流程 · 我的转写进入对话流且标记为成功', sc.feeds >= 3 && /me/.test(sc.lastMe), sc.lastMe + ' feeds=' + sc.feeds);

  /* ---- 8. 未命中：不推进 + 保留反馈 + 累计 ---- */
  const ms = await page.evaluate(async function(){
    RP.start('taxi');
    var before = RP.get().misall;
    await rpScore('我昨天去了图书馆看书');       // 无关句，且 LLM mock 判 miss
    return { i:RP.get().i, misall:RP.get().misall, before:before,
             hasErr:!!document.querySelector('#rp-score .score-err'),
             feedLen:RP.get().feed.length };
  });
  chk('未命中 · 不推进轮次', ms.i === 0, 'i=' + ms.i);
  chk('未命中 · 累计未命中并给出反馈', ms.misall === ms.before + 1 && ms.hasErr === true, JSON.stringify(ms));

  /* ---- 9. LLM 兜底：同义表达（关键词没覆盖）由模型判定达成 ---- */
  chatMode = 'hit';
  const ll = await page.evaluate(async function(){
    RP.start('ask-directions');
    var n0 = RP.get().llm;
    var r = await RP.llmJudge(RP.turn().you.hz, '劳驾，能不能带我到这个地方');
    return { hit:r && r.hit, reply:(r && r.reply) || '', calls:RP.get().llm - n0 };
  });
  chk('兜底 · LLM 判定同义表达 → 算达成并带回接话', ll.hit === true && ll.reply.length > 0, JSON.stringify(ll));
  chk('兜底 · 调用了 1 次 chat（单场调用可计量）', ll.calls === 1, 'calls=' + ll.calls);

  chatMode = 'miss';
  const ll2 = await page.evaluate(async function(){
    RP.start('ask-directions');
    var r = await RP.llmJudge(RP.turn().you.hz, '我昨天去了图书馆看书');
    return { hit:r && r.hit, isNull:r === null };
  });
  chk('兜底 · LLM 判否 → 不达成', ll2.hit === false, JSON.stringify(ll2));

  /* ---- 10. 离线降级：LLM 全挂时关键词路径仍能走完整场（脚本分支可练）---- */
  chatMode = 'down';
  const off = await page.evaluate(async function(){
    RP.start('hotel-checkin');
    var total = RP.get().ts.length, guard = 0;
    while(!RP.isOver() && guard++ < 8){
      var t = RP.turn();
      await rpScore(t.kw[0] || t.you.hz);
    }
    var c = RP.get();
    return { over:RP.isOver(), turns:c.i, total:total,
             done:c.res.filter(function(x){ return x.hit; }).length,
             sum:RP.settle(), chatDown:true };
  });
  chk('离线降级 · LLM 502 时仍能走完整场（关键词判定兜住）', off.over === true && off.done >= 3,
      JSON.stringify({ over:off.over, done:off.done, total:off.total }));
  chk('离线降级 · 结算照常产出成绩', !!(off.sum && off.sum.total === off.total), JSON.stringify(off.sum));

  /* ---- 11. 结算：幂等 + 里程碑只记一次 + 因果 C（pragmatics）---- */
  const pBefore = await page.evaluate(function(){ return LM.get().abil.pragmatics; });
  const fin = await page.evaluate(async function(){
    var m0 = LM.get().mile.length;
    RP.start('bargain'); renderRp();
    var guard = 0, dbg = [];
    while(!RP.isOver() && guard++ < 8){
      var t = RP.turn();
      dbg.push({ kw:JSON.stringify(t.kw), arg:String(t.kw[0]), hz:t.you.hz, m:RP.match(t.kw, t.kw[0]) });
      await rpScore(t.kw[0]);
    }
    var s1 = RP.settle(), s2 = RP.settle();
    var mile = LM.get().mile.filter(function(x){ return String(x.id||'').indexOf('rp:bargain') === 0; }).length;
    var probe = LM.milestone('rp:__probe__');            // 直接探一次，区分「机制坏」与「值没到」
    return { first:s1.first, idem:(s1 === s2), mile:mile, rate:s1.rate, done:s1.done, total:s1.total,
             mileLen:LM.get().mile.length, m0:m0, probeId:(probe && probe.id) || '', dbg:dbg,
             pAfter:LM.get().abil.pragmatics,
             settled:!!document.querySelector('#rp-body .sess-sum'),
             hasReplay:!!document.querySelector('button[onclick*="rpStart"]') };
  });
  chk('结算 · 全部达成 → 记录里程碑（场景通关）', fin.mile === 1 && fin.first === true,
      'mile=' + fin.mile + ' first=' + fin.first + ' done=' + fin.done + '/' + fin.total + ' rate=' + fin.rate
      + ' len=' + fin.mileLen + ' probe=' + fin.probeId + ' dbg=' + JSON.stringify(fin.dbg));
  chk('结算 · 幂等（重复结算不重复写里程）', fin.idem === true, '');
  chk('结算 · 渲染结算页 + 「再演一遍」', fin.settled === true && fin.hasReplay === true, '');
  chk('因果C · 整场结算把达成率写进 pragmatics（方案 M4 指定信号源）',
      fin.pAfter > pBefore, pBefore + ' → ' + fin.pAfter);

  /* ---- 12. 空场防御：一句没说 → 不结算、不污染能力向量 ---- */
  const emp = await page.evaluate(function(){
    RP.start('order-food');
    var before = LM.get().abil.pragmatics;
    var s = RP.settle();
    return { empty:s.empty === true, rate:s.rate, before:before, after:LM.get().abil.pragmatics };
  });
  chk('防御 · 一句没说时结算不拉低能力向量', emp.empty === true && emp.after === emp.before, JSON.stringify(emp));

  /* ---- 13. 首页入口卡 ---- */
  const home = await page.evaluate(function(){
    renderHome();
    var html = (document.getElementById('home-scenes') || {}).innerHTML || '';
    var btns = document.querySelectorAll('#home-scenes button[onclick*="rpStart"]');
    return { n:btns.length, hasTitle:html.indexOf('Scenario coach') >= 0 || html.indexOf('场景教练') >= 0,
             text:btns.length ? btns[0].innerText.trim() : '' };
  });
  chk('首页 · 场景教练入口卡 + 6 个场景按钮', home.n === 6 && home.hasTitle === true, 'n=' + home.n + ' first=' + home.text);

  chk('运行 · 全程无未捕获页面错误', errs.length === 0, errs.slice(0,3).join(' | '));

  await browser.close();
  srv.close();

  const bad = R.filter(function(x){ return !x.ok; });
  R.forEach(function(x){ console.log((x.ok ? '✅ ' : '❌ ') + x.name + (x.extra ? '  [' + x.extra + ']' : '')); });
  console.log('\n──────── v0.27.0 场景教练验收：' + (R.length - bad.length) + '/' + R.length + ' 通过 ────────');
  process.exit(bad.length ? 1 : 0);
})().catch(function(e){ console.error('FATAL', e); process.exit(2); });
