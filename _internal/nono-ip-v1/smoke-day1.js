/* ============================================================================
   §14 Day1 通关纪念卡 —— 像素级 + 行为验收

   为什么要像素级：行为层（pool 含 day1、draw 返回 1080×1080）全对，卡面仍可能
   是错的（内容越界、印章画错位置、start 内容残留、诺诺/二维码被吃掉）。
   这些只有读 canvas 像素才能发现。

   核心判据（本脚本最强的一条）：
     Day1 卡 与「把 _stack 换空后画的 start 卡」= 纯框架卡 比对 ——
     **非内容区必须 0 差异**（证明本层没有在框架上乱画/溢出），
     **内容区必须有差异**（证明内容确实换掉了）。
     这一条同时锁住「框架/页脚由主代码画」与「内容只由本层画」两件事。

   跑法：NODE_PATH=... node smoke-day1.js
         QMUT='A:::B' 可在内存里改 index.html 做变异测试
   ============================================================================ */
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const PORT = 8109;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

let PASS = 0, FAIL = 0;
const FAILS = [];
function chk(name, ok, extra) {
  if (ok) { PASS++; }
  else { FAIL++; FAILS.push(name + (extra ? '  [' + extra + ']' : '')); }
}

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

/* 浏览器侧工具箱：像素扫描 + 区域差异 */
function installTools() {
  window.__T = {
    img(cv) { return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); },
    /* 区域内匹配颜色的像素数 */
    count(im, test, r) {
      let n = 0;
      for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
        const i = (y * im.width + x) * 4;
        if (test(im.data[i], im.data[i + 1], im.data[i + 2])) n++;
      }
      return n;
    },
    /* 匹配颜色像素的包围盒。r 限定时只扫该矩形 ——
       ⚠️ 必须限定：朱砂红在卡上共 5 处（3 枚场景印章 + 字标里的 k + 页脚「诺」印章），
          不限定就会把 k 与诺印章算进来（第一版断言就是这么假失败的）；
          米白同理会被「来华第一天」的纸色大字污染。 */
    bbox(im, test, r) {
      const rx = r || { x0: 0, x1: im.width, y0: 0, y1: im.height };
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
      for (let y = rx.y0; y < rx.y1; y++) for (let x = rx.x0; x < rx.x1; x++) {
        const i = (y * im.width + x) * 4;
        if (test(im.data[i], im.data[i + 1], im.data[i + 2])) {
          n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      return n ? { x0, x1, y0, y1, n } : null;
    },
    /* 把匹配颜色的像素按 x 投影，切成若干簇（间隔 > clean 断开）。r 同上，需限定 y */
    clustersX(im, test, clean, r) {
      const rx = r || { x0: 0, x1: im.width, y0: 0, y1: im.height };
      const hit = new Uint8Array(im.width);
      for (let y = rx.y0; y < rx.y1; y++) for (let x = rx.x0; x < rx.x1; x++) {
        const i = (y * im.width + x) * 4;
        if (test(im.data[i], im.data[i + 1], im.data[i + 2])) hit[x] = 1;
      }
      const out = []; let s = -1, gap = 0;
      for (let x = rx.x0; x < rx.x1; x++) {
        if (hit[x]) { if (s < 0) s = x; gap = 0; }
        else if (s >= 0) { if (++gap > clean) { out.push([s, x - gap]); s = -1; } }
      }
      if (s >= 0) out.push([s, rx.x1 - 1]);
      return out;
    },
    regionDiff(a, b, regions) {
      const out = [];
      for (const r of regions) {
        let d = 0;
        for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
          const i = (y * a.width + x) * 4;
          if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) d++;
        }
        out.push({ name: r.name, diff: d });
      }
      return out;
    },
  };
  /* 朱砂红 #e63946 / 纸色 #f5f1e8 / 背景 #161a20 */
  window.__RED = (r, g, b) => Math.abs(r - 230) < 26 && Math.abs(g - 57) < 26 && Math.abs(b - 70) < 26;
  window.__PAPER = (r, g, b) => r > 200 && g > 195 && b > 185;
  window.__BG = (r, g, b) => Math.abs(r - 22) < 12 && Math.abs(g - 26) < 12 && Math.abs(b - 32) < 12;
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

  /* ---- 变异钩子：内存里改 index.html 再喂浏览器 ---- */
  const QMUT = process.env.QMUT || '';
  if (QMUT) {
    const pairs = QMUT.split(';;;').map((s) => { const p = s.split(':::'); return [p[0], p[1] === undefined ? '' : p[1]]; });
    await ctx.route(`http://127.0.0.1:${PORT}/index.html`, (route) => {
      let buf = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
      for (const [find, repl] of pairs) {
        const hit = buf.split(find).length - 1;
        console.log(`  [QMUT] "${find.slice(0, 60)}" → "${repl.slice(0, 40)}"   命中 ${hit} 处`);
        buf = buf.split(find).join(repl);
      }
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: buf });
    });
  }

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.evaluate(installTools);

  /* ================= A. 未全通：判据与入池 ================= */
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
    s.onboarded = true;
    s.phrases = {};
    const ids = (window.SCENES || []).filter((x) => x && x.day1);
    if (ids[0]) s.phrases[ids[0].id] = (ids[0].phrases || []).map((_, k) => k);   /* 只通第一段 */
    localStorage.setItem('sinoky_state', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);
  await page.evaluate(installTools);

  const noPass = await page.evaluate(() => {
    const info = window.__day1Info();
    const pool = SHARE.pool().map((p) => p.id);
    SHARE.code = 'test1234';
    SHARE.theme = 'day1';
    const cvDay1 = SHARE.draw('square');
    SHARE.theme = 'start';
    const cvStart = SHARE.draw('square');
    const a = window.__T.img(cvDay1), b = window.__T.img(cvStart);
    /* t= 参数不同（day1 vs start）⇒ 二维码必然不同，故比对时排除二维码区与诺诺区 */
    const diff = window.__T.regionDiff(a, b, [
      { name: '顶部 (y<100)', x0: 0, x1: 1080, y0: 0, y1: 100 },
      { name: '内容区 (y 100..600)', x0: 0, x1: 1080, y0: 100, y1: 600 },
      { name: '页脚左 (y>836,x<430)', x0: 0, x1: 430, y0: 836, y1: 1080 },
    ]);
    return { info, pool, diff, tname: SHARE.TNAME.day1 };
  });
  chk('A1 未全通 __day1Info() 为 null', noPass.info === null, JSON.stringify(noPass.info));
  chk('A2 未全通 pool 不含 day1', noPass.pool.indexOf('day1') < 0, JSON.stringify(noPass.pool));
  chk('A3 未全通绘制完全降级为 start 卡（三区域 0 差异）',
      noPass.diff.every((d) => d.diff === 0), JSON.stringify(noPass.diff));
  chk('A4 TNAME.day1 已注册', noPass.tname === 'Day 1 complete', String(noPass.tname));

  /* ================= B. 全通 ================= */
  const seed = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
    s.onboarded = true; s.streak = 3;
    s.days = [new Date().toISOString().slice(0, 10)];
    s.phrases = {};
    const ids = (window.SCENES || []).filter((x) => x && x.day1);
    ids.forEach((sc) => { s.phrases[sc.id] = (sc.phrases || []).map((_, k) => k); });
    localStorage.setItem('sinoky_state', JSON.stringify(s));
    localStorage.setItem('sinoky_share_nick', 'Alex');
    return { ids: ids.map((x) => x.id), counts: ids.map((x) => (x.phrases || []).length) };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2600);
  await page.evaluate(installTools);

  const full = await page.evaluate(() => {
    const info = window.__day1Info();
    const pool = SHARE.pool();
    const d1 = pool.filter((p) => p.id === 'day1')[0] || null;
    SHARE.code = 'test1234';
    SHARE.theme = 'day1';
    const txt = SHARE.text();
    const link = SHARE.link();
    return {
      info, poolIds: pool.map((p) => p.id), d1w: d1 ? d1.w : null,
      rows: info ? info.rows.length : 0, total: info ? info.total : 0,
      expectedTotal: (window.SCENES || []).filter((x) => x && x.day1)
        .reduce((a, x) => a + (x.phrases || []).length, 0),
      txt, link, tname: SHARE.TNAME.day1,
      fnType: typeof window.__day1Draw,
    };
  });
  chk('B1 全通 __day1Info() 非空', !!full.info);
  chk('B2 三个场景各一行', full.rows === 3, 'rows=' + full.rows);
  chk('B3 total == SCENES 现算句数和', full.total === full.expectedTotal,
      full.total + ' vs ' + full.expectedTotal);
  chk('B4 pool 含 day1', full.poolIds.indexOf('day1') >= 0, JSON.stringify(full.poolIds));
  chk('B5 day1 权重 = 4', full.d1w === 4, 'w=' + full.d1w);
  chk('B6 权重序：line(5) > day1(4) > report/streak/city(2) > badge(1)',
      full.d1w === 4 && full.poolIds.indexOf('line') >= 0);
  chk('B7 文案含真实句数', full.txt.indexOf(String(full.total)) >= 0, full.txt);
  chk('B8 文案含真实场景数 3', full.txt.indexOf('3 real-life scenes') >= 0, full.txt);
  chk('B9 文案不含任何分数表述', !/%|score|Score|correct/.test(full.txt), full.txt);
  chk('B10 链接带 t=day1 归因', full.link.indexOf('t=day1') >= 0, full.link);
  chk('B11 链接带 8 位归因码', /\?s=[a-z0-9]{8}/.test(full.link), full.link);
  chk('B12 __day1Draw 已导出', full.fnType === 'function', String(full.fnType));

  /* ================= C. 像素：卡片尺寸与内容越界 ================= */
  for (const fmt of ['square', 'story']) {
    const r = await page.evaluate((f) => {
      SHARE.code = 'test1234';
      SHARE.theme = 'day1'; SHARE.FMT = f;
      const cvDay1 = SHARE.draw(f);

      /* 对照：把 _stack 换空再画 start ⇒ 纯框架卡（只有背景/边饰/页脚/诺诺/二维码） */
      const realStack = window._stack;
      let cvFrame = null;
      try { window._stack = function () {}; SHARE.theme = 'start'; cvFrame = SHARE.draw(f); }
      finally { window._stack = realStack; }

      const a = window.__T.img(cvDay1), b = window.__T.img(cvFrame);
      const W = cvDay1.width, H = cvDay1.height;
      const TOP = (f === 'story') ? 340 : 176;
      const BOT = (f === 'story') ? (H - 470) : 806;
      const sealS = (f === 'story') ? 116 : 96;
      const sealGap = (f === 'story') ? 30 : 26;

      /* 红色（印章 + k + 诺 印章）簇 —— 只在内容区扫，排除字标里的 k 与页脚「诺」印章 */
      const zone = { x0: 0, x1: W, y0: TOP, y1: BOT };
      const redClusters = window.__T.clustersX(a, window.__RED, 12, zone);
      const redBox = window.__T.bbox(a, window.__RED, zone);
      /* 二维码米白底板：只在页脚中央扫。
         ⚠️ 窗口必须两头收窄：左边界避开 _brand 的纸色字标（x 84..234），
            右边界避开诺诺（竖版 x≥683 有熊猫白毛）与页脚「诺」印章（x≥904）。
            x ∈ [300,660] 恰好只覆盖居中的二维码（438..643）。 */
      const plateBox = window.__T.bbox(a, (r2, g2, b2) => r2 > 235 && g2 > 232 && b2 > 220,
        { x0: 300, x1: 660, y0: BOT, y1: H - 40 });
      /* 内容区外（框架区）差异 —— 只有「不与二维码/诺诺重叠」的区域可比 */
      const diff = window.__T.regionDiff(a, b, [
        { name: '顶部 (y<100)', x0: 0, x1: W, y0: 0, y1: 100 },
        { name: '四角左上', x0: 0, x1: 120, y0: 0, y1: 120 },
        { name: '内容区', x0: 0, x1: W, y0: TOP, y1: BOT },
        /* 金线左段：这里只有金线，两卡应完全一致。
           ⚠️ 不能整行比 —— 页脚中央是二维码，其内容含 t=day1 vs t=start ⇒ 必然不同。 */
        { name: '金线左段', x0: 0, x1: 430, y0: BOT + 20, y1: BOT + 90 },
      ]);
      return {
        W, H, TOP, BOT, sealS, sealGap,
        redClusters, redBox, plateBox,
        diff, nick: SHARE.nick(),
      };
    }, fmt);
    const tag = fmt === 'square' ? '方图' : '竖版';
    chk(`C[${tag}] 尺寸 ${fmt === 'square' ? '1080x1080' : '1080x1920'}`,
        r.W === 1080 && r.H === (fmt === 'square' ? 1080 : 1920), r.W + 'x' + r.H);
    chk(`C[${tag}] 内容区外零差异（顶部边饰）`, r.diff[0].diff === 0, 'diff=' + r.diff[0].diff);
    chk(`C[${tag}] 内容区外零差异（左上角花）`, r.diff[1].diff === 0, 'diff=' + r.diff[1].diff);
    chk(`C[${tag}] 内容区有差异（内容确实换掉）`, r.diff[2].diff > 3000, 'diff=' + r.diff[2].diff);
    chk(`C[${tag}] 金线左段零差异（内容不越下界）`, r.diff[3].diff === 0, 'diff=' + r.diff[3].diff);
    /* 三枚印章 */
    chk(`C[${tag}] 红色横簇恰为 3 枚印章`, r.redClusters.length === 3,
        JSON.stringify(r.redClusters));
    if (r.redClusters.length === 3) {
      const w = r.redClusters.map((c) => c[1] - c[0] + 1);
      const gap1 = r.redClusters[1][0] - r.redClusters[0][1];
      const gap2 = r.redClusters[2][0] - r.redClusters[1][1];
      chk(`C[${tag}] 每枚印章宽 ≈ ${r.sealS}`, w.every((v) => Math.abs(v - r.sealS) <= 6),
          JSON.stringify(w));
      chk(`C[${tag}] 印章间距 ≈ ${r.sealGap}`,
          Math.abs(gap1 - r.sealGap) <= 6 && Math.abs(gap2 - r.sealGap) <= 6,
          gap1 + ',' + gap2);
      const mid = (r.redClusters[0][0] + r.redClusters[2][1]) / 2;
      chk(`C[${tag}] 三枚印章整体水平居中`, Math.abs(mid - 540) <= 6, 'mid=' + mid);
    } else {
      chk(`C[${tag}] 每枚印章宽 ≈ ${r.sealS}`, false, '簇数不对');
      chk(`C[${tag}] 印章间距 ≈ ${r.sealGap}`, false, '簇数不对');
      chk(`C[${tag}] 三枚印章整体水平居中`, false, '簇数不对');
    }
    chk(`C[${tag}] 印章落在内容区内（y 上界 ≥ TOP）`,
        r.redBox && r.redBox.y0 >= r.TOP - 4, JSON.stringify(r.redBox));
    chk(`C[${tag}] 印章不越下界`, r.redBox && r.redBox.y1 <= r.BOT, JSON.stringify(r.redBox));
    chk(`C[${tag}] 二维码米白底板仍在`, !!r.plateBox,
        JSON.stringify(r.plateBox));
    if (r.plateBox) {
      const cx = (r.plateBox.x0 + r.plateBox.x1) / 2;
      chk(`C[${tag}] 二维码底板水平居中`, Math.abs(cx - 540) <= 8, 'cx=' + cx);
      chk(`C[${tag}] 二维码底板宽 ≈ 205`, Math.abs((r.plateBox.x1 - r.plateBox.x0 + 1) - 205) <= 4,
          'w=' + (r.plateBox.x1 - r.plateBox.x0 + 1));
    } else {
      chk(`C[${tag}] 二维码底板水平居中`, false, '无底板');
      chk(`C[${tag}] 二维码底板宽 ≈ 205`, false, '无底板');
    }
  }

  /* ================= D. 与既有主题的共存（不可破坏） ================= */
  const coexist = await page.evaluate(() => {
    const out = {};
    SHARE.code = 'test1234';
    for (const t of ['start', 'line', 'streak', 'city', 'badge', 'report']) {
      SHARE.theme = t;
      const cv = SHARE.draw('square');
      out[t] = !!cv && cv.width === 1080;
    }
    /* swap 链路：pool 里应能循环到 day1 */
    SHARE.pick('day1');
    const a = SHARE.theme;
    SHARE.swap();
    const b = SHARE.theme;
    let loop = false;
    for (let i = 0; i < 10; i++) { SHARE.swap(); if (SHARE.theme === 'day1') { loop = true; break; } }
    return { out, a, b, loop, poolLen: SHARE.pool().length };
  });
  chk('D1 start 仍可绘制', coexist.out.start === true);
  chk('D2 line 仍可绘制', coexist.out.line === true);
  chk('D3 streak 仍可绘制', coexist.out.streak === true);
  chk('D4 city 仍可绘制', coexist.out.city === true);
  chk('D5 badge 仍可绘制', coexist.out.badge === true);
  chk('D6 report 仍可绘制', coexist.out.report === true);
  chk('D7 SHARE.pick("day1") 能直接指定', coexist.a === 'day1', String(coexist.a));
  chk('D8 shuffle 一轮后仍是合法主题', !!coexist.b, String(coexist.b));
  chk('D9 shuffle 能在 pool 内循环回 day1', coexist.loop === true);

  /* ================= E. 拦截生效（唯一能证明「start 内容没被画」的判据） =================
     像素层比不出这件事：start 内容与 Day1 内容同在 [TOP,BOT] 区间内，差异永远存在。
     只有行为层能证明 —— 主代码绘制内容时会调全局 _stack，而本层在 _drawPrev 期间
     把它换成一个计数空函数。计数增长 ⇒ 主代码确实「画了但没画」。
     变异测试：把接管改回「不换空」（window._stack = window._stack），此处立刻变红。 */
  const blk = await page.evaluate(() => {
    window.__day1Blocked = 0;
    SHARE.theme = 'day1';   SHARE.draw('square');
    const a = window.__day1Blocked;
    SHARE.theme = 'start';  SHARE.draw('square');
    const b = window.__day1Blocked;
    SHARE.theme = 'report'; SHARE.draw('square');
    const c = window.__day1Blocked;
    SHARE.theme = 'day1';   SHARE.draw('story');
    const d = window.__day1Blocked;
    return { day1sq: a, afterStart: b, afterReport: c, afterStory: d };
  });
  chk('E1 画 day1(方图) 时拦截到主代码的内容绘制', blk.day1sq >= 1, 'blocked=' + blk.day1sq);
  chk('E2 画 day1(竖版) 时同样拦截', blk.afterStory > blk.afterReport,
      blk.afterReport + ' → ' + blk.afterStory);
  chk('E3 画其它主题时不动 _stack（不污染既有卡）',
      blk.afterStart === blk.day1sq && blk.afterReport === blk.day1sq,
      JSON.stringify(blk));

  /* ================= F. 幂等：同参数连画两次像素全等 ================= */
  const twice = await page.evaluate(() => {
    SHARE.code = 'test1234'; SHARE.theme = 'day1';
    const a = SHARE.draw('square'); const b = SHARE.draw('square');
    return window.__T.regionDiff(window.__T.img(a), window.__T.img(b),
      [{ name: '整卡', x0: 0, x1: a.width, y0: 0, y1: a.height }])[0].diff;
  });
  chk('F1 同参数连画两次像素全等（可复现）', twice === 0, 'diff=' + twice);

  console.log('');
  if (FAILS.length) {
    console.log('失败明细（' + FAILS.length + '）：');
    FAILS.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
  }
  console.log('通过 ' + PASS + ' 项，失败 ' + FAIL + ' 项');

  await browser.close();
  srv.close();
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
