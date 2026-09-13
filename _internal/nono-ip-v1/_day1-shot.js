/* ============================================================================
   导出 §14 Day1 通关纪念卡实物（方图 + 竖版），并同时导 start 卡作对照
   跑法：NODE_PATH=... node _day1-shot.js [输出目录]
   ============================================================================ */
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const OUT = APP + '/_internal/nono-ip-v1/' + (process.argv[2] || '_day1_shots');
const PORT = 8108;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function startServer() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/') u = '/index.html';
      const f = path.join(APP, u);
      fs.readFile(f, (e, buf) => {
        if (e) { rsp.writeHead(404); return rsp.end('404'); }
        const ext = path.extname(f).toLowerCase();
        rsp.writeHead(200, { 'Content-Type': u === '/index.html' ? 'text/html; charset=utf-8' : (MIME[ext] || 'application/octet-stream') });
        rsp.end(buf);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

async function main() {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, locale: 'en-US' });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  /* 造数据：Day1 三场景全通 + 有昵称（测最满排版） */
  const seed = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
    s.onboarded = true; s.streak = 3;
    s.days = [new Date().toISOString().slice(0, 10)];
    s.phrases = {};
    const ids = (window.SCENES || []).filter((x) => x && x.day1);
    ids.forEach((sc) => { s.phrases[sc.id] = (sc.phrases || []).map((_, k) => k); });
    localStorage.setItem('sinoky_state', JSON.stringify(s));
    localStorage.setItem('sinoky_share_nick', 'Alex');
    return { ids: ids.map((x) => x.id) };
  });
  console.log('seed =', JSON.stringify(seed));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);

  fs.mkdirSync(OUT, { recursive: true });
  for (const fmt of ['square', 'story']) {
    for (const t of ['day1', 'start']) {
      const r = await page.evaluate((arg) => {
        try {
          SHARE.theme = arg.t; SHARE.FMT = arg.f; SHARE.ctx = null;
          SHARE.code = 'test1234';
          const cv = SHARE.draw(arg.f);
          if (!cv) return { e: 'NULL' };
          return { d: cv.toDataURL('image/png'), w: cv.width, h: cv.height };
        } catch (e) { return { e: e.message }; }
      }, { t, f: fmt });
      if (!r || !r.d) { console.log('skip', t, fmt, JSON.stringify(r).slice(0, 80)); continue; }
      const name = `card_${t}_${fmt}.png`;
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.d.split(',')[1], 'base64'));
      console.log('wrote', name, r.w + 'x' + r.h);
    }
  }

  await browser.close();
  srv.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
