#!/usr/bin/env node
/* v0.29.0 验收：M6 复盘收口（Retro）+ 记忆压缩（Compaction）+ M5 策略切换（Adaptation）。
   **真跑**（康哥铁律）：本地 http server → Playwright 驱动本机 Chrome → mock /api/* → 断言**行为**。

   重点不是「跑通」，而是四条**因果**：
     ① 策略切换真的让「今天不练同一句」（干预式 A/B：给某句连灌 3 次低分 → 选句顺序真的变）
     ② 低分归因真的决定换法（有音素错 → 拆音节；无 → 换说法），且突破后策略真的解除
     ③ 记忆压缩真的发生（跨天事件 → 日摘要；**原始事件被吃掉**；幂等；定长；今日不封账）
     ④ 复盘卡的数据全部有数据源（Edify Gate 的「下一句」原样来自既有 CITY_GUIDES）

   纪律断言：S.lm 上云体积 < 8 KB；v0.29 三功能**零新增网络请求**。

   用法：NODE_PATH=<workspace>/node_modules node _internal/test_retro.cjs */
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

/* mock 捕获桶：用来证明「零新增写」 */
const seen = { profile: 0, score: 0, other: 0 };

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
        if(pth === '/api/register') return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, uid:'retro-test-uid-0001' }) });
        if(pth === '/api/profile'){ seen.profile++; return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' }); }
        if(pth === '/api/score'){ seen.score++; return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ overall:88, verdict:'Great', perSyll:[{ target:'请', user:'请', score:1, toneOk:true }] }) }); }
        seen.other++;
        return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
      }
      return route.continue();
    }
    return route.abort();
  });

  await page.addInitScript(function(){
    try{
      localStorage.setItem('sinoky_lang_chosen','1');
      if(!sessionStorage.getItem('__retro_seeded')){
        localStorage.removeItem('sinoky_state');
        sessionStorage.setItem('__retro_seeded','1');
      }
    }catch(e){}
  });

  const BOOT = function(){
    return typeof S === 'object' && typeof LM === 'object' && typeof PATH === 'object'
        && typeof RETRO === 'object' && typeof SHARE === 'object';
  };

  await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(BOOT, null, { timeout:15000 });
  await page.waitForTimeout(400);

  /* ---- 0. 干净学员模型 + 进入首页 ---- */
  const seed = await page.evaluate(function(){
    try{
      S.onboarded = true;
      S.lm = LM.defaults(); LM.migrate();
      S.rev = {}; S.streak = 0; S.lastDone = null;
      S.phrases = {}; S.days = [];
      LM.setTrip('', '', 0);
      go('home'); renderHome();
      return { pur: LM.get().goal.purpose,
               hasRetro: typeof RETRO.build === 'function',
               hasStrat: typeof LM.strategyOf === 'function',
               hasDigest: typeof LM.digestOf === 'function',
               stratDefault: JSON.stringify(LM.get().policy.strategy) };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('前置 · 学员模型初始化', seed.pur === 'travel', JSON.stringify(seed));
  chk('前置 · RETRO / 策略 / digest 接口就位', seed.hasRetro && seed.hasStrat && seed.hasDigest, '');
  chk('前置 · policy.strategy 默认是**数组**（v0.29 迁移，非对象）', seed.stratDefault === '[]', seed.stratDefault);

  /* ================= A. 策略切换（干预式因果 A/B） ================= */
  console.log('\n===== A. 策略切换 =====');

  const A1 = await page.evaluate(function(){
    try{
      var n = PATH.currentNode();
      var arr = PATH.collect(n);
      if(arr.length < 2) return { err:'当前节点句数 < 2（' + arr.length + '），无法做选句 A/B' };
      function rank(){
        var a = PATH.collect(n);
        a.forEach(function(x){ x._s = PATH.score(x); });
        a.sort(function(p,q){ return q._s - p._s; });
        return { topKey: PATH.key(a[0]), topScore: a[0]._s, secondKey: PATH.key(a[1]) };
      }
      var before = rank();
      /* 干预：给当前第一名连灌 3 次**带声调错**的低分 */
      var victim = PATH.collect(n)[0];
      var victimKey = PATH.key(victim);
      var sBefore = PATH.score(victim);
      for(var i=0;i<3;i++){
        LM.ingestScore({ overall:30, perSyll:[{ target:'请', user:'请', score:0, toneOk:false, tExp:3 }] }, victim.scene, victim.idx);
      }
      var again = PATH.collect(n).filter(function(x){ return PATH.key(x) === victimKey; })[0];
      var sAfter = again ? PATH.score(again) : null;
      var after = rank();
      var st = LM.strategyOf(victimKey);
      return { before: before, after: after, victimKey: victimKey,
               sBefore: sBefore, sAfter: sAfter,
               strat: st ? { mode:st.m, n:st.n } : null };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('A1 · 干预后该句命中策略', A1.strat && A1.strat.n >= 3, JSON.stringify(A1.strat));
  chk('A2 · 归因正确：带声调错 → 拆音节练（syllable）', A1.strat && A1.strat.mode === 'syllable', A1.strat && A1.strat.mode);
  chk('A3 · 因果（干预式 A/B）：该句分值真的下降',
      A1.sBefore !== undefined && A1.sAfter !== undefined && A1.sAfter < A1.sBefore,
      A1.err || (A1.sBefore + ' → ' + A1.sAfter + '  @' + A1.victimKey));
  chk('A4 · 因果：今天真的不再把同一句排第一（选句变了）',
      !!A1.before && !!A1.after && A1.before.topKey !== A1.after.topKey,
      A1.err || ((A1.before && A1.before.topKey) + ' → ' + (A1.after && A1.after.topKey)));

  const A5 = await page.evaluate(function(){
    try{
      /* 换一个**全新的** key，否则 A1 已写入的 syllable 不会被覆盖（策略一旦命中就固定） */
      LM.get().policy.strategy = [];
      var it0 = PATH.collect(PATH.currentNode())[0];
      var k = PATH.key(it0), sp = k.split('#');
      for(var i=0;i<3;i++){
        LM.ingestScore({ overall:35, perSyll:[{ target:'好', user:'好', score:0.5, toneOk:true, errs:[] }] }, sp[0], +sp[1]);
      }
      var st = LM.strategyOf(k);
      return { k:k, mode: st && st.m, n: st && st.n };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('A5 · 归因正确：无音素错 → 换近义句（synonym）', A5.mode === 'synonym', JSON.stringify(A5));

  const A6 = await page.evaluate(function(k){
    try{
      /* 突破（≥60）→ 策略解除（临时脚手架，不是永久标签） */
      var sp = String(k).split('#');
      var before = !!LM.strategyOf(k);
      LM.ingestScore({ overall:85, perSyll:[{ target:'好', user:'好', score:1, toneOk:true }] }, sp[0], +sp[1]);
      return { k:k, before: before, after: !!LM.strategyOf(k) };
    }catch(e){ return { err:String(e && e.message) }; }
  }, A5.k);
  chk('A6 · 突破后策略解除（before=true / after=false）', A6 && A6.before === true && A6.after === false, JSON.stringify(A6));

  const A7 = await page.evaluate(function(){
    try{
      /* 定长：灌真实的 key（**不能瞎编 idx** —— phrases[idx] 不存在会被 UI 侧跳过，
         那不是定长失败而是测试造假）→ 数组不得超过 cap */
      var keys = [];
      PATH.collect(PATH.currentNode()).forEach(function(x){ keys.push(PATH.key(x)); });
      SCENES.slice(0, 8).forEach(function(sc){
        if(!sc.phrases) return;
        for(var j=0;j<Math.min(3, sc.phrases.length); j++) keys.push(sc.id + '#' + j);
      });
      keys.forEach(function(k){
        var sp = k.split('#');
        for(var t=0;t<3;t++){
          LM.ingestScore({ overall:20, perSyll:[{ target:'一', user:'一', score:0, toneOk:false, tExp:2 }] }, sp[0], +sp[1]);
        }
      });
      var arr = LM.get().policy.strategy;
      return { len: arr.length, cap: LM.CAP.strategy, injected: keys.length,
               allValid: arr.every(function(x){
                 var sp = String(x.k).split('#'), sc = PATH.findScene(sp[0]);
                 return !!(sc && sc.phrases && sc.phrases[+sp[1]]);
               }) };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('A7 · 定长：policy.strategy 受 cap 约束', A7.len <= A7.cap && A7.len > 0,
      'len=' + A7.len + ' cap=' + A7.cap);
  chk('A7b · 注入的 key 全部指向真实存在的句子（测试不造假）',
      A7.allValid === true, 'injected=' + A7.injected);

  const A9 = await page.evaluate(function(){
    try{
      /* 精确验证 whyOf：直接对**已知命中**的 key 构造 item */
      var sp = LM.strategyAll();
      if(!sp.length) return { err:'无命中策略项' };
      var parts = String(sp[0].k).split('#');
      var it = { scene:parts[0], idx:+parts[1] };
      var why = PATH.whyOf(it);
      var html = pathCardHtml();
      return { why: why, hasUI: /🔤|🔄/.test(html),
               hasHint: html.indexOf('🎚') >= 0 };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('A9 · whyOf 对命中句返回 swap（可解释性闭环）', (A9.why || []).indexOf('swap') >= 0, JSON.stringify(A9.why));
  chk('A10 · 首页路径卡渲染出「换做法」出口', A9.hasUI === true && A9.hasHint === true,
      'hasUI=' + A9.hasUI + ' hasHint=' + A9.hasHint);

  /* ================= B. 记忆压缩 ================= */
  console.log('\n===== B. 记忆压缩 =====');

  const B1 = await page.evaluate(function(){
    try{
      var m = LM.get();
      m.buf = []; m.digest = [];
      /* 造 2 天前 + 昨天 各 2 条事件（跨天 → 应被封账） */
      var d2 = Date.now() - 2*86400e3, d1 = Date.now() - 1*86400e3;
      ['a','b'].forEach(function(){ LM.event('score', { s:'food#0', v:60 }); });
      var b = m.buf, i;
      for(i=0;i<2;i++) b[b.length-1-i].t = d2;
      ['c','d'].forEach(function(){ LM.event('score', { s:'food#0', v:80 }); });
      for(i=0;i<2;i++) b[b.length-1-i].t = d2;
      ['e'].forEach(function(){ LM.event('score', { s:'food#1', v:40 }); });
      for(i=0;i<1;i++) b[b.length-1-i].t = d1;
      /* 今天 1 条 —— 不该被封账 */
      LM.event('score', { s:'food#2', v:90 });
      var bufBefore = m.buf.length;
      var added = LM.digestSweep();
      var dg = m.digest;
      var td = new Date().toISOString().slice(0,10);
      return { bufBefore: bufBefore, bufAfter: m.buf.length, added: added,
               digests: dg.map(function(x){ return { d:x.d, n:x.n, sc:x.sc, avg:x.avg }; }),
               todayInDigest: dg.some(function(x){ return x.d === td; }) };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('B1 · 跨天事件被压成日摘要（生成 2 条：2 天前 + 昨天）',
      B1.added === 2 && (B1.digests || []).length === 2, JSON.stringify(B1.digests));
  chk('B2 · 压缩真的发生：原始事件被吃掉（buf 只留今天）',
      B1.bufBefore === 6 && B1.bufAfter === 1, B1.bufBefore + ' → ' + B1.bufAfter);
  chk('B3 · 今日不封账（当天数据还在进行中）', B1.todayInDigest === false, '');
  chk('B4 · 日摘要含真实聚合值（n/sc/avg，不是占位）',
      (B1.digests || []).every(function(x){ return x.n > 0 && x.sc === x.n && x.avg > 0; }),
      JSON.stringify(B1.digests));

  const B5 = await page.evaluate(function(){
    try{
      var before = LM.get().digest.length;
      var added = LM.digestSweep();          /* 幂等：再跑一次不应重复写 */
      return { before: before, after: LM.get().digest.length, added: added };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('B5 · 幂等：重复压缩不重复写同一天', B5.added === 0 && B5.after === B5.before,
      'added=' + B5.added + ' ' + B5.before + ' → ' + B5.after);

  const B6 = await page.evaluate(function(){
    try{
      var m = LM.get(); m.buf = []; m.digest = [];
      for(var i=1;i<=40;i++){
        LM.event('score', { s:'food#0', v:70 });
        m.buf[m.buf.length-1].t = Date.now() - i*86400e3;
      }
      LM.digestSweep();
      return { len: m.digest.length, cap: LM.CAP.digest, sorted: m.digest.every(function(x,ix,a){ return ix===0 || a[ix-1].d <= x.d; }) };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('B6 · 定长：digest 受 cap 约束（40 天 → 30）', B6.len === B6.cap, 'len=' + B6.len + ' cap=' + B6.cap);
  chk('B7 · 日摘要按日期有序（淘汰的是最早的）', B6.sorted === true, '');

  const B8 = await page.evaluate(function(){
    try{
      /* 走真实入口：compact() 在 pushProfile() 里被调用（同步时顺带压缩） */
      var m = LM.get(); m.buf = []; m.digest = [];
      LM.event('score', { s:'food#0', v:66 });
      m.buf[m.buf.length-1].t = Date.now() - 3*86400e3;
      var r1 = LM.compact();      /* 无返回值也算调用成功 */
      var afterCompact = m.digest.length;
      var src = String(pushProfile);
      return { afterCompact: afterCompact, callsCompact: src.indexOf('LM.compact()') >= 0 };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('B8 · compact() 真的产出日摘要', B8.afterCompact === 1, 'digest=' + B8.afterCompact);
  chk('B9 · compact() 挂在上云链路里（同步时顺带压缩，结构保证）', B8.callsCompact === true, '');

  /* ================= C. 复盘卡 + 归档 ================= */
  console.log('\n===== C. 复盘卡 =====');

  const C1 = await page.evaluate(function(){
    try{
      var before = RETRO.ended();
      /* 3 天前到达、行程 2 天 → 已结束 */
      var t = new Date(Date.now() - 3*86400e3).toISOString().slice(0,10);
      LM.setTrip('上海', t, 2);
      return { before: before, after: RETRO.ended(), avail: RETRO.available(), dt: LM.daysToTrip() };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('C1 · 未设行程时不可复盘', C1.before === false, '');
  chk('C2 · 行程结束后 ended=true（到达日已过 2 天）',
      C1.after === true && C1.dt <= -2, 'dt=' + C1.dt);

  const C3 = await page.evaluate(function(){
    try{
      var d = RETRO.build();
      return { city:d.city, cityId:d.cityId, days:d.days, said:d.said, avg:d.avg,
               weak:d.weak, nextHz:d.next && d.next.hz, nextCity:d.next && d.next.city };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('C3 · build() 数据形状齐备', C3.city === '上海' && C3.cityId === 'shanghai' && C3.days === 2,
      JSON.stringify(C3));
  chk('C4 · Edify Gate：复盘卡上有「下一趟要说的第一句」', !!C3.nextHz, C3.nextHz);

  const C5 = await page.evaluate(function(){
    try{
      /* 那句话必须**原样**来自既有 CITY_GUIDES —— 零新增教学内容的证据 */
      var l = CITY_GUIDES['shanghai'].zones[0].phrases[0];
      var d = RETRO.build();
      return { srcHz:l.hz, got: d.next && d.next.hz,
               hzOk: !!(d.next && d.next.hz === l.hz),
               pyOk: !!(d.next && d.next.py === l.py),
               enOk: !!(d.next && d.next.en === l.en) };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('C5 · 那句话原样来自 CITY_GUIDES（零新增教学内容）',
      C5.hzOk === true && C5.pyOk === true && C5.enOk === true, JSON.stringify(C5));

  const C6 = await page.evaluate(function(){
    try{
      var r1 = RETRO.archive();
      var rec = null, m = LM.get();
      for(var i=0;i<m.mile.length;i++){ if(String(m.mile[i].id).indexOf('retro:')===0) rec = m.mile[i]; }
      var r2 = RETRO.archive();
      return { fresh1: r1.fresh, fresh2: r2.fresh, rec: rec, said: r1.data.said };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('C6 · 归档写入 S.lm.mile（含真实开口数）',
      !!C6.rec && C6.rec.n === C6.said, JSON.stringify(C6.rec));
  chk('C7 · 归档幂等（第二次不再记一次）', C6.fresh1 === true && C6.fresh2 === false,
      'fresh1=' + C6.fresh1 + ' fresh2=' + C6.fresh2);

  const C8 = await page.evaluate(function(){
    try{
      var ids = SHARE.pool().map(function(p){ return p.id; });
      SHARE.theme = 'retro'; SHARE.code = 'testcode';
      var cv = SHARE.draw('square');
      var txt = SHARE.text();
      return { pool: ids, inPool: ids.indexOf('retro') >= 0,
               canvas: !!cv, w: cv && cv.width, h: cv && cv.height,
               txtHasNext: txt.indexOf('Next time') >= 0 };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('C8 · 分享池在可复盘时含 retro', C8.inPool === true, JSON.stringify(C8.pool));
  chk('C9 · 复盘卡真的画得出来（1080×1080 非空画布）',
      C8.canvas === true && C8.w === 1080 && C8.h === 1080, C8.w + '×' + C8.h);
  chk('C10 · 分享文案含下一趟第一句', C8.txtHasNext === true, '');

  const C11 = await page.evaluate(function(){
    try{
      var on = retroCardHtml().length > 0;
      LM.setTrip('', '', 0);                  /* 清行程 → 不该再出现 */
      LM.get().goal.cities = [];
      var off = retroCardHtml().length > 0;
      return { on:on, off:off };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('C11 · 首页复盘卡：可复盘时有、清行程后无', C11.on === true && C11.off === false,
      'on=' + C11.on + ' off=' + C11.off);

  /* ---- v0.29.1 · C12/C13/C12b —— 复盘分享卡的**排版几何**可回归断言 ----
     起因：v0.29.0 上线后线上真跑截图为证（R2-retro-card-live.png），第一版复盘卡正文
     压过品牌分隔线、拼音被二维码盖住。人眼看图不算验收 ⇒ 把「不越界 / 不被盖住」
     变成像素级断言：改字号、加文案、换更长的句子一旦越界，这里立刻变红。

     方法（**差异法**，避开边界与品牌层的假阳性 —— 第一版按矩形扫就踩了两个坑：
       QR 矩形里量到 412 点墨，其实是品牌分隔线穿过它；角色矩形里量到 519 点，
       其实是瓦片右边框正好贴在 x=996 边界上）：
       同一张卡画两版 —— cvOn（正常，含注入层 QR/诺诺）与 cvOff（临时关掉这两层）。
       ① 主代码正文几何一律在 cvOff 上量（与注入层彻底解耦）：
            · contentMaxY ≤ BOT（正文不得压到品牌分隔线）
            · BOT→品牌线这条安全带零墨点
       ② 「正文被盖住」用两版差异判定：cvOn≠cvOff 的像素即覆盖物像素；
          若该处 cvOff 原本是正文墨 ⇒ 正文被盖住了（缺陷）。
          ⚠️ 只在 y ≤ DIV-6（品牌层之上）判定：品牌分隔线/字标/印章**本来就该被 QR 盖住**，
          不排除它们会把设计意图误判成缺陷。

     ⚠️ 必须先设好行程让卡片 8 个块全在场 —— C11 刚把行程清空，那是最短的卡，测不出越界。 */
  const C12 = await page.evaluate(function(){
    try{
      /* 让卡片满配（C11 结尾清了行程） */
      var t = new Date(Date.now() - 4*86400e3).toISOString().slice(0,10);
      LM.setTrip('上海', t, 3);
      SHARE.theme = 'retro'; SHARE.code = 'testcode';

      function measure(fmt){
        var W = 1080, H = (fmt === 'story') ? 1920 : 1080;
        var TOP = (fmt === 'story') ? 340 : 176;
        var BOT = (fmt === 'story') ? (H - 470) : 806;
        var DIV = H - 228;                       /* 品牌分隔线 */
        /* ① 正常版（含注入层 QR / 右下诺诺） */
        var cvOn = null;
        try{ cvOn = SHARE.draw(fmt); }catch(e){}
        /* ② 临时关掉注入层两块覆盖物，再画一版 */
        var savedLink = SHARE.link, im = window.NONO_SHARE_IMG, stubbed = false;
        try{
          SHARE.link = function(){ return ''; };                  /* QR：link 空即不画 */
          if(im){ Object.defineProperty(im,'complete',{value:false,configurable:true});
                  Object.defineProperty(im,'naturalWidth',{value:0,configurable:true});
                  stubbed = true; }                               /* 诺诺：图未就绪即不画 */
        }catch(e){}
        var cvOff = null;
        try{ cvOff = SHARE.draw(fmt); }catch(e){}
        try{ SHARE.link = savedLink; }catch(e){}
        if(stubbed){ try{ delete im.complete; delete im.naturalWidth; }catch(e){} }
        if(!cvOn || !cvOff) return { err:'canvas null' };

        var dOn  = cvOn.getContext('2d').getImageData(0, 0, W, H).data;
        var dOff = cvOff.getContext('2d').getImageData(0, 0, W, H).data;
        function px(d,x,y){ var i = (y*W + x)*4; return [d[i], d[i+1], d[i+2]]; }
        /* 背景色 = cvOff 全图采样众数 */
        var cnt = {}, best = '', bestN = 0, k;
        for(var y = 0; y < H; y += 4) for(var x = 0; x < W; x += 4){
          var p = px(dOff,x,y); k = p[0] + ',' + p[1] + ',' + p[2];
          cnt[k] = (cnt[k]||0) + 1; if(cnt[k] > bestN){ bestN = cnt[k]; best = k; }
        }
        var bg = best.split(',').map(Number);
        function content(x, y){ var p = px(dOff,x,y);
          return Math.abs(p[0]-bg[0]) + Math.abs(p[1]-bg[1]) + Math.abs(p[2]-bg[2]) > 26; }

        /* ① 正文最底部（上跳 230 避开顶部角花） */
        var contentMaxY = -1;
        for(var yy = 230; yy <= DIV-4; yy++){
          var hit = false;
          for(var xx = 0; xx < W; xx++){ if(content(xx,yy)){ hit = true; break; } }
          if(hit) contentMaxY = yy;
        }
        /* ② 安全带：BOT → 品牌线 零墨点 */
        var bandInk = 0, bandMinY = 1e9, bandMaxY = -1;
        for(var y2 = BOT+6; y2 <= DIV-4; y2++) for(var x2 = 0; x2 < W; x2++){
          if(content(x2,y2)){ bandInk++; if(y2 < bandMinY) bandMinY = y2; if(y2 > bandMaxY) bandMaxY = y2; }
        }
        /* ③ 差异法：正文有没有被覆盖物盖住（只判品牌层之上） */
        var overlayPx = 0, covered = 0, samples = [];
        for(var y3 = 230; y3 <= DIV-6; y3++) for(var x3 = 0; x3 < W; x3++){
          var a = px(dOn,x3,y3), b = px(dOff,x3,y3);
          if(Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]) > 40){
            overlayPx++;
            if(content(x3,y3)){ covered++; if(samples.length < 6) samples.push(x3+','+y3+'='+b.join('/')); }
          }
        }
        return { fmt:fmt, W:W, H:H, TOP:TOP, BOT:BOT, DIV:DIV, bg:bg, stubbed:stubbed,
                 contentMaxY:contentMaxY, bandInk:bandInk, bandMinY:bandMinY, bandMaxY:bandMaxY,
                 overlayPx:overlayPx, covered:covered, samples:samples,
                 png: cvOff.toDataURL('image/png') };
      }
      return { square: measure('square'), story: measure('story') };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  const C12s = C12.square || {}, C12t = C12.story || {};
  try{
    const OUTD = path.join(__dirname, '_shots'); fs.mkdirSync(OUTD, { recursive:true });
    if(C12s.png) fs.writeFileSync(path.join(OUTD, 'retro-geo-square.png'), Buffer.from(String(C12s.png).split(',')[1], 'base64'));
    if(C12t.png) fs.writeFileSync(path.join(OUTD, 'retro-geo-story.png'), Buffer.from(String(C12t.png).split(',')[1], 'base64'));
    console.log('  [geo] 已导出「关掉覆盖物」的复盘卡母版到 _shots/retro-geo-{square,story}.png');
  }catch(e){ console.log('  [geo] 导出失败 ' + String(e && e.message)); }
  chk('C12 · 方图复盘卡：正文不越界、安全带干净、且不被 QR/诺诺盖住',
      C12s.contentMaxY > 0 && C12s.contentMaxY <= C12s.BOT
      && C12s.bandInk === 0 && C12s.covered === 0 && C12s.overlayPx > 1000,
      'contentMaxY=' + C12s.contentMaxY + '/' + C12s.BOT + ' bandInk=' + C12s.bandInk +
      ' overlayPx=' + C12s.overlayPx + ' covered=' + C12s.covered +
      (C12s.samples && C12s.samples.length ? (' samples=' + JSON.stringify(C12s.samples)) : ''));
  chk('C13 · 竖版复盘卡：正文不越界、安全带干净、且不被 QR/诺诺盖住',
      C12t.contentMaxY > 0 && C12t.contentMaxY <= C12t.BOT
      && C12t.bandInk === 0 && C12t.covered === 0 && C12t.overlayPx > 1000,
      'contentMaxY=' + C12t.contentMaxY + '/' + C12t.BOT + ' bandInk=' + C12t.bandInk +
      ' overlayPx=' + C12t.overlayPx + ' covered=' + C12t.covered);
  chk('C12b · 两版差异法真的成立（覆盖物在场且被关过，否则上面两条是假绿）',
      C12s.stubbed === true && C12t.stubbed === true,
      'stubbed=' + C12s.stubbed + ' overlayPx=' + C12s.overlayPx);

  /* ---- v0.29.1 · C14 —— 分享卡全英文（弱点维度不许漏中文）----
     起因：线上真跑截图为证，卡上是「Most often tricky: 4 声字」中英夹生 ——
     弱点走 App 的 i18n，卡上其余是英文。分享卡是给外国朋友看的，必须单一口径。 */
  const C14 = await page.evaluate(function(){
    try{
      LM.weakBump('tone4', 999);                 /* 确定性：保证 tone4 排第一 */
      var d = RETRO.build();
      var cjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
      return { weak:d.weak, weakEn:d.weakEn,
               appHasCjk: cjk.test(d.weak || ''), cardHasCjk: cjk.test(d.weakEn || ''),
               bothOrNeither: (!!d.weak) === (!!d.weakEn) };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('C14 · 分享卡弱点字段是纯英文（App 里可以是中文，卡上不许中英夹生）',
      C14.cardHasCjk === false && C14.bothOrNeither === true && (C14.weakEn || '').length > 0,
      'weak=' + C14.weak + ' | weakEn=' + C14.weakEn);

  /* ---- v0.29.1 · C15 —— 策略出口在「复盘节点」下也必须在场 ----
     起因：线上真跑发现当前节点为 t7（retro）时首页路径卡没有「换做法」出口
     （todayCard 的 if(n.retro) 提前 return 把整块跳过，线上实测 hasSwap=false）。
     判据：把当前节点**强行推到 retro 节点**，断言 ①todayCard 仍带 strategy
     ②渲染出的 HTML 里出现策略专属按钮（openScene 带第三参 'home'，常规句行没有）。 */
  const C15 = await page.evaluate(function(){
    try{
      var m = LM.get();
      m.policy.strategy = [];                    /* 清干净，只注入一条 */
      var savedNode = m.path.node;               /* 测完还原，别污染后面的纪律段 */
      LM.strategyBump('arrival#0', 20, 'syllable');
      LM.strategyBump('arrival#0', 20, 'syllable');
      LM.strategyBump('arrival#0', 20, 'syllable');
      var hit = LM.strategyOf('arrival#0');
      /* 强行把当前节点设为 retro 节点（走与线上同一分支：path.node 优先） */
      var rn = null, all = PATH.nodes();
      for(var i = 0; i < all.length; i++){ if(all[i] && all[i].retro){ rn = all[i]; break; } }
      if(rn){
        m.path.node = rn.id;
        var di = m.path.done.indexOf(rn.id); if(di >= 0) m.path.done.splice(di, 1);
      }
      var card = PATH.todayCard();
      var html = pathCardHtml();
      m.path.node = savedNode || '';             /* 还原 */
      return { hitM: hit && hit.m, retroId: rn && rn.id, cardRetro: !!(card && card.node && card.node.retro),
               cardHasStrategy: !!(card && card.strategy && card.strategy.length),
               htmlHasSwapBtn: html.indexOf("'home')") >= 0, htmlLen: html.length };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('C15 · 策略出口与「是否复盘节点」解耦（复盘节点下仍在场）',
      C15.cardRetro === true && C15.cardHasStrategy === true && C15.htmlHasSwapBtn === true
      && C15.hitM === 'syllable',
      JSON.stringify(C15));

  /* ================= D. 纪律 ================= */
  console.log('\n===== D. 纪律 =====');

  const D1 = await page.evaluate(function(){
    try{
      var m = LM.get();
      /* 🔴 必须灌到**定长上界**再测体积 —— 空模型测出来的小体积是假绿。
         上界：mastered 200 / digest 30 / strategy 12 / weak 5 / cardLog 7。 */
      m.mastered = [];
      for(var i=0;i<260;i++) LM.master('scene' + (i%12) + '#' + i);        /* 触发 cap 200 */
      m.digest = [];
      for(var d=0; d<45; d++){                                             /* 触发 cap 30 */
        m.digest.push({ d:'2026-0' + (1 + (d%9)) + '-' + ('0' + (1 + (d%28))).slice(-2), n:9, sc:9, avg:81 });
      }
      while(m.digest.length > LM.CAP.digest) m.digest.shift();
      for(var k=0;k<24;k++) LM.strategyBump('sc' + k + '#0', 10, 'syllable');  /* 触发 cap 12 */
      ['tone3','tone4','initial','final','tone2'].forEach(function(x){ LM.weakBump(x, 5); });
      var m2 = LM.get();
      var cloud = JSON.stringify(Object.assign({}, m2, { buf: undefined })).length;
      var full  = JSON.stringify(m2).length;
      return { cloud: cloud, full: full,
               mastered: m2.mastered.length, digest: m2.digest.length,
               strategy: m2.policy.strategy.length, weak: m2.weak.length,
               caps: LM.CAP };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('D1 · 定长上界守住（mastered/digest/strategy 各自 cap）',
      D1.mastered === D1.caps.mastered && D1.digest === D1.caps.digest && D1.strategy === D1.caps.strategy,
      'mastered=' + D1.mastered + '/' + (D1.caps && D1.caps.mastered) +
      ' digest=' + D1.digest + '/' + (D1.caps && D1.caps.digest) +
      ' strategy=' + D1.strategy + '/' + (D1.caps && D1.caps.strategy) +
      ' weak=' + D1.weak);
  chk('D2 · 最坏情况下 S.lm 上云体积 < 8 KB（方案验收口径）',
      D1.cloud < 8192, 'cloud=' + D1.cloud + ' bytes（完整含 buf=' + D1.full + '）');

  /* 🔴 「零新增请求」必须用**干预前后计数差**证明，不能靠人眼扫源码 */
  const netBefore = { p: seen.profile, o: seen.other, s: seen.score };
  const D3 = await page.evaluate(function(){
    try{
      /* v0.29 的三条路径全部跑一遍 */
      LM.strategyBump('food#0', 20, 'syllable');
      LM.strategyOf('food#0');
      LM.strategyAll();
      LM.digestOf(30);
      LM.digestSweep();
      RETRO.build(); RETRO.available(); RETRO.archived(); RETRO.cardHtml();
      SHARE.theme = 'retro'; SHARE.draw('square');
      return { ok:true };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('D3 · v0.29 三条路径全部可执行且不抛错', D3.ok === true, JSON.stringify(D3));

  await page.waitForTimeout(400);
  const netAfter = { p: seen.profile, o: seen.other, s: seen.score };
  chk('D4 · 零新增网络请求（三条路径跑完，请求计数一字未动）',
      netAfter.p === netBefore.p && netAfter.o === netBefore.o && netAfter.s === netBefore.s,
      'profile ' + netBefore.p + '→' + netAfter.p + ' other ' + netBefore.o + '→' + netAfter.o +
      ' score ' + netBefore.s + '→' + netAfter.s);

  const D5 = await page.evaluate(function(){
    try{
      var src = String(LM.strategyBump) + String(LM.digestSweep) + String(RETRO.build);
      return { fetchCalls: (src.match(/fetch\(/g) || []).length,
               xhrCalls: (src.match(/XMLHttpRequest/g) || []).length };
    }catch(e){ return { err:String(e && e.message) }; }
  });
  chk('D5 · 三功能源码内零 fetch/XHR（结构性证明零新增请求）',
      D5.fetchCalls === 0 && D5.xhrCalls === 0,
      'fetch=' + D5.fetchCalls + ' xhr=' + D5.xhrCalls);

  await page.waitForTimeout(300);
  chk('D6 · 稳定性 · 零页面错误', errs.length === 0, errs.slice(0,3).join(' | '));

  await browser.close();
  srv.close();

  /* ---- 汇总 ---- */
  const ok = R.filter(function(x){ return x.ok; }).length;
  R.forEach(function(x){
    console.log((x.ok ? '✅ ' : '❌ ') + x.name + (x.extra ? '  → ' + x.extra : ''));
  });
  console.log('\n──────────────────────────────────────────────');
  if(ok === R.length) console.log('✅ 复盘收口真跑验收全绿 — ' + ok + ' / ' + R.length);
  else console.log('❌ 复盘收口真跑验收有失败 — ' + ok + ' / ' + R.length);
  process.exit(ok === R.length ? 0 : 1);
})().catch(function(e){
  console.error('FATAL', e && (e.stack || e.message));
  process.exit(1);
});
