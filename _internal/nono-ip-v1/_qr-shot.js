/* ============================================================================
   导出当前分享卡（改造前基线）—— 为「分享卡加二维码」定位置用
   目的：不靠推算，直接看图找留白（诺诺占右下 614~830，页脚占 H-228 以下）
   跑法：NODE_PATH=... node _qr-shot.js
   ============================================================================ */
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const OUT = APP + '/_internal/nono-ip-v1/' + (process.argv[2] || '_qr_before');
const PORT = 8105;

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

  /* ---- 变异钩子（与 smoke-qr.js 同款）：在内存里改 index.html 再喂给浏览器 ----
     用法：QMUT='A:::B'                       一组替换
           QMUT='A:::B;;;C:::D'               多组替换（;;; 分隔）
     例：  QMUT='cv.height - 254, 205:::cv.height - 254, 176;;;real, real, 12):::real, real, 18)'
           node _qr-shot.js _qr_mut_s4r18
     用来验证「某个变异是否真的破坏了可扫性」—— 由 _qr_card_decode.py 独立判读。 */
  const QMUT = process.env.QMUT || '';
  if (QMUT) {
    const pairs = QMUT.split(';;;').map((s) => {
      const p = s.split(':::');
      return [p[0], p[1] === undefined ? '' : p[1]];
    });
    await ctx.route(`http://127.0.0.1:${PORT}/index.html`, (route) => {
      let buf = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
      for (const [find, repl] of pairs) {
        const hit = buf.split(find).length - 1;
        console.log(`  [QMUT] "${find}" → "${repl}"   命中 ${hit} 处`);
        buf = buf.split(find).join(repl);
      }
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: buf });
    });
  }

  page.on('pageerror', (e) => console.log('PAGEERR', e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  /* 造「满配」数据，让 6 个主题都能渲染出真实内容（否则会 skip 掉空卡主题） */
  const seed = await page.evaluate(() => {
    try {
      const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
      s.onboarded = true;
      s.streak = 7;
      s.phrases = {};
      const n = Math.min(3, (typeof SCENES !== 'undefined' ? SCENES.length : 0));
      for (let i = 0; i < n; i++) {
        const sc = SCENES[i];
        if (sc && sc.phrases) s.phrases[sc.id] = sc.phrases.map((_, k) => k);
      }
      s.days = [];
      const d = new Date();
      for (let i = 0; i < 12; i++) s.days.push(new Date(d.getTime() - i * 864e5).toISOString().slice(0, 10));
      localStorage.setItem('sinoky_state', JSON.stringify(s));
      localStorage.setItem('sinoky_badges_on', JSON.stringify({ 'first-speak': 1, 'streak7': 1 }));
      return { scenes: n, ids: Object.keys(s.phrases) };
    } catch (e) { return { err: e.message }; }
  });
  console.log('seed =', JSON.stringify(seed));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);   /* 等诺诺 nono-share.webp 加载完（§5 的包装要 img.complete） */

  /* ---- 钉死「最后练的那一句」：让 line 卡可复现 ----
     SHARE.link() 对 line 主题要读 SHARE.lastLine()，那是**运行时状态**，会被注入层
     （§11 记得你 / §12 招手邀请）在 boot 时改写 ⇒ 同一份代码两次导出会得到不同的
     line 卡（链接有时带 &l= 有时不带、标题句也不同，连锁导致二维码矩阵不同）。
     这是**脚手架的不确定性，不是产品缺陷** —— 不钉死就无法做「改动前后」的像素比对。
     钉死成 arrival#0 后：line 卡稳定带 &l=，与其余 5 个主题的「不带 &l=」一起，
     两种链接形态都在同一轮里被覆盖。 */
  await page.evaluate(() => {
    var list = window.SCENES || [];
    var sc = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === 'arrival') { sc = list[i]; break; }
    if (!sc) sc = list[0];
    window.SHARE.lastLine = function () {
      return { sc: sc, i: 0, p: (sc && sc.phrases && sc.phrases[0]) || null };
    };
  });

  const info = await page.evaluate(() => {
    try {
      return {
        share: typeof SHARE,
        img: !!(window.NONO_SHARE_IMG && window.NONO_SHARE_IMG.complete && window.NONO_SHARE_IMG.naturalWidth),
        iw: window.NONO_SHARE_IMG ? window.NONO_SHARE_IMG.naturalWidth : 0,
        ih: window.NONO_SHARE_IMG ? window.NONO_SHARE_IMG.naturalHeight : 0,
      };
    } catch (e) { return { err: e.message }; }
  });
  console.log('env =', JSON.stringify(info));

  fs.mkdirSync(OUT, { recursive: true });
  const themes = ['start', 'line', 'streak', 'city', 'badge', 'report'];
  const links = {};
  /* 方图与竖版都导：竖版 H=1920，二维码锚定 H-254 ⇒ 位置规则必须同样成立 */
  for (const fmt of ['square', 'story']) {
    for (const t of themes) {
      const r = await page.evaluate((arg) => {
        try {
          SHARE.theme = arg.t;
          SHARE.FMT = arg.f;
          SHARE.ctx = null;
          /* 固定归因码：让每次生成的二维码**矩阵完全一致** ⇒ 解码验收可复现。
             （随机码会让每次的图案不同，而不同图案的解码难度并不相同 ——
              第一轮测出「原图全过」、第二轮「原图有失败」，就是这个原因。） */
          SHARE.code = 'test1234';
          const cv = SHARE.draw(arg.f);
          if (!cv) return { e: 'NULL' };
          return { d: cv.toDataURL('image/png'), link: SHARE.link(), w: cv.width, h: cv.height };
        } catch (e) { return { e: e.message }; }
      }, { t: t, f: fmt });
      if (!r || !r.d) { console.log('skip', t, fmt, JSON.stringify(r).slice(0, 80)); continue; }
      const key = t + '_' + fmt;
      fs.writeFileSync(path.join(OUT, 'card_' + key + '.png'), Buffer.from(r.d.split(',')[1], 'base64'));
      links[key] = r.link;
      console.log('wrote card_' + key + '.png  ' + r.w + 'x' + r.h + '  link=' + r.link);
    }
  }
  fs.writeFileSync(path.join(OUT, 'links.json'), JSON.stringify(links, null, 2));

  await browser.close();
  srv.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
