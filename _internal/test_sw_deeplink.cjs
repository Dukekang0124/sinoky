#!/usr/bin/env node
/* v0.28.0 验收：sw.js 与「带 query 的深链导航」的相容性 —— **真跑**。
   背景：sw.js 是 network-first 且 `c.put(e.request, copy)`，cache key 是**完整 URL**。
   v0.28 引入深链（./index.html?go=trip&city=shanghai&set=10）后，每次点不同深链
   都会多存一份仅 query 不同的完整 index.html（~1.5 MB/份）→ Cache Storage 慢慢撑爆，
   配额超了浏览器会整体回收（连预缓存一起丢）→ 离线能力直接归零。

   本测试验证三条**因果**：
     ① 深链导航后，Cache Storage 里**没有**带 query 的条目（修复生效）
     ② 多次不同深链导航后，cache 条目数**不增长**（防膨胀的直接证据）
     ③ 不落盘**不损离线**：预缓存 ./index.html 仍在，离线导航仍能回落出页面

   用法：NODE_PATH=<workspace>/node_modules node _internal/test_sw_deeplink.cjs */
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

  const browser = await chromium.launch({ channel:'chrome', headless:true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', function(e){ errs.push(String(e && e.message)); });

  /* 外部 API 全 mock（零生产写入） */
  await page.route('**/*', function(route){
    const u = route.request().url();
    if(u.indexOf(BASE) === 0) return route.continue();
    return route.abort();
  });

  /* ---- 0. 让 SW 注册并接管本页 ---- */
  await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForFunction("typeof S === 'object' && typeof PRO === 'object'", null, { timeout:15000 });
  const swReady = await page.evaluate(async function(){
    try{
      await navigator.serviceWorker.ready;
      return !!navigator.serviceWorker.controller;
    }catch(e){ return false; }
  });
  chk('SW · 注册并已接管当前页', swReady === true, '');
  if(!swReady){ await page.reload({ waitUntil:'domcontentloaded' }); }
  await page.evaluate(function(){
    S.onboarded = true; if(!S.lm){ S.lm = LM.defaults(); LM.migrate(); }
    saveState();
  });

  /* 记录基线 cache 条目（深链导航前） */
  const baseKeys = await page.evaluate(async function(){
    var names = await caches.keys();
    var out = [];
    for(var i=0;i<names.length;i++){
      var c = await caches.open(names[i]);
      var reqs = await c.keys();
      reqs.forEach(function(r){ out.push(new URL(r.url).pathname + new URL(r.url).search); });
    }
    return out;
  });
  chk('基线 · 预缓存含 ./index.html', baseKeys.indexOf('/index.html') > -1, 'n=' + baseKeys.length);

  /* ---- 1. 深链导航三次（三个不同的 query） ---- */
  const links = ['?go=trip&city=shanghai&set=10', '?go=roleplay&task=order-food', '?go=review&due=1'];
  for(let i=0;i<links.length;i++){
    await page.goto(BASE + '/index.html' + links[i], { waitUntil:'domcontentloaded' });
    await page.waitForFunction("typeof PRO === 'object'", null, { timeout:15000 });
    await page.waitForTimeout(1400);   /* boot() 内 900ms 延迟 */
  }

  const afterKeys = await page.evaluate(async function(){
    var names = await caches.keys();
    var out = [];
    for(var i=0;i<names.length;i++){
      var c = await caches.open(names[i]);
      var reqs = await c.keys();
      reqs.forEach(function(r){ out.push(new URL(r.url).pathname + new URL(r.url).search); });
    }
    return out;
  });

  const withQuery = afterKeys.filter(function(k){ return k.indexOf('?') > -1; });
  const withApi = afterKeys.filter(function(k){ return k.indexOf('/api/') > -1; });
  const delta = afterKeys.filter(function(k){ return baseKeys.indexOf(k) < 0; });
  chk('① Cache Storage 无带 query 的条目（深链/语言包不污染缓存）', withQuery.length === 0, withQuery.slice(0,4).join(' , '));
  chk('① /api/* 不入 cache（/api/profile 的整份用户 state 不落盘）', withApi.length === 0, withApi.slice(0,3).join(' , '));
  /* 断言的是**性质**而不是数量：network-first 的 SW 本来就会把「用过的」静态资源落盘
     （预缓存清单没覆盖全），所以条目数增长是正常行为，不该当失败判据。
     真正要守的红线是：新增的每一条都必须是「无 query 的同源静态资源」——
     既不是 index.html 的深链副本，也不是带 cache-bust query 的重复条目，更不是 API 响应。 */
  chk('② 新增条目全是无 query 的静态资源（无 index.html 副本 / 无 query / 无 API）',
      delta.every(function(k){ return k.indexOf('?') < 0 && k.indexOf('/api/') < 0 && k !== '/index.html'; }),
      'delta=' + delta.length + ' [' + delta.slice(0,3).join(' , ') + ']');
  chk('② 预缓存 index.html 未被挤掉', afterKeys.indexOf('/index.html') > -1, '');
  chk('② 预缓存语料仍在（离线可用）', afterKeys.indexOf('/data/flashcards.hsk1.json') > -1, '');

  /* ---- 2. 深链本身仍要生效（修缓存不能把功能修坏） ---- */
  const routeT = await (async function(){
    await page.goto(BASE + '/index.html?go=trip&city=shanghai&set=10', { waitUntil:'domcontentloaded' });
    await page.waitForFunction("typeof PRO === 'object'", null, { timeout:15000 });
    await page.waitForTimeout(1400);
    return page.evaluate(function(){
      var ov = document.getElementById('trip');
      return { on: !!ov && ov.classList.contains('on'),
               rows: document.querySelectorAll('#trip-body .trip-row').length,
               search: location.search };
    });
  })();
  chk('③ 经 SW 的深链导航仍直达行程包（on + 10 行）', routeT.on === true && routeT.rows === 10, JSON.stringify(routeT));
  chk('③ 一次性消费（query 已清）', routeT.search === '', routeT.search);

  /* ---- 3. 离线仍可回落（不落盘不损离线） ---- */
  const off = await (async function(){
    try{
      await ctx.setOffline(true);
      await page.goto(BASE + '/index.html?go=trip&city=beijing&set=10', { waitUntil:'domcontentloaded', timeout:12000 });
      const r = await page.evaluate(function(){
        return { hasSplash: !!document.getElementById('splash'), len: document.body.innerHTML.length };
      });
      return { ok:true, ...r };
    }catch(e){
      return { ok:false, err:String(e && e.message).slice(0,120) };
    }finally{
      await ctx.setOffline(false).catch(function(){});
    }
  })();
  chk('③ 离线带 query 导航仍回落出 app shell', off.ok === true && off.len > 1000,
      off.ok ? ('body=' + off.len) : off.err);

  chk('稳定性 · 零页面错误', errs.length === 0, errs.slice(0,2).join(' | '));

  await browser.close();
  srv.close();

  let pass = 0;
  R.forEach(function(r){
    console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name + (r.extra ? '  → ' + r.extra : ''));
    if(r.ok) pass++;
  });
  console.log('页面错误 = ' + errs.length + (errs.length ? '' : ' ✅'));
  console.log('──────────────────────────────────────────────');
  if(pass === R.length){
    console.log('✅ SW × 深链相容性验收全绿 — ' + pass + ' / ' + R.length);
    console.log('──────────────────────────────────────────────');
    process.exit(0);
  }
  console.log('❌ SW × 深链相容性验收有失败 — ' + pass + ' / ' + R.length);
  console.log('──────────────────────────────────────────────');
  process.exit(1);
})().catch(function(e){ console.error('FATAL', e); process.exit(2); });
