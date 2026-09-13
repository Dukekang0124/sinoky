/* ============================================================================
   §14 Day1 通关纪念卡 —— 探针（先看清事实，再写正式验收）
   问四件事：
     A. 主代码绘图原语在注入层是否可见（已确认可见 ⇒ §14 直接复用）
     B. Day1 全通时 __day1Info() / SHARE.pool() / SHARE.draw() 行为
     C. 未全通时是否**完全**降级为 start 卡（排除二维码区：t= 参数不同必然图案不同）
     D. 视觉同源：Day1 卡与 start 卡在「非内容区」是否像素完全一致
        —— 这是「复用主代码原语」是否真的生效的硬证据
   跑法：NODE_PATH=... node _probe-day1.js
   ============================================================================ */
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const PORT = 8107;

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

/* 在浏览器里安装比较工具（每次 reload 后都要重装） */
function installCmp() {
  window.__regionDiff = function (a, b, regions) {
    const out = [];
    for (const r of regions) {
      let d = 0, n = 0;
      for (let y = r.y0; y < r.y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const i = (y * a.width + x) * 4;
          n++;
          if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) d++;
        }
      }
      out.push({ name: r.name, diff: d, total: n });
    }
    return out;
  };
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
  await page.waitForTimeout(1200);
  await page.evaluate(installCmp);

  /* ---------- A. 作用域可见性 ---------- */
  const vis = await page.evaluate(() => {
    const t = (n) => { try { return eval('typeof ' + n); } catch (e) { return 'THROW'; } };
    const out = {};
    ['S', 'SCENES', 'SHARE', 'buildStat', '_corner', '_hui', '_brand', '_seal', '_fit', '_stack',
     '__day1Info', '__day1Draw', '__qrDrawInto'].forEach((n) => { out[n] = t(n); });
    return out;
  });
  console.log('===== A. 符号可见性 =====');
  console.log('   ' + Object.keys(vis).map((k) => k + '=' + vis[k]).join('  '));

  /* ---------- 种「Day1 全通」 ---------- */
  const seed = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
    s.onboarded = true; s.streak = 3;
    s.days = [new Date().toISOString().slice(0, 10)];
    s.phrases = {};
    const ids = (window.SCENES || []).filter((x) => x && x.day1);
    ids.forEach((sc) => { s.phrases[sc.id] = (sc.phrases || []).map((_, k) => k); });
    localStorage.setItem('sinoky_state', JSON.stringify(s));
    return { ids: ids.map((x) => x.id), counts: ids.map((x) => (x.phrases || []).length) };
  });
  console.log('\n===== B. Day1 全通 =====');
  console.log('   种入 =', JSON.stringify(seed));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);
  await page.evaluate(installCmp);

  const full = await page.evaluate(() => {
    try {
      const info = window.__day1Info();
      const pool = SHARE.pool().map((p) => p.id + ':' + p.w);
      SHARE.code = 'test1234';
      SHARE.theme = 'day1'; SHARE.FMT = 'square';
      const cv = SHARE.draw('square');
      return { info: info, pool: pool, tname: SHARE.TNAME.day1, cv: cv ? cv.width + 'x' + cv.height : null, text: SHARE.text() };
    } catch (e) { return { err: e.message }; }
  });
  console.log('   __day1Info() =', JSON.stringify(full.info));
  console.log('   pool()       =', JSON.stringify(full.pool));
  console.log('   TNAME.day1   =', JSON.stringify(full.tname));
  console.log('   draw(square) =', full.cv, full.err || '');
  console.log('   text()       =', JSON.stringify(full.text));

  /* ---------- D. 视觉同源：Day1 vs start，比非内容区 ---------- */
  const vm = await page.evaluate(() => {
    const regions = [
      { name: '顶部边饰+回纹 (y<100)',        x0: 0,   x1: 1080, y0: 0,   y1: 100 },
      { name: '四角角花 左上 (0..120²)',      x0: 0,   x1: 120,  y0: 0,   y1: 120 },
      { name: '页脚左侧 (x<430, y>836)',      x0: 0,   x1: 430,  y0: 836, y1: 1080 },
      { name: '页脚右侧印章 (x>820, y>840)',  x0: 820, x1: 1080, y0: 840, y1: 1080 },
    ];
    SHARE.code = 'test1234';
    SHARE.theme = 'day1';  SHARE.FMT = 'square';
    const c1 = SHARE.draw('square');
    SHARE.theme = 'start';
    const c2 = SHARE.draw('square');
    const a = c1.getContext('2d').getImageData(0, 0, c1.width, c1.height);
    const b = c2.getContext('2d').getImageData(0, 0, c2.width, c2.height);
    const r = window.__regionDiff(a, b, regions);
    /* 顺带：整卡差异，便于对照 */
    let all = 0;
    for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i+1] !== b.data[i+1] || a.data[i+2] !== b.data[i+2]) all++;
    return { regions: r, whole: all };
  });
  console.log('\n===== D. 视觉同源（Day1 卡 vs start 卡）=====');
  for (const r of vm.regions) {
    console.log('   %s  %s'.replace('%s', r.name.padEnd(34)).replace('%s', r.diff === 0 ? '0 差异 ✓' : (r.diff + ' / ' + r.total + ' ✗')));
  }
  console.log('   （整卡差异 %d px —— 内容区本就该不同）', vm.whole);

  /* ---------- C. 未全通 → 完全降级 ---------- */
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
    s.phrases = {};
    const ids = (window.SCENES || []).filter((x) => x && x.day1);
    if (ids[0]) s.phrases[ids[0].id] = (ids[0].phrases || []).map((_, k) => k);
    localStorage.setItem('sinoky_state', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);
  await page.evaluate(installCmp);

  const part = await page.evaluate(() => {
    const info = window.__day1Info();
    const pool = SHARE.pool().map((p) => p.id);
    SHARE.code = 'test1234';
    /* t= 参数必然不同（day1 vs start）⇒ 二维码必然不同，故比较时排除二维码区 */
    SHARE.theme = 'day1';  const c1 = SHARE.draw('square');
    SHARE.theme = 'start'; const c2 = SHARE.draw('square');
    const a = c1.getContext('2d').getImageData(0, 0, c1.width, c1.height);
    const b = c2.getContext('2d').getImageData(0, 0, c2.width, c2.height);
    /* 二维码底板：x 438..643、y 826..1031；诺诺：x 820..996、y 614..830 */
    const regions = [
      { name: '内容区 (y 100..600)',   x0: 0,   x1: 1080, y0: 100, y1: 600 },
      { name: '页脚左 (y>836,x<430)',  x0: 0,   x1: 430,  y0: 836, y1: 1080 },
      { name: '顶部 (y<100)',          x0: 0,   x1: 1080, y0: 0,   y1: 100 },
    ];
    return { info: info, pool: pool, diff: window.__regionDiff(a, b, regions) };
  });
  console.log('\n===== C. 未全通（只通第一段）→ 应完全降级为 start 卡 =====');
  console.log('   __day1Info() =', JSON.stringify(part.info));
  console.log('   pool()       =', JSON.stringify(part.pool));
  for (const r of part.diff) {
    console.log('   %s  %s'.replace('%s', r.name.padEnd(26)).replace('%s', r.diff === 0 ? '0 差异 ✓（降级正确）' : (r.diff + ' / ' + r.total + ' ✗')));
  }

  await browser.close();
  srv.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
