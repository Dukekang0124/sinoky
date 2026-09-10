const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 用法: node ab_old_panel.js <dirContainingIndex> <label>
const ROOT = path.resolve(process.argv[2]);
const LABEL = process.argv[3] || ROOT;

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.webmanifest':'application/manifest+json' };
function serve(req, res) {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if(p.endsWith('/') || !path.extname(p)) p = path.join(p, 'index.html');
  if(!fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  fs.createReadStream(p).pipe(res).writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'});
}

const server = http.createServer(serve);
server.listen(8139, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route(/\/api\/(chat|asr|tts|score)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('http://localhost:8139/index.html');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    var sp = document.getElementById('splash'); if(sp) sp.remove();
    var ob = document.getElementById('v-onboard'); if(ob){ ob.classList.remove('on'); ob.style.display='none'; }
    if (typeof nonoToggle === 'function') nonoToggle();
    if (typeof nonoStartChat === 'function') nonoStartChat();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const longText = '今天天气真不错，我想去美国旅行。你觉得我应该去纽约还是洛杉矶？';
    for (let i = 0; i < 40; i++) {
      if (typeof nonoChatBubble === 'function') { nonoChatBubble('you', longText + ' [' + i + ']'); nonoChatBubble('nono', '哇，这听起来很棒！[' + i + ']'); }
    }
  });
  await page.waitForTimeout(300);
  const dims = await page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    return { panelH: p ? p.offsetHeight : -1, viewportH: window.innerHeight, overflowRatio: p ? +(p.offsetHeight / window.innerHeight).toFixed(2) : -1 };
  });
  console.log('[' + LABEL + '] ' + JSON.stringify(dims) + (dims.panelH > 750 ? '  <-- PANEL OVERFLOWS' : '  <-- panel bounded'));
  await page.screenshot({ path: path.join(__dirname, 'screenshot_ab_' + LABEL + '.png') });
  await ctx.close(); await browser.close(); server.close();
  process.exit(0);
});
