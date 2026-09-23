/* v0.23.23 P0 真机验收：攻略中心 .cg-* 样式与对话卡全局化
   验证「白底黑字默认按钮」与「裸文本对话卡」两个缺陷已修。
   跑法：NODE_PATH=<managed node_modules> node _internal/fix-2026-09-23/test_p0_cityguide_visual.js
   注意：本文件在 _internal/fix-2026-09-23/ 下，仓库根要回两级（__dirname/../..）。 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8142;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

function serve(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

let pass = 0, fail = 0;
const ok_ = (id, m) => { pass++; console.log('  \u2713 ' + id + ' ' + m); };
const no_ = (id, m) => { fail++; console.log('  \u2717 ' + id + ' ' + m); };

(async () => {
  const server = http.createServer(serve);
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  // mock 掉所有 /api/*（本地无后端）
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: 'mock' }) }));
  await page.route('**/google.bigmodel.cn/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 清掉开屏，直接进攻略中心
  await page.evaluate(() => {
    try { document.getElementById('splash') && document.getElementById('splash').classList.add('hide'); } catch (e) {}
    try { if (typeof S !== 'undefined') { S.onboarded = true; S.guideDone = S.guideDone || {}; } } catch (e) {}
  });

  const hasOpen = await page.evaluate(() => typeof openCityGuide === 'function');
  hasOpen ? ok_('A1', 'openCityGuide 全局可用') : no_('A1', 'openCityGuide 不存在');

  await page.evaluate(() => { window.scrollTo(0, 0); openCityGuide('shanghai'); });
  await page.waitForTimeout(400);

  // ---- A. 攻略页九分区条目：不再是 UA 默认样式 ----
  const a = await page.evaluate(() => {
    const z = document.querySelector('#cg-zones .cg-zone');
    const h = document.querySelector('#cg-zones .cg-zhead');
    if (!z || !h) return { missing: true };
    const cz = getComputedStyle(z), ch = getComputedStyle(h);
    const zt = document.querySelector('#cg-zones .zt');
    const zc = document.querySelector('#cg-zones .zc');
    const rt = zt ? zt.getBoundingClientRect() : null;
    const rc = zc ? zc.getBoundingClientRect() : null;
    return {
      zoneCount: document.querySelectorAll('#cg-zones .cg-zone').length,
      zoneBg: cz.backgroundColor,
      headDisplay: ch.display,
      headBg: ch.backgroundColor,
      headBorderW: ch.borderTopWidth,
      headFontSize: ch.fontSize,
      headAppearance: ch.appearance || ch.webkitAppearance,
      ztRight: rt ? Math.round(rt.right) : null,
      zcLeft: rc ? Math.round(rc.left) : null,
      gap: (rt && rc) ? Math.round(rc.left - rt.right) : null,
      zcText: zc ? zc.textContent : null,
      titleText: zt ? zt.textContent : null,
    };
  });
  if (a.missing) { no_('A2', '#cg-zones 下未找到 .cg-zone/.cg-zhead'); }
  else {
    a.zoneCount === 9 ? ok_('A2', '攻略页渲染 9 个分区（实测 ' + a.zoneCount + '）') : no_('A2', '分区数 = ' + a.zoneCount);
    // UA 默认为 rgb(255,255,255) / buttonface；修好后应为透明 + 卡面深色
    (a.headBg === 'rgba(0, 0, 0, 0)' || a.headBg === 'transparent') ? ok_('A3', '.cg-zhead 背景透明（不再是 UA 白底）实测 ' + a.headBg) : no_('A3', '.cg-zhead 背景 = ' + a.headBg);
    // v0.24.0 起 --card = #1e2530
    a.zoneBg === 'rgb(30, 37, 48)' ? ok_('A4', '.cg-zone 卡面 = --card rgb(30,37,48)') : no_('A4', '.cg-zone 背景 = ' + a.zoneBg);
    a.headDisplay === 'grid' ? ok_('A5', '.cg-zhead display=grid（四栏结构）') : no_('A5', '.cg-zhead display = ' + a.headDisplay);
    (parseFloat(a.headFontSize) >= 14) ? ok_('A6', '.cg-zhead 字号 ' + a.headFontSize + '（不再是小号 UA 默认）') : no_('A6', '字号 ' + a.headFontSize);
    (a.gap !== null && a.gap > 0) ? ok_('A7', '「' + a.titleText + '」与「' + a.zcText + '」间隔 ' + a.gap + 'px（Airport Arrival0/4 已修）') : no_('A7', '标题与计数重叠 gap=' + a.gap);
  }

  await page.screenshot({ path: path.join(__dirname, 'shot-p0-cityguide.png') });

  // ---- B. 展开一个分区：短语卡 + 对话卡 ----
  await page.evaluate(() => { cgToggleZone('sh-arrival'); });
  await page.waitForTimeout(400);

  const b = await page.evaluate(() => {
    const body = document.querySelector('#cg-zones .cg-body, #cg-zones .cg-zbody');
    const dlg = document.querySelector('#cg-zones .cg-dialog');
    const line = document.querySelector('#cg-zones .cg-dialog .d-line');
    const who = document.querySelector('#cg-zones .cg-dialog .d-line .who');
    const py = document.querySelector('#cg-zones .cg-dialog .d-line .py');
    const en = document.querySelector('#cg-zones .cg-dialog .d-line .en');
    const flip = document.querySelector('#cg-zones .cg-dialog .d-flip');
    const phrase = document.querySelector('#cg-zones .phrase');
    const chev = document.querySelector('#cg-zones .cg-zone.open .chev');
    const g = el => el ? getComputedStyle(el) : null;
    return {
      hasBody: !!body, hasDlg: !!dlg, hasLine: !!line,
      lineDisplay: line ? g(line).display : null,
      lineBorderBottom: line ? g(line).borderBottomWidth : null,
      whoColor: who ? g(who).color : null,
      pySize: py ? g(py).fontSize : null,
      enColor: en ? g(en).color : null,
      flipDisplay: flip ? g(flip).display : null,
      hasPhrase: !!phrase,
      chevTransform: chev ? g(chev).transform : null,
    };
  });
  b.hasDlg ? ok_('B1', '.cg-dialog 已渲染') : no_('B1', '.cg-dialog 缺失');
  b.hasLine ? ok_('B2', '对话卡 .d-line 存在') : no_('B2', '.d-line 缺失');
  (b.lineDisplay === 'flex') ? ok_('B3', '对话卡 .d-line display=flex（#v-dialog 作用域样式已对攻略区生效）') : no_('B3', '.d-line display = ' + b.lineDisplay);
  (b.lineBorderBottom && parseFloat(b.lineBorderBottom) > 0) ? ok_('B4', '说话人行有分隔线 ' + b.lineBorderBottom) : no_('B4', '无分隔线');
  (b.pySize && parseFloat(b.pySize) >= 15) ? ok_('B5', '拼音行字号 ' + b.pySize) : no_('B5', '拼音字号 = ' + b.pySize);
  (b.enColor === 'rgb(154, 167, 184)') ? ok_('B6', '英文行 = --sub') : no_('B6', '英文行色 = ' + b.enColor);
  b.flipDisplay ? ok_('B7', '.d-flip Role reversal 卡已渲染') : no_('B7', '.d-flip 缺失');
  b.hasPhrase ? ok_('B8', '短语卡 .phrase 已渲染（含 Slower/Score/三遍）') : no_('B8', '.phrase 缺失');
  (b.chevTransform && b.chevTransform !== 'none') ? ok_('B9', '展开态 chev 已旋转 ' + b.chevTransform) : no_('B9', 'chev 未旋转 = ' + b.chevTransform);

  await page.screenshot({ path: path.join(__dirname, 'shot-p0-zone-open.png'), fullPage: false });

  // ---- C. 对话卡页（#v-dialog）回归：原有样式未被改动 ----
  const c = await page.evaluate(() => {
    try { if (typeof openDialog === 'function' && typeof DIALOGS !== 'undefined' && DIALOGS[0]) { openDialog(DIALOGS[0].id); return true; } } catch (e) { return 'ERR:' + e.message; }
    return false;
  });
  if (c === true) {
    await page.waitForTimeout(300);
    const cd = await page.evaluate(() => {
      const app = document.getElementById('v-dialog');
      const line = app && app.querySelector('.d-line');
      const you = app && app.querySelector('.d-line.you .who');
      const them = app && app.querySelector('.d-line.them .who');
      return {
        on: app ? app.classList.contains('on') : false,
        display: line ? getComputedStyle(line).display : null,
        youColor: you ? getComputedStyle(you).color : null,
        themColor: them ? getComputedStyle(them).color : null,
      };
    });
    (cd.display === 'flex') ? ok_('C1', '#v-dialog 对话卡页回归通过（display=flex）') : no_('C1', '#v-dialog .d-line display = ' + cd.display);
    (cd.youColor === 'rgb(255, 107, 117)') ? ok_('C2', 'YOU 标签 = --red-text rgb(255,107,117)（11px 达标 6.33:1）') : no_('C2', 'YOU 色 = ' + cd.youColor);
    (cd.themColor === 'rgb(76, 201, 240)') ? ok_('C3', 'THEM 标签色未变 rgb(76,201,240)') : no_('C3', 'THEM 色 = ' + cd.themColor);
  } else { no_('C1-3', 'openDialog 调用失败 c=' + c); }

  // ---- E. 反馈浮标：v0.24.0 已固定到左下角，与诺诺坞（右下）几何不重叠 ----
  //       此前 CSS 写 right:12px 与 #nono-dock 同角同层，靠注入层 IIFE 改 left 掩盖。
  //       本轮把修复收回源码后，下面这些量才第一次是"源码自证"而非"补丁副作用"。
  await page.evaluate(() => { try { if (typeof go === 'function') go('home'); } catch (e) {} });
  await page.waitForTimeout(400);
  const e = await page.evaluate(() => {
    const fb = document.getElementById('fb-open');
    const dock = document.getElementById('nono-dock');
    const nav = document.querySelector('body>nav');
    const wrap = document.querySelector('.wrap');
    const g = el => el ? getComputedStyle(el) : null;
    const R = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
    let fbR = null, dockR = null, navR = null;
    try { fbR = fb ? R(fb) : null; } catch (x) {}
    try { dockR = dock ? R(dock) : null; } catch (x) {}
    try { navR = nav ? R(nav) : null; } catch (x) {}
    const hit = (a, b) => (a && b) ? !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t) : null;
    return {
      fbShown: fb ? g(fb).display !== 'none' : false,
      fbPos: fb ? g(fb).position : null,
      fbLeft: fb ? g(fb).left : null,
      fbWidth: fbR ? (fbR.r - fbR.l) : null,
      fbHeight: fbR ? (fbR.b - fbR.t) : null,
      fbRadius: fb ? g(fb).borderRadius : null,
      fbAria: fb ? (fb.getAttribute('aria-label') || '') : '',
      fbHasIcon: (function () { try { return !!getComputedStyle(fb, '::before').content; } catch (x) { return false; } })(),
      fbIconMask: (function () {
        try { return getComputedStyle(fb, '::before').webkitMaskImage || getComputedStyle(fb, '::before').maskImage || ''; } catch (x) { return 'ERR'; }
      })(),
      fbZ: fb ? g(fb).zIndex : null,
      dockZ: dock ? g(dock).zIndex : null,
      zTokens: (function () {
        const cs = getComputedStyle(document.documentElement);
        const names = ['--z-nav', '--z-rd-mask', '--z-rd-pop', '--z-utility', '--z-tip', '--z-fab', '--z-drawer', '--z-mask', '--z-sheet', '--z-menu', '--z-update', '--z-toast', '--z-onboard', '--z-modal', '--z-splash', '--z-full', '--z-full-top'];
        const o = {};
        names.forEach(n => { o[n] = (cs.getPropertyValue(n) || '').trim(); });
        return o;
      })(),
      fbR: fbR, dockR: dockR, navR: navR,
      fbVsDock: hit(fbR, dockR),
      fbVsNav: hit(fbR, navR),
      wrapPB: wrap ? g(wrap).paddingBottom : null,
      vw: window.innerWidth,
      posSaved: (function () { try { return localStorage.getItem('sinoky-fb-pos'); } catch (x) { return 'ERR'; } })(),
    };
  });
  e.fbShown ? ok_('E1', '#fb-open 首页可见') : no_('E1', '#fb-open 不可见（display=' + e.fbPos + '）');
  (e.fbPos === 'fixed') ? ok_('E2', '#fb-open position=fixed') : no_('E2', 'position = ' + e.fbPos);
  (e.fbLeft === '12px') ? ok_('E3', '#fb-open left=12px（源码声明生效，不再依赖运行时补丁）') : no_('E3', 'left = ' + e.fbLeft);
  // ⚠️ 不能断言 right==='auto'：CSSOM 对已定位元素返回 used value，
  //    right 恒被解析成实际像素。判「没被 left+right 同时定位拉伸」要看宽度。
  (e.fbWidth !== null && e.fbWidth < e.vw * 0.5) ? ok_('E4', '#fb-open 宽度 ' + e.fbWidth + 'px（未被 left+right 双定位拉伸成满宽 ' + e.vw + '）') : no_('E4', '宽度异常 = ' + e.fbWidth);
  (e.fbVsDock === false) ? ok_('E5', '反馈钮 [l' + (e.fbR && e.fbR.l) + ' r' + (e.fbR && e.fbR.r) + '] 与诺诺坞 [l' + (e.dockR && e.dockR.l) + ' r' + (e.dockR && e.dockR.r) + '] 不重叠') : no_('E5', '仍重叠 fbVsDock=' + e.fbVsDock);
  (e.fbVsNav === false) ? ok_('E6', '反馈钮与底部导航不重叠（底边 ' + (e.fbR && e.fbR.b) + ' < 导航顶 ' + (e.navR && e.navR.t) + '）') : no_('E6', '压在导航上 fbVsNav=' + e.fbVsNav);
  (e.fbZ === '58' && e.dockZ === '60') ? ok_('E7', 'z-index 走 token：功能件 fb=' + e.fbZ + '(--z-utility) < 陪伴浮标 dock=' + e.dockZ + '(--z-fab)') : no_('E7', 'z-index fb=' + e.fbZ + ' dock=' + e.dockZ);
  (e.fbWidth === 40 && e.fbHeight === 40) ? ok_('E8', '#fb-open 40×40（收敛进 .icon-btn 家族，原为 74×37 绿胶囊）') : no_('E8', '尺寸 = ' + e.fbWidth + 'x' + e.fbHeight);
  (e.fbRadius === '999px' || e.fbRadius === '20px') ? ok_('E9', '#fb-open border-radius=' + e.fbRadius + '（圆形）') : no_('E9', 'border-radius = ' + e.fbRadius);
  (e.fbAria.trim().length > 0) ? ok_('E10', '#fb-open 有可访问名 aria-label="' + e.fbAria + '"（文案移除后仍可达）') : no_('E10', '#fb-open 缺 aria-label');
  (e.fbHasIcon && /icon-feedback\.svg/.test(e.fbIconMask)) ? ok_('E11', '#fb-open 图标由 ::before mask 画（icon-feedback.svg）') : no_('E11', '::before mask = ' + String(e.fbIconMask).slice(0, 90));
  (e.posSaved === null) ? ok_('E12', '未写入 sinoky-fb-pos（确认不是拖拽残留掩盖定位）') : no_('E12', 'sinoky-fb-pos = ' + e.posSaved);
  (e.wrapPB === '128px') ? ok_('E13', '.wrap padding-bottom=128px（给浮标留净空，页尾 CTA 不被压）') : no_('E13', '.wrap padding-bottom = ' + e.wrapPB);
  (e.fbR && e.fbR.l < e.vw / 2) ? ok_('E14', '反馈钮位于左半区（l=' + e.fbR.l + ' < vw/2=' + (e.vw / 2) + '）') : no_('E14', '不在左半区 l=' + (e.fbR && e.fbR.l));
  // 17 个（含 --z-mask：它与 --z-drawer 同值 70 —— 两个不同语义共用一个层级，合法；
  // 断言用 >= 而非 > 正是为此，不要把同值误判成「栈序错乱」）
  const ZORDER = ['--z-nav', '--z-rd-mask', '--z-rd-pop', '--z-utility', '--z-tip', '--z-fab', '--z-drawer', '--z-mask', '--z-sheet', '--z-menu', '--z-update', '--z-toast', '--z-onboard', '--z-modal', '--z-splash', '--z-full', '--z-full-top'];
  const missing = ZORDER.filter(n => !e.zTokens[n]);
  const seq = ZORDER.map(n => parseInt(e.zTokens[n], 10));
  const mono = seq.every((v, i) => i === 0 || v >= seq[i - 1]);
  (missing.length === 0 && mono) ? ok_('E15', '17 个 --z-* token 全就位且栈序单调递增：' + seq.join(' < ')) : no_('E15', '缺失 ' + JSON.stringify(missing) + ' 单调=' + mono + ' 序列=' + seq.join(','));
  await page.screenshot({ path: path.join(__dirname, 'shot-v024-home-fb.png'), fullPage: false });

  pageErrors.length === 0 ? ok_('D1', '无页面 JS 报错') : no_('D1', '页面报错: ' + pageErrors.join(' | '));

  console.log('\n──────────────────────────────');
  console.log('P0 真机验收：' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('──────────────────────────────');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
