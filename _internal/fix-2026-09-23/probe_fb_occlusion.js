/* 一次性探针：量 #fb-open 与首页引导卡末行的几何关系（A/B：隐藏浮标对比） */
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'); const PORT = 8143;
const MIME = { '.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.mp3':'audio/mpeg' };
function serve(req,res){ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const full=path.join(ROOT,p); if(!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);res.end('nf');return;}
  res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream'}); fs.createReadStream(full).pipe(res); }
(async()=>{
  const server=http.createServer(serve); await new Promise(r=>server.listen(PORT,r));
  for (const vp of [{width:430,height:932,n:'iPhone14ProMax'},{width:390,height:844,n:'iPhone14'},{width:360,height:740,n:'Android-small'}]) {
    const browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:vp.width,height:vp.height},deviceScaleFactor:2});
    await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
    await page.goto('http://localhost:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(1500);
    await page.evaluate(()=>{ try{document.getElementById('splash').classList.add('hide');}catch(e){}
      try{ localStorage.removeItem('sinoky_tour'); }catch(e){}
      try{ if(typeof S!=='undefined'){ S.onboarded=true; } }catch(e){}
      try{ if(typeof go==='function') go('home'); }catch(e){} });
    await page.waitForTimeout(600);
    const r=await page.evaluate(()=>{
      const R=el=>{ if(!el) return null; const b=el.getBoundingClientRect(); return {l:+b.left.toFixed(1),t:+b.top.toFixed(1),r:+b.right.toFixed(1),b:+b.bottom.toFixed(1)}; };
      const fb=document.getElementById('fb-open');
      const descs=[...document.querySelectorAll('#v-home .desc')];
      let last=null; for(const d of descs){ if(/Recordings are never saved/.test(d.textContent)) last=d; }
      if(!last) last=descs[descs.length-1]||null;
      const dR=last?R(last):null, fR=fb?R(fb):null;
      const hit=(a,b)=> (a&&b)? !(a.r<=b.l||b.r<=a.l||a.b<=b.t||b.b<=a.t) : null;
      const de=document.documentElement;
      /* 关键：行盒 ≠ 字形。用 Range 取**紧致字形矩形**，才是真正会被压到的像素带。 */
      let glyphR=null, glyphLines=[];
      try{
        const rg=document.createRange(); rg.selectNodeContents(last);
        const rects=[...rg.getClientRects()].map(r=>({l:+r.left.toFixed(1),t:+r.top.toFixed(1),r:+r.right.toFixed(1),b:+r.bottom.toFixed(1)}));
        glyphLines=rects;
        if(rects.length){ glyphR={ l:Math.min(...rects.map(x=>x.l)), t:Math.min(...rects.map(x=>x.t)), r:Math.max(...rects.map(x=>x.r)), b:Math.max(...rects.map(x=>x.b)) }; }
      }catch(x){}
      const hitG=(a,b)=> (a&&b)? !(a.r<=b.l||b.r<=a.l||a.b<=b.t||b.b<=a.t) : null;
      return { descText: last? last.textContent.slice(0,90) : null, descR:dR, fbR:fR,
        glyphR, glyphLines, glyphOverlap: hitG(glyphR, fR), glyphClipPx: (glyphR&&fR)? +Math.max(0, Math.min(glyphR.b,fR.b)-Math.max(glyphR.t,fR.t)).toFixed(1) : null,
        overlap:hit(dR,fR), scrollH:de.scrollHeight, innerH:window.innerHeight,
        scrollable: de.scrollHeight>window.innerHeight+1,
        descLines: last? Math.round(last.getBoundingClientRect().height/ (parseFloat(getComputedStyle(last).lineHeight)||16)) : null };
    });
    console.log('\n['+vp.n+' '+vp.width+'x'+vp.height+']');
    console.log('  可滚动 =', r.scrollable, '(scrollH', r.scrollH, 'vs innerH', r.innerH, ')');
    console.log('  末行文本 =', JSON.stringify(r.descText));
    console.log('  desc rect =', JSON.stringify(r.descR), ' 行数≈', r.descLines);
    console.log('  fb   rect =', JSON.stringify(r.fbR));
    console.log('  字形紧致 =', JSON.stringify(r.glyphR), ' 每行=', JSON.stringify(r.glyphLines));
    console.log('  >>> 行盒重叠 =', r.overlap, r.overlap?'(含行高留白，非真实遮挡)':'');
    console.log('  >>> 字形是否被压 =', r.glyphOverlap, ' 纵向削掉 =', r.glyphClipPx, 'px');
    await browser.close();
  }
  server.close();
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
