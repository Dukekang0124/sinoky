// v0.23.17 复习 AI 弱点出题 运行时验收（Playwright 真 Chrome + mock API）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8131;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json',
  '.webp':'image/webp', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' };

function startServer(){
  return new Promise((resolve)=>{
    const srv = http.createServer((req,res)=>{
      let u = decodeURIComponent(req.url.split('?')[0]);
      if(u === '/') u = '/index.html';
      const fp = path.join(ROOT, u);
      if(!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()){
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, {'Content-Type': MIME[path.extname(fp)]||'application/octet-stream'});
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(PORT, ()=>resolve(srv));
  });
}

const DRILL_REPLY = '你好吗 | How are you';
const COACH_REPLY = '三声读得不错，注意「你」先降后升！';

function mkRoutes(page, failDrill){
  page.route('**/api/chat', r=>{
    const rb = r.request().postData() || '';
    let reply = COACH_REPLY, mode = 'coach';
    try{ const j = JSON.parse(rb); mode = j.mode; }catch(e){}
    if(failDrill && mode === 'drill') return r.fulfill({status:500, contentType:'application/json', body:'{"ok":false}'});
    if(mode === 'drill') reply = DRILL_REPLY;
    return r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({ok:true, reply, model:'glm-4-flash', degraded:false})});
  });
  page.route('**/api/score', r=>r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({overall:62, perSyll:[{target:'你',user:'泥',score:0.2,toneOk:false,tExp:3},{target:'好',user:'好',score:0.99}]})}));
  page.route('**/api/asr', r=>r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({ok:true, text:'泥好'})}));
  page.route('**/api/tts', r=>r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({ok:true, url:''})}));
  page.route('**/api/profile', r=>r.fulfill({status:200, contentType:'application/json', body:'{}'}));
  page.route('**/api/feedback', r=>r.fulfill({status:200, contentType:'application/json', body:'{"ok":true}'}));
  page.route('**/langs/*.json', r=>r.fulfill({status:200, contentType:'application/json', body:'{}'}));
}

async function newPage(browser, lang, failDrill){
  const ctx = await browser.newContext({ serviceWorkers:'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e=>{ page.__err = (page.__err||0)+1; console.log('  [pageerror]', e.message); });
  await page.addInitScript((L)=>{
    const st = { onboarded:true, lang:L, aiWeak:{dims:{tone3:2, initial:1}}, phrases:{'basics':[0,1,2,3]}, rev:{}, review:{d:new Date().toISOString().slice(0,10), n:0}, feat:{}, tone:{} };
    localStorage.setItem('sinoky_state', JSON.stringify(st));
  }, lang);
  mkRoutes(page, failDrill);
  await page.goto('http://localhost:'+PORT+'/index.html?cb=verify', { waitUntil:'domcontentloaded' });
  // 等待 init 渲染首页
  await page.waitForFunction(()=>typeof window.renderHome==='function' && document.getElementById('home-scenes'), null, {timeout:8000}).catch(()=>{});
  return page;
}

(async ()=>{
  const srv = await startServer();
  const browser = await chromium.launch({ channel:'chrome' });
  let pass = true;

  // ---- 在线：出题填充 + 跟我读闭环 ----
  console.log('TEST online: home AI drill card + speak loop');
  const p = await newPage(browser, 'en', false);
  await p.waitForTimeout(600); // 等 coachDrill setTimeout(80)+fetch
  const online = await p.evaluate(()=>{
    const box = document.getElementById('rev-ai-drill');
    const card = document.querySelector('.review-drill');
    return {
      hasCard: !!card,
      boxHtml: box ? box.innerHTML : '',
      hasHz: box ? /rd-hz/.test(box.innerHTML) : false,
      hasBtn: box ? /btn primary/.test(box.innerHTML) : false,
      title: card ? card.querySelector('h2') ? card.querySelector('h2').textContent : '' : ''
    };
  });
  console.log('  online:', JSON.stringify(online));
  if(!online.hasCard || !online.hasHz || !online.hasBtn){ pass=false; console.log('  FAIL: drill card not filled'); }

  // 点"跟我读"
  let spoke = false;
  try{
    await p.click('.review-drill button.btn.primary', { timeout:3000 });
    await p.waitForTimeout(200);
    spoke = await p.evaluate(()=>{
      const panel = document.getElementById('nono-panel');
      const shown = panel ? panel.style.display === 'block' : false;
      const hz = (window.NONO_LINE && window.NONO_LINE.hz) || '';
      const rd = (window.S && window.S.revDrill) || {};
      return { shown, hz, rdHz: rd.hz||'', rdDate: rd.date||'' };
    });
    console.log('  spoke:', JSON.stringify(spoke));
    if(!spoke.shown || spoke.hz !== '你好吗' || spoke.rdHz !== '你好吗'){ pass=false; console.log('  FAIL: speak loop broken'); }
  }catch(e){ pass=false; console.log('  FAIL click:', e.message); }
  const errOnline = p.__err||0;
  await p.context().close();

  // ---- 离线：drill 返回 500 → 离线兜底 ----
  console.log('TEST offline: drill 500 → fallback');
  const p2 = await newPage(browser, 'en', true);
  await p2.waitForTimeout(600);
  const offline = await p2.evaluate(()=>{
    const box = document.getElementById('rev-ai-drill');
    return { boxHtml: box ? box.innerHTML : '', hasOffline: box ? /rd-offline/.test(box.innerHTML) : false };
  });
  console.log('  offline:', JSON.stringify(offline));
  if(!offline.hasOffline){ pass=false; console.log('  FAIL: offline fallback missing'); }
  const errOffline = p2.__err||0;
  await p2.context().close();

  // ---- 7 语言零回归 ----
  console.log('TEST 7 langs: no pageerror, card appears');
  const langs = ['en','zh','es','ru','vi','id','th'];
  for(const L of langs){
    const pg = await newPage(browser, L, false);
    await pg.waitForTimeout(500);
    const r = await pg.evaluate(()=>{
      const card = document.querySelector('.review-drill');
      const box = document.getElementById('rev-ai-drill');
      return { hasCard: !!card, filled: box ? /rd-hz|rd-skel|rd-offline/.test(box.innerHTML) : false };
    });
    const err = pg.__err||0;
    console.log('  '+L+':', JSON.stringify(r), 'pageerror='+err);
    if(err>0){ pass=false; console.log('  FAIL '+L+' pageerror'); }
    if(!r.hasCard || !r.filled){ pass=false; console.log('  FAIL '+L+' card/fill'); }
    await pg.context().close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + (pass ? 'ALL_PASS' : 'HAS_FAILURE') + ' (onlineErr='+errOnline+', offlineErr='+errOffline+')');
  process.exit(pass ? 0 : 1);
})().catch(e=>{ console.error('RUNNER_ERR', e); process.exit(2); });
