#!/usr/bin/env node
/* v0.27.0 视觉真跑：把场景教练面板的四个关键状态截图（首页入口卡 / 第一轮 / 评分反馈 / 结算）。
   为什么要它：功能测试只证明「逻辑对」，不证明「看得见、不跑版」——中文长句 + 拼音 + 气泡
   在窄屏上的换行、面板高度、按钮可见性都只有截图能确认。
   用法：NODE_PATH=<workspace>/node_modules node _internal/shot_rp.cjs */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '_shots');
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

(async function(){
  if(!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive:true });
  await new Promise(function(r){ srv.listen(0, '127.0.0.1', r); });
  const PORT = srv.address().port, BASE = 'http://127.0.0.1:' + PORT;
  const browser = await chromium.launch({ channel:'chrome' });
  const ctx = await browser.newContext({ locale:'en-US', viewport:{ width:390, height:844 }, deviceScaleFactor:2 });
  const page = await ctx.newPage();

  await page.route('**/*', async function(route){
    const u = route.request().url();
    if(u.indexOf(BASE) === 0){
      const pth = new URL(u).pathname;
      if(pth.indexOf('/api/') === 0){
        if(pth === '/api/register') return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true,"uid":"shot-uid"}' });
        if(pth === '/api/score') return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ overall:82, verdict:'Good',
          perSyll:[ { target:'两', user:'两', score:1, toneOk:true },
                    { target:'个', user:'个', score:0.5, toneOk:false, tExp:4, tGot:2, errs:['tone'] } ] }) });
        if(pth === '/api/chat') return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true,"reply":"{\\"hit\\":false,\\"reply\\":\\"\\"}"}' });
        return route.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
      }
      return route.continue();
    }
    return route.abort();
  });
  await page.addInitScript(function(){
    try{ localStorage.setItem('sinoky_lang_chosen','1'); localStorage.removeItem('sinoky_state'); }catch(e){}
  });

  await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(function(){ return typeof RP === 'object' && typeof S === 'object'; }, null, { timeout:15000 });
  await page.evaluate(function(){
    S.lm = LM.defaults(); LM.migrate();
    LM.setGoal({ purpose:'travel', cities:['上海'], arrive:'2026-10-05', native:'en' });
    LM.get().policy.hint = 'gentle';
    renderHome();
    go('home');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT,'1-home-card.png'), fullPage:false });

  /* 第一轮（gentle 档：带中文提示） */
  await page.evaluate(function(){ rpStart('order-food'); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT,'2-round1-hint.png'), fullPage:false });
  console.log('round1 box:', JSON.stringify(await page.evaluate(function(){
    var b = document.querySelector('#rp .sess-box'), h = document.querySelector('#rp .sess-head');
    var r = b.getBoundingClientRect(), hr = h.getBoundingClientRect();
    var btn = h.querySelector('.btn').getBoundingClientRect();
    return { boxH:Math.round(r.height), top:Math.round(r.top), bottom:Math.round(r.bottom), vh:window.innerHeight,
              clipped: r.top < 0 || r.bottom > window.innerHeight + 1,
              headH:Math.round(hr.height), closeW:Math.round(btn.width) };
  })));

  /* hard 档：只给意图，不泄露答案 */
  await page.evaluate(function(){ LM.get().policy.hint = 'hard'; renderRp(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT,'3-hard-no-hint.png'), fullPage:false });

  /* 命中一轮 + 评分反馈 */
  await page.evaluate(async function(){ await rpScore('两个人，谢谢'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT,'4-scored.png'), fullPage:false });

  /* 结算页 */
  await page.evaluate(async function(){
    var guard = 0;
    while(!RP.isOver() && guard++ < 8){ var t = RP.turn(); await rpScore(t.kw[0]); }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT,'5-settle.png'), fullPage:false });

  /* 用面板实际尺寸检查是否被裁（日志可读） */
  const box = await page.evaluate(function(){
    var b = document.querySelector('#rp .sess-box');
    if(!b) return null;
    var r = b.getBoundingClientRect();
    return { w:Math.round(r.width), h:Math.round(r.height), vh:window.innerHeight,
             clipped: r.height > window.innerHeight + 1 };
  });
  console.log('panel box:', JSON.stringify(box));

  await browser.close(); srv.close();
  console.log('shots →', OUT);
})().catch(function(e){ console.error('FATAL', e); process.exit(2); });
