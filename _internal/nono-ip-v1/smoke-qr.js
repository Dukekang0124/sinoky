/* ============================================================================
   v0.23.6 —— 「分享卡二维码」浏览器真跑验收
   ----------------------------------------------------------------------------
   康哥铁律：语法校验 / grep / diff 只证明「看起来对」，不算验收。
   本脚本验证的是**画在画布上的像素**，不是「代码里有个二维码函数」：

     · 二维码真的被画出来（像素级），且画在**该在的位置**
     · 四个角上的 quiet zone 真的是浅色（底板圆角若切进 quiet zone 就会变深色）
     · 三个定位图案（finder pattern）结构完整 7×7 —— 这是圆角 18px 那个 bug
       直接破坏的东西，也是「看着完全正常但扫不出」的唯一机器判据
     · 时序图案（timing pattern）第 6 行/列交替，模块网格确实是一个合法 QR 矩阵
     · 模块像素是整数且 ≥4（不缩放），二维码完整落在 205px 版心内不被裁
     · 底板水平居中，且与左侧字标、右侧印章、右上诺诺**都不重叠**
     · 同一主题连画两次像素完全一致（无状态累积）
     · 12 个主题×版式组合全部成立
     · 零 JS 运行时错误、零横向溢出

   ⚠️ 归因码固定为 test1234：SHARE.code 每次随机 ⇒ 每轮二维码矩阵不同，
      而不同矩阵的解码难度并不相同 ⇒ 断言会漂移、结论不可复现。测试必须钉死它。

   ⚠️ 本脚本只保证「正确地画在画布上」。**能不能被真实扫码器扫出来**由
      _qr_card_decode.py 用独立实现（微信检测器）验证 —— 两者不可互相替代。

   跑法：NODE_PATH=... node smoke-qr.js
   ============================================================================ */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const PORT = 8106;   /* 与 smoke-recall(8103) / smoke-wave / smoke-tour 错开 */

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

/* 设计常量（与 patch.js §13 一致；改实现必须同步改这里，否则断言会红） */
const QR_SIZE = 205;      /* 版心边长 */
const QR_QUIET = 4;       /* quiet zone 模块数 */
const QR_TOP_FROM_H = 254;/* 版心顶边 = H - 254 */

const THEMES = ['start', 'line', 'streak', 'city', 'badge', 'report'];
const FMTS = ['square', 'story'];

main().catch((e) => { console.error('FATAL', e); process.exit(2); });

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

  /* ---- 变异钩子（mutation testing）：证明断言真的会咬 ----
     用法：QMUT='real, real, 12):::real, real, 18)' node smoke-qr.js
     在内存里把 index.html 改掉再喂给浏览器（不落盘），用来验证
     「把圆角改回 18px」这类变异会被哪几条断言抓住。
     ⚠️ route 后注册者优先 ⇒ 通用规则必须先生效、这条具体规则后注册。 */
  const QMUT = process.env.QMUT || '';
  if (QMUT) {
    const parts = QMUT.split(':::');
    const find = parts[0], repl = parts[1] === undefined ? '' : parts[1];
    await ctx.route(`http://127.0.0.1:${PORT}/index.html`, (route) => {
      const buf = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
      const hit = buf.split(find).length - 1;
      console.log(`  [QMUT] "${find}" → "${repl}"   命中 ${hit} 处`);
      route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8',
        body: buf.split(find).join(repl),
      });
    });
  }

  const R = [];
  const chk = (n, c, e) => R.push([c ? 'PASS' : 'FAIL', n, e === undefined ? '' : String(e)]);
  const errors = [];
  page.on('pageerror', (e) => errors.push('' + e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  /* 造「满配」数据，让 6 个主题都渲染出真实内容（空卡主题会 skip，少测 2/3 的组合） */
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
      return { scenes: n };
    } catch (e) { return { err: e.message }; }
  });
  console.log('  seed =', JSON.stringify(seed));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);   /* 等 nono-share.webp 就绪（§5 要 img.complete 才叠加诺诺） */

  /* 钉死「最后练的那一句」：line 卡的链接带 &l=场景:序号，而那读的是会被注入层改写的
     运行时状态 ⇒ 不钉死则每轮的链接长度/矩阵都不同，断言与结论不可复现。
     （与 _qr-shot.js 同一处理，两处必须一致。） */
  await page.evaluate(() => {
    var list = window.SCENES || [];
    var sc = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === 'arrival') { sc = list[i]; break; }
    if (!sc) sc = list[0];
    window.SHARE.lastLine = function () {
      return { sc: sc, i: 0, p: (sc && sc.phrases && sc.phrases[0]) || null };
    };
  });

  /* 把采样逻辑注入页面：只读像素，不改产品状态 */
  await page.addScriptTag({
    content: `
window.__qrSample = function (cv, W, H, link) {
  /* 用 §13 暴露的只读出口，在草稿画布上算「期望几何」——
     与实际卡片同宽同参数 ⇒ x/y/scale/n 应与真实绘制完全一致。 */
  var sc = document.createElement('canvas'); sc.width = W; sc.height = H;
  var sctx = sc.getContext('2d');
  var geo = window.__qrDrawInto(sctx, W, link, H - ${QR_TOP_FROM_H}, ${QR_SIZE});
  var ctx = cv.getContext('2d');
  var px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  var off = ${QR_QUIET} * geo.scale;
  function lumAt(sx, sy) {
    var i = (sy * cv.width + sx) * 4;
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }
  /* 取模块中心采样（避开边界抗锯齿） */
  function mod(r, c) {
    var sx = geo.x + off + c * geo.scale + (geo.scale >> 1);
    var sy = geo.y + off + r * geo.scale + (geo.scale >> 1);
    return lumAt(sx, sy);
  }
  var n = geo.n;
  var m = [];
  for (var r = 0; r < n; r++) { var row = []; for (var c = 0; c < n; c++) row.push(mod(r, c) < 110); m.push(row); }
  /* quiet zone **实测宽度**：从 QR 模块区边界向外量「连续浅色像素数」。
     比「取几个点看颜色」强得多 —— 它量的是静区的**宽度**而非某点的颜色：
     实测 QUIET=0（静区彻底去掉）时 zxing 从 36/36 掉到 0/36，而「取点」抓不到。 */
  var LIGHT = 150;
  function runOut(fx, fy, dx, dy, maxSteps) {
    var k = 0;
    for (var s = 1; s <= maxSteps; s++) {
      var nx = fx + dx * s, ny = fy + dy * s;
      if (nx < 0 || ny < 0 || nx >= cv.width || ny >= cv.height) break;
      if (lumAt(nx, ny) <= LIGHT) break;
      k++;
    }
    return k;
  }
  var qx = geo.x + off, qy = geo.y + off, qs = n * geo.scale;
  var midX = qx + Math.round(qs / 2), midY = qy + Math.round(qs / 2);
  var CAP_AXIS = 3 * geo.scale;              /* 轴方向要求 ≥3 模块（规范下限 4，留 1 模块容差） */
  var CAP_DIAG = 2 * geo.scale;              /* 对角方向要求 ≥2 模块：对圆角过大最敏感 */
  var runs = {
    up:    runOut(midX, qy, 0, -1, CAP_AXIS),
    down:  runOut(midX, qy + qs - 1, 0, 1, CAP_AXIS),
    left:  runOut(qx, midY, -1, 0, CAP_AXIS),
    right: runOut(qx + qs - 1, midY, 1, 0, CAP_AXIS)
  };
  var dRuns = {
    tl: runOut(qx, qy, -1, -1, CAP_DIAG),
    tr: runOut(qx + qs - 1, qy, 1, -1, CAP_DIAG),
    bl: runOut(qx, qy + qs - 1, -1, 1, CAP_DIAG),
    br: runOut(qx + qs - 1, qy + qs - 1, 1, 1, CAP_DIAG)
  };
  /* finder pattern 结构：外框 7×7 全深、内圈（偏移 1）全浅、中心 3×3 全深 */
  function finder(r0, c0) {
    var bad = [];
    for (var k = 0; k < 7; k++) {
      if (!m[r0][c0 + k]) bad.push('T' + k);
      if (!m[r0 + 6][c0 + k]) bad.push('B' + k);
      if (!m[r0 + k][c0]) bad.push('L' + k);
      if (!m[r0 + k][c0 + 6]) bad.push('R' + k);
    }
    for (var k2 = 1; k2 <= 5; k2++) {
      if (m[r0 + 1][c0 + k2]) bad.push('iT' + k2);
      if (m[r0 + 5][c0 + k2]) bad.push('iB' + k2);
      if (m[r0 + k2][c0 + 1]) bad.push('iL' + k2);
      if (m[r0 + k2][c0 + 5]) bad.push('iR' + k2);
    }
    for (var rr = 2; rr <= 4; rr++) for (var cc = 2; cc <= 4; cc++) if (!m[r0 + rr][c0 + cc]) bad.push('C' + rr + cc);
    return bad;
  }
  var f = {
    tl: finder(0, 0),
    tr: finder(0, n - 7),
    bl: finder(n - 7, 0)
  };
  /* timing pattern：第 6 行 / 第 6 列 从 8 到 n-9 交替（以深色起） */
  var timingBad = 0, timingCnt = 0;
  for (var t = 8; t <= n - 9; t++) {
    var want = ((t - 8) % 2 === 0);
    if (m[6][t] !== want) timingBad++;
    if (m[t][6] !== want) timingBad++;
    timingCnt += 2;
  }
  /* 深色占比 */
  var dark = 0;
  for (var r2 = 0; r2 < n; r2++) for (var c2 = 0; c2 < n; c2++) if (m[r2][c2]) dark++;
  return {
    geo: { x: geo.x, y: geo.y, scale: geo.scale, n: n, real: geo.real },
    runs: runs, dRuns: dRuns, capAxis: CAP_AXIS, capDiag: CAP_DIAG,
    finders: f,
    timingBad: timingBad, timingCnt: timingCnt,
    darkRatio: dark / (n * n)
  };
};
window.__qrPlateHash = function (cv, W, H, link) {
  var sc = document.createElement('canvas'); sc.width = W; sc.height = H;
  var geo = window.__qrDrawInto(sc.getContext('2d'), W, link, H - ${QR_TOP_FROM_H}, ${QR_SIZE});
  var px = cv.getContext('2d').getImageData(geo.x, geo.y, geo.real, geo.real).data;
  var h = 5381;
  for (var i = 0; i < px.length; i += 4) { h = ((h * 33) ^ px[i]) >>> 0; }
  return h;
};
`
  });

  /* ---------------- A. 注入层就位 ---------------- */
  const base = await page.evaluate(() => ({
    drawInto: typeof window.__qrDrawInto,
    share: typeof window.SHARE,
    draw: typeof (window.SHARE && window.SHARE.draw),
    link: typeof (window.SHARE && window.SHARE.link),
    nonoImg: !!(window.NONO_SHARE_IMG && window.NONO_SHARE_IMG.complete && window.NONO_SHARE_IMG.naturalWidth),
    src: (function () {
      try { return SHARE.draw.toString().indexOf('__') > -1 ? 'wrapped?' : 'plain'; } catch (e) { return 'ERR'; }
    })(),
  }));
  chk('注入层暴露 window.__qrDrawInto', base.drawInto === 'function', base.drawInto);
  chk('SHARE.draw / SHARE.link 均在', base.draw === 'function' && base.link === 'function',
      `${base.draw}/${base.link}`);
  chk('诺诺分享图已就绪（不重叠断言的语境前提）', base.nonoImg, String(base.nonoImg));

  /* ---------------- B. 逐主题×版式像素验收 ---------------- */
  const geom = await page.evaluate(() => {
    var img = window.NONO_SHARE_IMG;
    return { iw: img ? img.naturalWidth : 0, ih: img ? img.naturalHeight : 0 };
  });
  const ratio = geom.ih ? geom.iw / geom.ih : 0.8148;

  for (const fmt of FMTS) {
    for (const t of THEMES) {
      const r = await page.evaluate((arg) => {
        try {
          SHARE.theme = arg.t;
          SHARE.FMT = arg.f;
          SHARE.ctx = null;
          SHARE.code = 'test1234';      /* 固定归因码 ⇒ 矩阵可复现 */
          var link = SHARE.link();
          if (!link) return { e: 'EMPTY_LINK' };
          var cv = SHARE.draw(arg.f);
          if (!cv) return { e: 'NULL_CV' };
          var s = window.__qrSample(cv, cv.width, cv.height, link);
          s.hash1 = window.__qrPlateHash(cv, cv.width, cv.height, link);
          /* 连画两次：像素必须完全一致（无状态累积 / 不重影） */
          SHARE.ctx = null;
          var cv2 = SHARE.draw(arg.f);
          s.hash2 = window.__qrPlateHash(cv2, cv2.width, cv2.height, link);
          s.W = cv.width; s.H = cv.height; s.link = link;
          return s;
        } catch (e) { return { e: e.message }; }
      }, { t, f: fmt });

      const tag = `${t}/${fmt}`;
      if (!r || r.e) { chk(`[${tag}] 渲染成功`, false, r ? r.e : 'no result'); continue; }

      const g = r.geo;
      const nonoH = Math.round(r.H * 0.20);
      const nonoW = Math.round(nonoH * ratio);
      const nonoX = r.W - 84 - nonoW;
      const nonoY = r.H - 250 - nonoH;
      const plateL = g.x, plateR = g.x + g.real, plateT = g.y, plateB = g.y + g.real;
      const sealX = r.W - 84 - 92;

      /* --- 几何 --- */
      chk(`[${tag}] 模块像素为整数且 ≥4`, Number.isInteger(g.scale) && g.scale >= 4, `scale=${g.scale} n=${g.n}`);
      chk(`[${tag}] 二维码完整落在版心内（不被裁）`, g.real <= QR_SIZE, `real=${g.real} / ${QR_SIZE}`);
      chk(`[${tag}] 版心顶边 = H-254`, plateT === r.H - QR_TOP_FROM_H, `${plateT} vs ${r.H - QR_TOP_FROM_H}`);
      chk(`[${tag}] 底板水平居中（±2px）`, Math.abs((plateL + plateR) / 2 - r.W / 2) <= 2,
          `中心=${(plateL + plateR) / 2} 画布中心=${r.W / 2}`);
      chk(`[${tag}] 不越出画布下沿`, plateB < r.H - 10, `底=${plateB} H=${r.H}`);

      /* --- 不重叠 --- */
      chk(`[${tag}] 与左侧字标不重叠`, plateL > 320, `左=${plateL}`);
      chk(`[${tag}] 与右侧印章不重叠`, plateR < sealX, `右=${plateR} 印=${sealX}`);
      chk(`[${tag}] 与右上诺诺不重叠（≥20px 间隙）`, plateR < nonoX - 20,
          `右=${plateR} 诺诺左=${nonoX} (诺诺 ${nonoX}..${nonoX + nonoW} / y ${nonoY}..${nonoY + nonoH})`);

      /* --- 可扫性结构（这是圆角 bug 的直接判据） --- */
      chk(`[${tag}] 静区四边实测宽度 ≥3 模块`, [r.runs.up, r.runs.down, r.runs.left, r.runs.right].every((v) => v >= r.capAxis),
          `上${r.runs.up} 下${r.runs.down} 左${r.runs.left} 右${r.runs.right} / 需≥${r.capAxis}`);
      chk(`[${tag}] 静区四角实测宽度 ≥2 模块（圆角未啃进静区）`,
          [r.dRuns.tl, r.dRuns.tr, r.dRuns.bl, r.dRuns.br].every((v) => v >= r.capDiag),
          `tl${r.dRuns.tl} tr${r.dRuns.tr} bl${r.dRuns.bl} br${r.dRuns.br} / 需≥${r.capDiag}`);
      chk(`[${tag}] 左上定位图案结构完整`, r.finders.tl.length === 0, r.finders.tl.slice(0, 6).join(','));
      chk(`[${tag}] 右上定位图案结构完整`, r.finders.tr.length === 0, r.finders.tr.slice(0, 6).join(','));
      chk(`[${tag}] 左下定位图案结构完整`, r.finders.bl.length === 0, r.finders.bl.slice(0, 6).join(','));
      chk(`[${tag}] 时序图案交替正确`, r.timingBad === 0, `错 ${r.timingBad}/${r.timingCnt}`);
      chk(`[${tag}] 深色模块占比合理（0.30~0.62）`, r.darkRatio > 0.30 && r.darkRatio < 0.62,
          r.darkRatio.toFixed(3));

      /* --- 无状态累积 --- */
      chk(`[${tag}] 连画两次像素一致（不重影）`, r.hash1 === r.hash2, `${r.hash1} vs ${r.hash2}`);
    }
  }

  /* ---------------- Z. 收口 ---------------- */
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk('零横向溢出', overflow <= 0, `overflow=${overflow}`);
  chk('零 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();

  const pass = R.filter((r) => r[0] === 'PASS').length;
  const fail = R.filter((r) => r[0] === 'FAIL');
  console.log('\n=== 「分享卡二维码」浏览器真跑验收 ===');
  R.forEach((r) => console.log(`  ${r[0] === 'PASS' ? '✓' : '✗'} ${r[1]}${r[2] ? '   [' + r[2] + ']' : ''}`));
  console.log(`\n通过 ${pass} 项，失败 ${fail.length} 项`);
  if (fail.length) { console.log('\n失败明细：'); fail.forEach((r) => console.log(`  ✗ ${r[1]}   [${r[2]}]`)); }
  process.exit(fail.length ? 1 : 0);
}
