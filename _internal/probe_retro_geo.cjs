#!/usr/bin/env node
/* 诊断：复盘分享卡的**排版几何**（哪一行有墨、横向范围）。
   一次性探针，用来定位「正文压过品牌分隔线」到底是谁在出墨。
   用法：NODE_PATH=<workspace>/node_modules node _internal/probe_retro_geo.cjs */
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

(async function(){
  await new Promise(function(r){ srv.listen(0, '127.0.0.1', r); });
  const PORT = srv.address().port, BASE = 'http://127.0.0.1:' + PORT;
  const browser = await chromium.launch({ channel:'chrome' });
  const ctx = await browser.newContext({ locale:'en-US' });
  const page = await ctx.newPage();
  await page.route('**/*', function(route){
    var u = route.request().url();
    if(u.indexOf(BASE) === 0) return route.continue();
    return route.abort();
  });
  await page.addInitScript(function(){
    try{ localStorage.setItem('sinoky_lang_chosen','1'); localStorage.removeItem('sinoky_state'); }catch(e){}
  });
  await page.goto(BASE + '/index.html', { waitUntil:'domcontentloaded' });
  await page.waitForFunction(function(){
    return typeof S === 'object' && typeof LM === 'object' && typeof RETRO === 'object' && typeof SHARE === 'object';
  }, null, { timeout:15000 });
  await page.waitForTimeout(400);

  const out = await page.evaluate(function(){
    try{
      S.onboarded = true; S.lm = LM.defaults(); LM.migrate();
      S.phrases = {}; S.days = [];
      /* 造一趟已结束的行程 + 有 digest（让卡片 8 个块全在场） */
      var t = new Date(Date.now() - 4*86400e3).toISOString().slice(0,10);
      LM.setTrip('上海', t, 3);
      var res = {}, DIAG = {};
      ['square','story'].forEach(function(fmt){
        SHARE.theme = 'retro'; SHARE.code = 'testcode';
        var cv = SHARE.draw(fmt);
        /* 关掉注入层两块覆盖物后再画一张，用来确认「正文几何」 */
        var savedLink = SHARE.link, im = window.NONO_SHARE_IMG;
        try{ SHARE.link = function(){ return ''; };
             if(im){ Object.defineProperty(im,'complete',{value:false,configurable:true});
                     Object.defineProperty(im,'naturalWidth',{value:0,configurable:true}); }
        }catch(e){}
        var cv2 = SHARE.draw(fmt);
        try{ SHARE.link = savedLink; }catch(e){}
        try{ delete im.complete; delete im.naturalWidth; }catch(e){}
        res[fmt + '_stub'] = cv2.toDataURL('image/png');
        /* 诊断：在「关掉覆盖物」的图上，看覆盖区里还有什么墨 */
        (function(){
          var W2 = cv2.width, H2 = cv2.height, g2 = cv2.getContext('2d');
          var d2 = g2.getImageData(0,0,W2,H2).data;
          function px2(x,y){ var i=(y*W2+x)*4; return [d2[i],d2[i+1],d2[i+2]]; }
          var c2 = {}, b2 = '', bn = 0, kk;
          for(var y=0;y<H2;y+=4) for(var x=0;x<W2;x+=4){ var pp=px2(x,y); kk=pp[0]+','+pp[1]+','+pp[2];
            c2[kk]=(c2[kk]||0)+1; if(c2[kk]>bn){bn=c2[kk];b2=kk;} }
          var bgg = b2.split(',').map(Number);
          function ink2(x,y){ var pp=px2(x,y);
            return Math.abs(pp[0]-bgg[0])+Math.abs(pp[1]-bgg[1])+Math.abs(pp[2]-bgg[2])>26; }
          var PAD=84, box;
          if(fmt==='square') box = { x0:820, y0:614, x1:996, y1:830 };
          else box = { x0:617, y0:1286, x1:996, y1:1670 };
          var n=0, samples=[];
          for(var y5=box.y0;y5<=box.y1;y5++) for(var x5=box.x0;x5<=box.x1;x5++){
            if(ink2(x5,y5)){ n++; if(samples.length<6) samples.push(x5+','+y5+'='+px2(x5,y5).join('/')); }
          }
          DIAG[fmt] = { bg:bgg.join(','), box:box, n:n, samples:samples };
        })();
        var W = cv.width, H = cv.height, c2 = cv.getContext('2d');
        var img = c2.getImageData(0,0,W,H).data;
        function at(x,y){ var i=(y*W+x)*4; return [img[i],img[i+1],img[i+2]]; }
        var cnt={}, best='', bestN=0, k;
        for(var y=0;y<H;y+=4) for(var x=0;x<W;x+=4){ var p=at(x,y); k=p[0]+','+p[1]+','+p[2];
          cnt[k]=(cnt[k]||0)+1; if(cnt[k]>bestN){bestN=cnt[k];best=k;} }
        var bg = best.split(',').map(Number);
        function ink(x,y){ var p=at(x,y); return Math.abs(p[0]-bg[0])+Math.abs(p[1]-bg[1])+Math.abs(p[2]-bg[2])>26; }
        var rows=[], start=-1;
        for(var yy=0; yy<H; yy++){
          var n=0, minx=1e9, maxx=-1;
          for(var xx=0; xx<W; xx++){ if(ink(xx,yy)){ n++; if(xx<minx)minx=xx; if(xx>maxx)maxx=xx; } }
          if(n>0){ if(start<0) start=yy; }
          else if(start>=0){ rows.push({ y0:start, y1:yy-1 }); start=-1; }
        }
        if(start>=0) rows.push({ y0:start, y1:H-1 });
        /* 每个 band 的代表 x 范围 */
        rows = rows.map(function(r){
          var minx=1e9,maxx=-1, mid=Math.floor((r.y0+r.y1)/2);
          for(var xx=0; xx<W; xx++){ if(ink(xx,mid)){ if(xx<minx)minx=xx; if(xx>maxx)maxx=xx; } }
          return { y0:r.y0, y1:r.y1, h:r.y1-r.y0+1, x0:minx, x1:maxx };
        });
        /* raw：安全带附近逐行（用来定位到底是谁在出墨） */
        var BOT0 = (fmt === 'story') ? (H - 470) : 806;
        var raw = [];
        for(var yr = BOT0 - 30; yr <= H; yr += 2){
          var n2=0, mn=1e9, mx=-1;
          for(var xr=0; xr<W; xr++){ if(ink(xr,yr)){ n2++; if(xr<mn)mn=xr; if(xr>mx)mx=xr; } }
          if(n2) raw.push(yr + ':' + n2 + '@' + mn + '-' + mx);
        }
        res[fmt] = { W:W, H:H, bg:bg, TOP:(fmt==='story'?340:176), BOT:(fmt==='story'?(H-470):806),
                     DIV:H-228, bands:rows, raw:raw, png:cv.toDataURL('image/png') };
      });
      return { ok:true, data:res, diag:DIAG };
    }catch(e){ return { err:String(e && e.stack || e) }; }
  });

  if(out.err){ console.log('ERR', out.err); }
  else {
    var OUT = path.join(__dirname, '_shots');
    try{ fs.mkdirSync(OUT, { recursive:true }); }catch(e){}
    ['square','story'].forEach(function(fmt){
      var d = out.data[fmt];
      if(d.png){
        fs.writeFileSync(path.join(OUT, 'probe-retro-' + fmt + '.png'),
          Buffer.from(String(d.png).split(',')[1], 'base64'));
      }
      var s = out.data[fmt + '_stub'];
      if(s){
        fs.writeFileSync(path.join(OUT, 'probe-retro-' + fmt + '-stub.png'),
          Buffer.from(String(s).split(',')[1], 'base64'));
      }
      console.log('\n===== ' + fmt + ' ' + d.W + '×' + d.H + ' bg=' + d.bg.join(',') +
                  ' TOP=' + d.TOP + ' BOT=' + d.BOT + ' DIV=' + d.DIV + ' =====');
      var dg = (out.diag || {})[fmt];
      if(dg) console.log('  DIAG mascotBox=' + JSON.stringify(dg.box) + ' ink=' + dg.n + ' bg=' + dg.bg + ' samples: ' + dg.samples.join('  '));
      d.bands.forEach(function(b){
        var flag = (b.y1 > d.BOT && b.y0 < d.DIV) ? '  <== 侵入安全带/品牌区' : '';
        console.log('  y[' + b.y0 + '..' + b.y1 + '] h=' + b.h + '  x[' + b.x0 + '..' + b.x1 + ']' + flag);
      });
    });
  }
  await browser.close();
  srv.close();
})();
