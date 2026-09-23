/**
 * probe_splash_seam.js —— 开屏换底后的「letterbox 接缝」真机验收。
 *
 * 为什么必须真机跑：#splash 用 object-fit:contain ⇒ 非 9:16 屏会露出 #splash 自己的底色
 *   （竖屏上下露条、桌面宽屏左右各露很大一条）。接缝可不可见，取决于
 *   「图的四边色 == #splash 计算出的底色」——这是纯 CSS + 素材的联合结果，静态看看不出来。
 *   本探针同时给「数值判据」（页内 canvas 取图边像素 vs 计算底色，算逐通道 Δ）
 *   与「目视留证」（四档视口截图），数值不达标直接判失败。
 *
 * 两种模式：
 *   默认            —— 扫候选目录 _internal/fix-2026-09-23/splash/splash-v*.webp，
 *                      在**复刻页**上跑（逐字抄 index.html 的 #splash 样式）。用于候选比稿期。
 *   --live          —— 在**真 index.html** 上跑，测**产品树真图** assets/splash/a8_9x16.webp，
 *                      底色取 getComputedStyle(#splash).backgroundColor（即 var(--bg) 解析后的真值）。
 *                      落地后必须跑这个：验证的是真实工程，而不是我抄出来的复刻页。
 *                      做法：加载后移除 .hide + 冻结 opacity（index.html 有 420ms 自动淡出，
 *                      不冻结则量不到 splash）。
 *
 * 跑法：NODE_PATH=<managed node_modules> node _internal/tools/probe_splash_seam.js [--live]
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SPL = path.join(ROOT, '_internal', 'fix-2026-09-23', 'splash');
const PORT = 8145;
const BG = '#141a24';            // 候选模式用的期望底色（= index.html :root 的 --bg）
const LIVE = process.argv.includes('--live');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

function serve(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

/** 复刻 index.html 里 #splash 的原样样式（逐字抄，别改） */
function pageFor(imgUrl, bg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;height:100%;background:${bg}}
#splash{position:fixed;inset:0;z-index:9999;background:${bg};display:flex;align-items:center;justify-content:center;flex-direction:column;gap:0;transition:opacity .45s ease}
#splash img{width:auto;height:100%;max-width:100%;object-fit:contain;border-radius:0}
</style></head><body>
<div id="splash"><img src="${imgUrl}" alt="Sinoky"></div>
</body></html>`;
}

/** 页内测量：图边像素 vs 底色（真模式取计算值，候选模式取传入的 hex）
 *  ⚠️ 必须是**真函数**而不是字符串常量：字符串会被当表达式求值，得到函数对象后
 *     序列化回来是 undefined（踩过：TypeError: Cannot read properties of undefined
 *     (reading 'delta')）。 */
function measure(bgHex) {
  const sp = document.getElementById('splash');
  const img = sp.querySelector('img');
  return img.decode().catch(() => {}).then(() => {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width, H = cv.height;
    const at = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const edges = {
      top: at(W >> 1, 0), bottom: at(W >> 1, H - 1),
      left: at(0, H >> 1), right: at(W - 1, H >> 1),
    };
    const ib = img.getBoundingClientRect();
    const sb = sp.getBoundingClientRect();
    /* 🔴 别用「元素盒 vs #splash 的间隙」当露底带 —— img 是 height:100% + object-fit:contain，
       **元素盒恒为满高**（手机档 430×932），间隙恒为 0，看着像「无露底色」实则不是。
       真正会露出底色的是 contain 的**内部留白**：内容按 min(bw/iw, bh/ih) 缩放后居中，
       其余区域透出 #splash 的 background。这里把两者分开算清楚。 */
    const scale = Math.min(ib.width / W, ib.height / H);
    const cw = W * scale, ch = H * scale;
    const pad = {
      top: +((ib.height - ch) / 2).toFixed(1), bottom: +((ib.height - ch) / 2).toFixed(1),
      left: +((ib.width - cw) / 2).toFixed(1), right: +((ib.width - cw) / 2).toFixed(1),
    };
    const boxGap = {
      top: +(ib.top - sb.top).toFixed(1), bottom: +(sb.bottom - ib.bottom).toFixed(1),
      left: +(ib.left - sb.left).toFixed(1), right: +(sb.right - ib.right).toFixed(1),
    };
    let bg, bgSrc;
    if (bgHex) {
      const hx = bgHex.replace('#', '');
      bg = [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16)];
      bgSrc = 'hex';
    } else {
      const m = getComputedStyle(sp).backgroundColor.match(/(\d+)[^\d]+(\d+)[^\d]+(\d+)/);
      bg = [+m[1], +m[2], +m[3]]; bgSrc = 'computed';
    }
    const delta = {};
    for (const k of Object.keys(edges)) delta[k] = Math.max(...edges[k].map((v, i) => Math.abs(v - bg[i])));
    return { nat: [W, H], edges, bg, bgSrc, delta, pad, boxGap,
      imgBox: [Math.round(ib.width), Math.round(ib.height)],
      imgSrc: img.getAttribute('src') };
  });
}

(async () => {
  let jobs, expectBg;
  if (LIVE) {
    jobs = [{ tag: 'LIVE', url: '/index.html', page: null }];   // page=null ⇒ 用真 index.html
    expectBg = null;                                            // ⇒ 底色取计算值
  } else {
    jobs = [];
    const cands = fs.readdirSync(SPL).filter(f => /^splash-v\d.*\.webp$/.test(f)).sort();
    if (!cands.length) { console.error('没有候选 webp，先跑 splash_rebuild.py --build all'); process.exit(2); }
    const tagOf = (f) => f.replace(/^splash-/, '').replace(/\.webp$/, '');
    for (const f of cands) {
      const tag = tagOf(f);
      // 候选名 → 统一 tag（写页与请求页必须同一个函数，否则会 404 到空页）
      fs.writeFileSync(path.join(SPL, '_seam_' + tag + '.html'),
        pageFor('/_internal/fix-2026-09-23/splash/' + f, BG), 'utf8');
      jobs.push({ tag, url: '/_internal/fix-2026-09-23/splash/_seam_' + tag + '.html', page: 'clone' });
    }
    expectBg = BG;
  }

  const server = http.createServer(serve);
  await new Promise(r => server.listen(PORT, r));

  const VPS = [
    { w: 430, h: 932, n: 'iPhone14ProMax' },
    { w: 390, h: 844, n: 'iPhone14' },
    { w: 360, h: 740, n: 'Android360' },
    { w: 1280, h: 800, n: 'Desktop1280' },
  ];

  let fails = 0;
  for (const job of jobs) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const vp of VPS) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      if (job.page === null) {
        /* 🔴 真 index.html 的开屏有完整生命周期：420ms 淡出 → 再过 520ms
           **真的 removeChild 掉**（见 index.html 的 dismiss()）。900ms 后量不到元素。
           所以在页面脚本执行前注入拦截，把 #splash 焊在 DOM 里。 */
        await page.addInitScript(() => {
          const rc = Node.prototype.removeChild;
          Node.prototype.removeChild = function (c) {
            if (c && c.id === 'splash') return c;
            return rc.apply(this, arguments);
          };
          const rm = Element.prototype.remove;
          Element.prototype.remove = function () {
            if (this.id === 'splash') return;
            return rm.apply(this, arguments);
          };
        });
      }
      await page.goto('http://127.0.0.1:' + PORT + job.url, { waitUntil: 'load' });
      if (job.page === null) {
        await page.waitForTimeout(1400);
        await page.evaluate(() => {
          const sp = document.getElementById('splash');
          sp.classList.remove('hide');
          sp.style.transition = 'none';
          sp.style.opacity = '1';
          sp.style.pointerEvents = 'none';
        });
        await page.waitForTimeout(250);
      } else {
        await page.waitForTimeout(350);
      }

      const r = await page.evaluate(measure, expectBg);
      const worst = Math.max(...Object.values(r.delta));
      const padTxt = 'T' + r.pad.top + ' B' + r.pad.bottom + ' L' + r.pad.left + ' R' + r.pad.right;
      const gapTxt = 'T' + r.boxGap.top + ' B' + r.boxGap.bottom + ' L' + r.boxGap.left + ' R' + r.boxGap.right;
      const hasPad = Object.values(r.pad).some(v => v > 0.5);
      const pass = worst <= 2;
      if (!pass) fails++;
      // ⚠️ Node 的 console.log 只认 %s/%d/%i/%f/%j/%o/%O/%c —— 没有 %-14s 这种
      //    宽度/对齐修饰符（写了会原样打印出来）。要对齐只能自己 padEnd。
      console.log((pass ? '✅ ' : '❌ ') + job.tag.padEnd(12) + vp.n.padEnd(16) +
        '图 ' + r.nat.join('x') + '  盒 ' + r.imgBox.join('x') +
        '  底色(' + r.bgSrc + ')rgb(' + r.bg.join(',') + ')' +
        '\n     contain 内部留白[' + padTxt + ']' + (hasPad ? ' ← 真正露底色处' : '') +
        '  盒间隙[' + gapTxt + ']' +
        '\n     图边Δ ' + JSON.stringify(r.delta) + (worst <= 2 ? '  ⇒ 与底色无缝' : '  ⇒ ❌ 有可见接缝') +
        (job.page === null ? '  src=' + r.imgSrc : ''));

      await page.screenshot({ path: path.join(SPL, (LIVE ? 'live' : 'seam') + '-' + vp.n + '-' + job.tag + '.png') });
      await page.close();
    }
    await browser.close();
  }
  server.close();
  console.log('\n结论：图边逐通道Δ ≤ 2 即接缝不可见。模式=%s  FAIL=%d', LIVE ? 'LIVE(真 index.html + 产品树真图)' : '候选比稿', fails);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
