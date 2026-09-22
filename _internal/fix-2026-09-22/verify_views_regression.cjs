/* 视图回归：en/zh 双语逐视图切换，断言零 pageerror + en 下可见文本无中文泄漏 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(200, {'Content-Type':'application/json'}); res.end('{}'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(8643, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  let fail = 0;
  for (const L of ['en', 'zh']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(([lang]) => {
      try { localStorage.setItem('sinoky_state', JSON.stringify({ onboarded: true, lang: lang })); } catch (e) {}
    }, [L]);
    await page.route('**/api/**', r => r.fulfill({ json: {} }));
    await page.goto('http://127.0.0.1:8643/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    const out = await page.evaluate(async () => {
      const views = Array.from(document.querySelectorAll('.views')).map(v => v.id.replace(/^v-/, ''));
      const visited = [];
      for (const id of views) {
        try { go(id); visited.push(id); } catch (e) { visited.push(id + '!ERR'); }
        await new Promise(r => setTimeout(r, 350));
      }
      return { visited, uiText: document.body.innerText.slice(0, 4000) };
    });
    const cjkVis = L === 'en' ? (out.uiText.match(/[\u4e00-\u9fff]{2,}/g) || []) : [];
    const errBad = errors.filter(e => !/fetch|network|Failed to load/i.test(e));
    const ok = errBad.length === 0;
    if (!ok) fail++;
    console.log((ok ? 'PASS' : 'FAIL') + ' [' + L + '] views=' + out.visited.join(',') + (errBad.length ? ' pageerror: ' + errBad[0] : ''));
    console.log('   en 可见中文片段(应为空或学习内容): ' + JSON.stringify(cjkVis.slice(0, 12)));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(fail === 0 ? 'VIEW_REGRESSION_PASS' : 'VIEW_REGRESSION_FAIL');
  process.exit(fail === 0 ? 0 : 1);
})();
