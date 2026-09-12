const { chromium } = require('playwright-core');

const APP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const OUT = APP + '/_internal/nono-ip-v1';
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function startServer() {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/') u = '/index.html';
      fs.readFile(path.join(APP, u), (e, buf) => {
        if (e) { rsp.writeHead(404); return rsp.end('404'); }
        rsp.writeHead(200, { 'Content-Type': MIME[path.extname(u).toLowerCase()] || 'application/octet-stream' });
        rsp.end(buf);
      });
    });
    s.listen(8101, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const srv = await startServer();
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await p.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('/api/')) return r.fallback();
    if (u.includes('127.0.0.1')) return r.continue();
    return r.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  await p.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await p.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await p.goto('http://127.0.0.1:8101/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  const hide = () => p.evaluate(() => {
    ['splash', 'v-onboard', 'rd-mask', 'fb-mask', 'share-mask'].forEach((i) => { const e = document.getElementById(i); if (e) e.style.display = 'none'; });
  });
  await hide();

  // ① 启动屏（趁它还没被移出 DOM，重载取一次）
  const p2 = await ctx.newPage();
  await p2.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('/api/')) return r.fallback();
    if (u.includes('127.0.0.1')) return r.continue();
    return r.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  await p2.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await p2.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await p2.goto('http://127.0.0.1:8101/index.html', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(150);
  await p2.screenshot({ path: OUT + '/_evidence-1-splash.png' });
  await p2.close();

  // ② v-scene 主练习页 + 边角气泡（只显示气泡，不显示动作条）
  await p.evaluate(() => { window.openScene('food', 0); });
  await p.waitForTimeout(1000);
  await hide();
  await p.evaluate(() => document.getElementById('nono-fab').scrollIntoView());
  await p.screenshot({ path: OUT + '/_evidence-2-scene-tip.png' });

  // ③ 分享卡（1080×1080）带诺诺
  await p.evaluate(() => {
    const a = document.getElementById('nono-again'); if (a) a.classList.remove('on');
    const cv = window.SHARE.draw('square');
    cv.id = '__evidence_card';
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;width:420px;height:420px';
    document.body.appendChild(cv);
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const cv = document.getElementById('__evidence_card');
    if (cv) { const b64 = cv.toDataURL('image/png'); const a = document.createElement('a'); a.href = b64; a.download = 'x'; window.__card64 = b64; }
  });
  const cardB64 = await p.evaluate(() => window.__card64 || '');
  if (cardB64) fs.writeFileSync(OUT + '/_evidence-3-sharecard.png', Buffer.from(cardB64.split(',')[1], 'base64'));

  console.log('截图完成：_evidence-1-splash.png / _evidence-2-scene-tip.png / _evidence-3-sharecard.png');
  await b.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(2); });
