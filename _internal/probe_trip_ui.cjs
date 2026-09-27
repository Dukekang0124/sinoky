#!/usr/bin/env node
/* 行程包面板 · 横向溢出探针（真跑）。
   动机：线上截图里每行右侧的音量/录音按钮看着像被容器右边缘裁掉。
   本脚本不靠肉眼看图 —— 直接量 `.sess-box` 右边界 与 行内动作区每个子元素的
   getBoundingClientRect().right，任何子元素 right > 容器 right（容差 1px）即判裁切。
   顺带量首页主动卡位置（截图取证要滚到它）。
   用法：NODE_PATH=$WS/node_modules node _internal/probe_trip_ui.cjs */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8',
  '.json':'application/json;charset=utf-8', '.webp':'image/webp', '.png':'image/png',
  '.css':'text/css', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
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

(async function(){
  await new Promise(function(r){ srv.listen(0, '127.0.0.1', r); });
  const PORT = srv.address().port, BASE = 'http://127.0.0.1:' + PORT;
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  /* 用两种视口各测一遍：390（iPhone 常见）/ 320（最窄主流安卓） */
  for(const vw of [390, 320]){
    const page = await browser.newPage({ viewport:{ width: vw, height: 844 }, deviceScaleFactor: 2 });
    page.on('pageerror', function(){});
    await page.route('**/*', function(route){
      const u = route.request().url();
      if(u.indexOf(BASE) === 0) return route.continue();
      if(u.indexOf('/api/') > -1) return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
      return route.abort();
    });
    await page.addInitScript(function(){
      try{ localStorage.setItem('sinoky_lang_chosen','1'); localStorage.removeItem('sinoky_state'); }catch(e){}
    });
    await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
    await page.waitForFunction("typeof S==='object' && typeof PRO==='object'", null, { timeout:15000 });

    const m = await page.evaluate(function(arrive){
      S.onboarded = true; if(!S.lm){ S.lm = LM.defaults(); LM.migrate(); }
      LM.setTrip('上海', arrive, 0);
      go('home'); renderHome();
      /* 主动卡位置（截图要滚到它） */
      var chip = document.querySelector('#home-scenes [onclick*="openTrip"]');
      var cardInfo = chip ? (function(){
        var row = chip.closest('.pcard, .card, div') || chip;
        var r = row.getBoundingClientRect();
        return { found:true, top: Math.round(r.top + window.scrollY), h: Math.round(r.height) };
      })() : { found:false };
      openTrip('shanghai', 10);
      var box = document.querySelector('#trip .sess-box') || document.querySelector('#trip > div');
      var br = box.getBoundingClientRect();
      var bad = [], acts = [];
      document.querySelectorAll('#trip-body .trip-row').forEach(function(row, i){
        var r = row.getBoundingClientRect();
        var act = row.querySelector('.tr-act');
        if(!act) return;
        var ar = act.getBoundingClientRect();
        var kids = [];
        Array.prototype.slice.call(act.children).forEach(function(k){
          var kr = k.getBoundingClientRect();
          kids.push({ cls: String(k.className || k.tagName).slice(0, 22),
                      left: Math.round(kr.left), right: Math.round(kr.right), w: Math.round(kr.width) });
          /* 裁切判据：子元素右边缘超出会话盒右边界（容差 1px） */
          if(kr.right > br.right + 1) bad.push({ row:i, cls: String(k.className||'').slice(0,20), over: Math.round(kr.right - br.right) });
          if(kr.left < br.left - 1)  bad.push({ row:i, cls: String(k.className||'').slice(0,20), overLeft: Math.round(br.left - kr.left) });
        });
        acts.push({ i:i, rowW: Math.round(r.width), actLeft: Math.round(ar.left), actRight: Math.round(ar.right), kids: kids });
      });
      /* 行内容是否被挤出（.tr-main 的右边界 vs .tr-act 的左边界） */
      var overlaps = 0;
      document.querySelectorAll('#trip-body .trip-row').forEach(function(row){
        var main = row.querySelector('.tr-main'), act = row.querySelector('.tr-act');
        if(main && act && main.getBoundingClientRect().right > act.getBoundingClientRect().left + 1) overlaps++;
      });
      /* 全子树扫描：不只查行内动作区，把 #trip 里**任何**右边缘越界的元素都抓出来 */
      var sub = [];
      var seen = {};
      document.querySelectorAll('#trip *').forEach(function(el){
        var r = el.getBoundingClientRect();
        if(r.width === 0 && r.height === 0) return;
        if(r.right > br.right + 1){
          var key = String(el.className || el.tagName);
          if(seen[key]) return;
          seen[key] = 1;
          sub.push({ cls: key.slice(0,26), right: Math.round(r.right), over: Math.round(r.right - br.right) });
        }
      });
      return { boxRight: Math.round(br.right), boxLeft: Math.round(br.left), boxW: Math.round(br.width),
               rows: acts.length, bad: bad.slice(0,8), badN: bad.length,
               firstRow: acts[0] || null, overlaps: overlaps, cardInfo: cardInfo,
               subOver: sub.slice(0,10), subOverN: sub.length,
               docScrollW: Math.round(document.documentElement.scrollWidth),
               winW: window.innerWidth };
    }, new Date(Date.now() + 8*3600e3 + 86400e3).toISOString().slice(0,10));

    console.log('===== 视口宽 ' + vw + ' =====');
    console.log('会话盒：left=' + m.boxLeft + ' right=' + m.boxRight + ' w=' + m.boxW +
                ' | 文档 scrollWidth=' + m.docScrollW + ' winW=' + m.winW);
    console.log('主动卡：' + JSON.stringify(m.cardInfo));
    console.log('行数=' + m.rows + ' | 行内动作区越界元素=' + m.badN + (m.badN ? ' → ' + JSON.stringify(m.bad) : ' ✅'));
    console.log('内容区压到动作区=' + m.overlaps + ' 行' + (m.overlaps ? ' ❌' : ' ✅'));
    console.log('全子树越界元素=' + m.subOverN + (m.subOverN ? ' → ' + JSON.stringify(m.subOver) : ' ✅'));
    console.log('第 1 行动作区：' + JSON.stringify(m.firstRow));
    await page.close();
  }
  await browser.close();
  srv.close();
})().catch(function(e){ console.error('FATAL', e); process.exit(2); });
