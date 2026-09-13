/**
 * smoke-live-check.mjs —— 内置浏览器「真实用户旅程」全站自检
 *
 * 与 test_contrast.mjs 的分工：
 *   · test_contrast  = **单点专项**（文字对比度，用量化判据咬死一类缺陷）
 *   · 本脚本          = **全站体检**（跑一遍用户真会走的路径，看有没有别的问题）
 *
 * 判据全部落在「用户能感知的坏」上，且都可客观计算：
 *   G1 JavaScript 运行时异常（pageerror）            —— 白屏/功能静默失效的根源
 *   G2 本地资源加载失败（4xx/5xx，排除 /api/）        —— 破图标/破音/破样式
 *   G3 横向溢出（scrollWidth > clientWidth）          —— 手机上「页面能左右晃」
 *   G4 破图（img 已 complete 但 naturalWidth 0）       —— 露出 alt 或空白块
 *   G5 低对比度可见文字（< 3.0）                      —— 康哥报过的那类
 *   G6 nav 切换真的生效（点 → 视图真的换）            —— 「点了没反应」
 *   G7 关键旅程走通                                    —— 主链路
 *   G8 **裸 HTML 标记泄漏**（v0.23.10 新增）           —— `textContent = '<svg …>'` ⇒ 界面显示源码
 *   G9 **内容残缺**（undefined / NaN / {占位} 未替换） —— 半成品文案漏出
 *   G10 可点元素无名称（无文字/aria-label/title）      —— 用户不知道点它会发生什么
 *   G11 触控目标过小（< 24px）                        —— 手机上点不中
 *   G12 **装饰层被裁切**（伪元素超出父盒且父 overflow 隐藏） —— 徽标/纹饰缺一角
 *
 * ⚠️ 纪律（本项目踩过的坑）：
 *   ① page.evaluate 的第一个参数必须是**真函数**，传字符串模板不传参 ⇒ 静默 undefined
 *   ② route 后注册优先 ⇒ 通用规则先注册、具体 mock 后注册
 *   ③ 断言不咬「我打算怎么实现」，只咬「用户能不能用/能不能看清」
 *   ④ 「两个断言互相矛盾」本身就是线索（曾靠 G1 报 404 / G2 报 0 条 反推出 SW 绕过 mock）
 *
 * 用法：node _internal/fix-2026-09-13/smoke-live-check.mjs
 *      node _internal/fix-2026-09-13/smoke-live-check.mjs --no-shot   # 不截图
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const SHOTS = path.join(HERE, 'shots');
const NO_SHOT = process.argv.includes('--no-shot');

let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log('  \u2705 %s %s', id, m); };
const no = (id, m) => { fail++; console.log('  \u274c %s %s', id, m); };
const info = (m) => console.log('  \ud83d\udcca ' + m);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.apk': 'application/vnd.android.package-archive',
};

function serve(root) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      const fp = path.join(root, rel);
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        resp.writeHead(404, { 'Content-Type': 'text/plain' }); return resp.end('nf');
      }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

/* ---------------- 注入到页面里跑的测量函数（必须是真函数） ---------------- */

// 横向溢出 + 破图 + 可见文字量 + 最宽元素（定位溢出元凶）
const HEALTH = function () {
  const de = document.documentElement;
  const active = [...document.querySelectorAll('.views')].filter((v) => v.getClientRects().length > 0);
  const vw = de.clientWidth;

  // 找真正溢出的元素（用于定位，而不是只报「溢出了」）
  let widest = null, maxRight = 0;
  if (de.scrollWidth > vw + 1) {
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + 1 && r.right > maxRight) {
        maxRight = r.right;
        widest = String(el.className || el.tagName).slice(0, 44) + ' @' + Math.round(r.right) + 'px';
      }
    });
  }

  const brokenImgs = [];
  document.querySelectorAll('img').forEach((im) => {
    if (im.getClientRects().length === 0) return;
    if (im.complete && im.naturalWidth === 0 && im.getAttribute('src')) {
      brokenImgs.push(String(im.getAttribute('src')).slice(0, 60));
    }
  });

  const txt = active.map((v) => (v.innerText || '').replace(/\s+/g, ' ').trim().length).reduce((a, b) => a + b, 0);
  return {
    activeViews: active.map((v) => v.id),
    scrollW: de.scrollWidth, clientW: vw, overflow: de.scrollWidth > vw + 1,
    widest, brokenImgs, txt,
  };
};

// 低对比度扫描（与 test_contrast 同源判据，扫当前可见视图）
const SWEEP = function () {
  const parse = (c) => {
    const s = String(c).trim();
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter((x) => x !== '').map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: (p.length > 3 && !isNaN(p[3])) ? p[3] : 1 };
    }
    m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
    if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
    return null;
  };
  const over = (f, b) => ({
    r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a), a: f.a + b.a * (1 - f.a),
  });
  const fv = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * fv(c.r) + 0.7152 * fv(c.g) + 0.0722 * fv(c.b);
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  const effBg = (el) => {
    let cur = el, acc = null, overImage = false;
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      if (/url\(/.test(cs.backgroundImage)) overImage = true;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(c, acc) : c; if (acc.a >= 0.999) break; }
      cur = cur.parentElement;
    }
    return { bg: acc || { r: 22, g: 26, b: 32, a: 1 }, overImage };
  };

  const bad = [];
  let checked = 0;
  document.querySelectorAll('body *').forEach((el) => {
    if (el.getClientRects().length === 0) return;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) return;
    if (/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\p{P}\p{S}]+$/u.test(own)) return;
    const fg = parse(getComputedStyle(el).color);
    if (!fg || fg.a === 0) return;
    const { bg, overImage } = effBg(el);
    if (overImage) return;
    const r = Math.round(ratio(over(fg, bg), bg) * 100) / 100;
    checked++;
    if (r < 3.0) {
      bad.push({
        view: el.closest('.views') ? el.closest('.views').id : (el.closest('nav') ? 'nav' : 'chrome'),
        cls: String(el.className || el.tagName).slice(0, 40),
        color: getComputedStyle(el).color,
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        ratio: r, text: own.slice(0, 22),
      });
    }
  });
  return { bad, checked };
};

/* ★ v0.23.10 新增：裸 HTML 标记泄漏
   形态：代码走 `el.textContent = '…<svg …>…'`，浏览器把标记**转义成纯文本** ⇒
        用户在按钮/卡片上读到几十个字符的源码（如本轮康哥报的速度按钮）。
   判据：元素**自己的直接文本节点**里出现「标签形状」或 SVG 专有属性。
        只看直接文本节点 ⇒ 不会把真正渲染出来的 <svg> 子元素误判。 */
const MARKUP = function () {
  const TAG = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i;
  const SVG_ATTR = /viewBox=|stroke-width=|fill="currentColor"|stroke-linecap=/;
  const out = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (el.getClientRects().length === 0) return;
    let own = '';
    [...el.childNodes].forEach((n) => { if (n.nodeType === 3) own += n.textContent; });
    own = own.replace(/\s+/g, ' ').trim();
    if (!own) return;
    if (TAG.test(own) || SVG_ATTR.test(own)) {
      out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 36), id: el.id || '', text: own.slice(0, 80) });
    }
  });
  return out;
};

/* ★ v0.23.10 新增：内容残缺（半成品文案漏到界面） */
const CONTENT = function () {
  const PAT = /\bundefined\b|\bNaN\b|\[object Object\]|\{[a-zA-Z_][a-zA-Z0-9_]*\}|%s|\bTODO\b|\bFIXME\b|\bnull\b/;
  const out = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (el.getClientRects().length === 0) return;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
    let own = '';
    [...el.childNodes].forEach((n) => { if (n.nodeType === 3) own += n.textContent; });
    own = own.replace(/\s+/g, ' ').trim();
    if (!own || own.length > 300) return;
    const m = own.match(PAT);
    if (m) out.push({ cls: String(el.className || el.tagName).slice(0, 36), hit: m[0], text: own.slice(0, 70) });
  });
  return out;
};

/* ★ v0.23.10 新增：可点元素无名称（用户不知道点它会怎样） */
const NOA11Y = function () {
  const out = [];
  document.querySelectorAll('button,a,[onclick],[role="button"]').forEach((el) => {
    if (el.getClientRects().length === 0) return;
    const name = (el.innerText || '').replace(/\s+/g, ' ').trim()
      || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!name) out.push(String(el.className || el.tagName).slice(0, 36) + (el.id ? '#' + el.id : ''));
  });
  return out;
};

/* ★ v0.23.10 新增：触控目标过小（WCAG 2.5.8 下限 24×24） */
const TAP = function () {
  const small = [];
  document.querySelectorAll('button,a,[onclick],[role="button"],input,select').forEach((el) => {
    if (el.getClientRects().length === 0) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (r.width < 24 || r.height < 24) {
      small.push({
        cls: String(el.className || el.tagName).slice(0, 30), w: Math.round(r.width), h: Math.round(r.height),
        txt: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12),
        /* 报缺陷必须给出可定位证据：把 outerHTML 摘要一并带出来 */
        html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 130),
      });
    }
  });
  return small;
};

/* ★ v0.23.10 新增：装饰层被裁切（伪元素超出父盒且父 overflow 隐藏 ⇒ 徽标缺一角） */
const CLIPPED = function () {
  const out = [];
  const num = (v) => (parseFloat(v) || 0);
  document.querySelectorAll('body *').forEach((el) => {
    if (el.getClientRects().length === 0) return;
    const pr = el.getBoundingClientRect();
    if (pr.width < 4 || pr.height < 4) return;
    ['::before', '::after'].forEach((which) => {
      let cs;
      try { cs = getComputedStyle(el, which); } catch (e) { return; }
      if (!cs || cs.content === 'none' || cs.display === 'none') return;
      const hasVisual = /url\(/.test(cs.backgroundImage) || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px';
      if (!hasVisual) return;
      const w = num(cs.width), h = num(cs.height);
      if (w < 2 || h < 2) return;
      // 伪元素定位基准是 el 的 padding box（这里用 border box 近似，只做「明显超出」判定）
      const left = cs.left === 'auto' ? null : num(cs.left);
      const right = cs.right === 'auto' ? null : num(cs.right);
      const top = cs.top === 'auto' ? null : num(cs.top);
      const bottom = cs.bottom === 'auto' ? null : num(cs.bottom);
      let outside = false, why = [];
      if (left !== null && left + w > pr.width + 2) { outside = true; why.push('右出' + Math.round(left + w - pr.width) + 'px'); }
      if (left !== null && left < -2) { outside = true; why.push('左出' + Math.round(-left) + 'px'); }
      if (top !== null && top + h > pr.height + 2) { outside = true; why.push('下出' + Math.round(top + h - pr.height) + 'px'); }
      if (top !== null && top < -2) { outside = true; why.push('上出' + Math.round(-top) + 'px'); }
      if (bottom !== null && bottom < -2) { outside = true; why.push('底部错位'); }
      if (!outside) return;
      out.push({
        who: el.tagName + '.' + String(el.className || '').slice(0, 30) + (el.id ? '#' + el.id : '') + which,
        box: Math.round(pr.width) + 'x' + Math.round(pr.height),
        pseudo: Math.round(w) + 'x' + Math.round(h) + ' @' + (left === null ? 'auto' : Math.round(left)) + ',' + (top === null ? 'auto' : Math.round(top)),
        why: why.join('/'),
        parentOverflow: getComputedStyle(el).overflow + '/' + getComputedStyle(el).overflowX,
      });
    });
  });
  return out;
};

/* ------------------------------- 视图清单与装填 ------------------------------- */

const VIEWS = ['v-onboard', 'v-home', 'v-scene', 'v-dialog', 'v-cities', 'v-days', 'v-tone', 'v-review',
  'v-practice', 'v-explore', 'v-scenes-read', 'v-me', 'v-settings', 'v-prog', 'v-cards', 'v-sentences', 'v-reading'];

const SETUP = function (vid) {
  try {
    switch (vid) {
      case 'v-onboard': go('onboard'); window.renderOnboard && renderOnboard(); break;
      case 'v-home': go('home'); window.renderHome && renderHome(); window.renderSceneList && renderSceneList(); break;
      case 'v-scene': {
        go('home'); window.renderHome && renderHome();
        var b = document.querySelector('#home-scenes .card button[onclick*="openScene"]');
        if (b) b.click();
        break;
      }
      case 'v-dialog': go('dialog'); window.renderDialogList && renderDialogList(); break;
      case 'v-cities': go('cities'); window.renderCities && renderCities(); break;
      case 'v-days': go('days'); window.renderDays && renderDays(); break;
      case 'v-tone': go('tone'); window.renderToneBtns && renderToneBtns(); break;
      case 'v-review':
        S.phrases = S.phrases || {}; S.phrases['arrival'] = [0, 1, 2]; S.rev = S.rev || {};
        go('review'); window.renderReview && renderReview(); break;
      case 'v-practice': go('practice'); break;
      case 'v-explore': go('explore'); break;
      case 'v-scenes-read': go('scenes-read'); window.renderScenesRead && renderScenesRead(); break;
      case 'v-me': go('me'); window.renderMe && renderMe(); break;
      case 'v-settings': go('settings'); window.renderSettings && renderSettings(); window.renderLangList && renderLangList(); break;
      case 'v-prog': go('prog'); break;
      case 'v-cards': go('cards'); break;
      case 'v-sentences': go('sentences'); break;
      case 'v-reading': go('reading'); break;
      default: go(vid.slice(2));
    }
  } catch (e) { /* 装填失败由后续探针体现 */ }
};

/* ---------------------------------- 主流程 ---------------------------------- */

(async () => {
  if (!NO_SHOT) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const { srv, port } = await serve(APP);
  const base = 'http://127.0.0.1:' + port;
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true,
    /* ⚠️ 必须 block SW：page.route **不拦截 Service Worker 发起的 fetch**
       （本项目 SW 自 v0.23.8 起真能注册成功，于是 SW 的 /api/profile 预取
        绕过 mock 直接打到本地 server ⇒ 404 ⇒ 污染判据）。
       SW 本身能不能注册，由下方 E 段用独立 context 单独验。 */
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();

  /* ---- mock：通用规则**先**注册，具体 mock **后**注册（后注册优先） ---- */
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, score: 88, degraded: false, badges: [], uid: 'smoketest', transcript: '你好' }),
    });
  });
  await page.route('**/api/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, score: 88, degraded: false, uid: 'smoketest', transcript: '你好', feedback: 'Good', text: 'ok' }),
  }));
  await page.route('http://127.0.0.1:8787/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, badges: [] }),
  }));

  /* ---- 观测器 ---- */
  const pageErrors = [];
  const netFailsLocal = [], netFailsExt = [];
  const httpLog = [];
  page.on('pageerror', (e) => pageErrors.push('[pageerror] ' + String(e.message || e).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) return;
    pageErrors.push('[console] ' + t.slice(0, 160));
  });
  page.on('response', (res) => {
    const u = res.url();
    httpLog.push({ u, s: res.status() });
    if (res.status() < 400) return;
    if (u.startsWith(base)) netFailsLocal.push(res.status() + ' ' + u.replace(base, ''));
    else netFailsExt.push(res.status() + ' ' + u.slice(0, 100));
  });

  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const viewIds = await page.evaluate(() => [...document.querySelectorAll('.views')].map((e) => e.id));
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550 A. 逐视图健康扫描（' + viewIds.length + ' 个视图 · 每视图 8 类探针） \u2550\u2550\u2550\u2550\u2550\u2550');
  info('视图清单：' + viewIds.join(' '));
  if (viewIds.length !== VIEWS.length) info('\u26a0 硬编码 VIEWS(' + VIEWS.length + ') 与实际(' + viewIds.length + ') 不一致，请同步');

  const allBad = [], allMarkup = [], allContent = [], allNoA11y = [], allTap = [], allClipped = [];
  let totalChecked = 0, ovf = 0, broken = 0, emptyViews = [];
  for (const vid of viewIds) {
    const before = pageErrors.length;
    await page.evaluate(SETUP, vid);
    await page.waitForTimeout(vid === 'v-home' || vid === 'v-scene' ? 520 : 260);

    const h = await page.evaluate(HEALTH);
    const sw = await page.evaluate(SWEEP);
    const mk = await page.evaluate(MARKUP);
    const ct = await page.evaluate(CONTENT);
    const na = await page.evaluate(NOA11Y);
    const tp = await page.evaluate(TAP);
    const cl = await page.evaluate(CLIPPED);

    totalChecked += sw.checked;
    sw.bad.forEach((b) => allBad.push(b));
    mk.forEach((b) => allMarkup.push({ view: vid, ...b }));
    ct.forEach((b) => allContent.push({ view: vid, ...b }));
    na.forEach((b) => allNoA11y.push({ view: vid, who: b }));
    tp.forEach((b) => allTap.push({ view: vid, ...b }));
    cl.forEach((b) => allClipped.push({ view: vid, ...b }));

    const newErr = pageErrors.length - before;
    if (h.overflow) ovf++;
    if (h.brokenImgs.length) broken++;
    if (!h.txt) emptyViews.push(vid);

    const flags = [];
    if (newErr) flags.push('JS异常' + newErr);
    if (h.overflow) flags.push('横向溢出(' + h.scrollW + '>' + h.clientW + (h.widest ? ' \u2190 ' + h.widest : '') + ')');
    if (h.brokenImgs.length) flags.push('破图' + h.brokenImgs.length);
    if (sw.bad.length) flags.push('低对比' + sw.bad.length);
    if (mk.length) flags.push('裸标记' + mk.length);
    if (ct.length) flags.push('内容残缺' + ct.length);
    if (na.length) flags.push('无名称可点' + na.length);
    if (tp.length) flags.push('小触控' + tp.length);
    if (cl.length) flags.push('装饰被裁' + cl.length);

    console.log('  ' + (flags.length ? '\u274c' : '\u2705') + ' ' + vid.padEnd(15) +
      '文字' + String(sw.checked).padStart(3) + (h.txt ? '/' + String(h.txt).padStart(3) + '字' : '/空') +
      (flags.length ? ' \u00b7 ' + flags.join(' \u00b7 ') : ''));

    if (!NO_SHOT) await page.screenshot({ path: path.join(SHOTS, vid + '.png') });
  }

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 B. nav 切换真的生效 \u2550\u2550\u2550\u2550\u2550\u2550');
  const navItems = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (!nav) return [];
    return [...nav.querySelectorAll('button,a,[onclick]')]
      .filter((e) => e.getClientRects().length > 0)
      .map((e, i) => ({ i, label: (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 14) }));
  });
  info('nav 内可点元素 ' + navItems.length + ' 个：' + navItems.map((n) => n.label || ('#' + n.i)).join(' / '));
  let navFails = 0;
  for (const it of navItems) {
    const before = pageErrors.length;
    const changed = await page.evaluate(async (idx) => {
      const nav = document.querySelector('nav');
      const els = [...nav.querySelectorAll('button,a,[onclick]')].filter((e) => e.getClientRects().length > 0);
      const el = els[idx]; if (!el) return { hit: false };
      const prev = [...document.querySelectorAll('.views')].filter((v) => v.getClientRects().length > 0).map((v) => v.id).join(',');
      el.click();
      await new Promise((r) => setTimeout(r, 260));
      const now = [...document.querySelectorAll('.views')].filter((v) => v.getClientRects().length > 0).map((v) => v.id).join(',');
      return { hit: true, prev, now, changed: prev !== now };
    }, it.i);
    const newErr = pageErrors.length - before;
    if (!changed.hit || newErr) { navFails++; no('B.' + it.i, '"' + it.label + '" 点击异常' + (newErr ? '（JS 异常 ' + newErr + '）' : '')); }
    else ok('B.' + it.i, '"' + (it.label || '#' + it.i) + '" \u2192 ' + (changed.changed ? changed.now : '未切换视图（可能为弹层/开关，属正常）'));
  }

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 C. 关键旅程（首页 \u2192 场景 \u2192 练习 \u2192 判分 \u2192 复习 \u2192 诺诺） \u2550\u2550\u2550\u2550\u2550\u2550');
  const journey = [];
  const step = async (name, fn) => {
    const before = pageErrors.length;
    let r;
    try { r = await fn(); } catch (e) { r = { err: String(e.message).slice(0, 120) }; }
    const newErr = pageErrors.length - before;
    journey.push({ name, r, newErr });
    const bad = newErr > 0 || (r && r.err);
    console.log('  ' + (bad ? '\u274c' : '\u2705') + ' ' + name + (r && r.detail ? ' \u2014 ' + r.detail : '') +
      (newErr ? ' \u2014 JS 异常 ' + newErr : '') + (r && r.err ? ' \u2014 ' + r.err : ''));
    if (bad) fail++; else pass++;
    return r;
  };

  await step('C1 首页渲染出场景卡', async () => {
    await page.evaluate(() => { try { go('home'); renderHome(); } catch (e) {} });
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => document.querySelectorAll('#home-scenes .card button[onclick*="openScene"]').length);
    return { detail: '首页场景卡按钮 ' + n + ' 个', n, err: n > 0 ? null : '首页 #home-scenes 里找不到 openScene 按钮' };
  });
  await step('C2 进入第一个场景', async () => {
    return await page.evaluate(async () => {
      const el = document.querySelector('#home-scenes .card button[onclick*="openScene"]');
      if (!el) return { err: '首页找不到场景入口按钮' };
      el.click(); await new Promise((r) => setTimeout(r, 420));
      const act = [...document.querySelectorAll('.views')].filter((v) => v.getClientRects().length > 0).map((v) => v.id);
      const title = (document.getElementById('sc-title') || {}).textContent || '';
      return { detail: '视图 ' + act.join(',') + ' · 场景标题「' + title.trim() + '」', act, err: (act.includes('v-scene') && title.trim()) ? null : '未进入 v-scene 或标题为空' };
    });
  });
  await step('C3 练习 hub 可跳转技能页', async () => {
    return await page.evaluate(async () => {
      try { go('practice'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 320));
      const hubs = [...document.querySelectorAll('#v-practice .hub')].filter((b) => b.getClientRects().length > 0);
      if (!hubs.length) return { err: 'v-practice 里找不到 .hub 技能入口' };
      const label = (hubs[0].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      hubs[0].click(); await new Promise((r) => setTimeout(r, 420));
      const act = [...document.querySelectorAll('.views')].filter((v) => v.getClientRects().length > 0).map((v) => v.id);
      return { detail: '共 ' + hubs.length + ' 个技能入口，点「' + label + '」→ ' + act.join(','), act, err: act.includes('v-practice') ? '点了技能入口但没离开 v-practice' : null };
    });
  });
  await step('C4 复习队列可渲染（Smart review）', async () => {
    return await page.evaluate(async () => {
      try {
        S.phrases = S.phrases || {}; S.phrases['arrival'] = [0, 1, 2]; S.rev = S.rev || {};
        go('review'); if (window.renderReview) renderReview();
      } catch (e) { return { err: String(e).slice(0, 100) }; }
      await new Promise((r) => setTimeout(r, 420));
      const card = document.querySelector('#v-review .rv-line,.rv-en');
      const en = document.querySelector('#v-review .rv-en');
      const cs = en ? getComputedStyle(en).color : null;
      return { detail: '复习卡渲染' + (card ? ' OK' : ' 无') + (en ? '，.rv-en 色 = ' + cs : ''), color: cs };
    });
  });
  await step('C5 诺诺浮标可点开面板', async () => {
    return await page.evaluate(async () => {
      try { go('home'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 300));
      const fab = document.getElementById('nono-fab');
      if (!fab) return { err: '找不到 #nono-fab' };
      const before = fab.className;
      fab.click(); await new Promise((r) => setTimeout(r, 550));
      const panel = document.getElementById('nono-panel') || document.getElementById('nono-sheet');
      const vis = panel ? panel.getClientRects().length > 0 : null;
      return { detail: '浮标 className ' + JSON.stringify(before) + ' \u2192 面板可见=' + vis };
    });
  });
  await step('C6 设置视图可进入且无异常', async () => {
    return await page.evaluate(async () => {
      try { go('settings'); if (window.renderSettings) renderSettings(); } catch (e) { return { err: String(e).slice(0, 100) }; }
      await new Promise((r) => setTimeout(r, 320));
      const rows = document.querySelectorAll('#v-settings .setrow').length;
      return { detail: '设置行 ' + rows + ' 条' };
    });
  });
  await step('C7 场景内标记「说过了」回路生效', async () => {
    return await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      try { go('home'); renderHome(); } catch (e) {}
      await sleep(320);
      const entry = document.querySelector('#home-scenes .card button[onclick*="openScene"]');
      if (!entry) return { err: '首页找不到场景入口' };
      entry.click(); await sleep(420);
      const phrases = document.querySelectorAll('#sc-list .phrase');
      if (!phrases.length) return { err: '场景里没渲染出句子（#sc-list .phrase = 0）' };
      const doneBtn = document.querySelector('#sc-list .phrase .btn.done-btn');
      if (!doneBtn) return { err: '句子上找不到「I said it 3×」按钮' };
      doneBtn.click(); await sleep(420);
      const doneN = document.querySelectorAll('#sc-list .phrase.done').length;
      return { detail: '场景 ' + phrases.length + ' 句，点「I said it 3×」后 done 标记 ' + doneN + ' 处', err: doneN > 0 ? null : '点了按钮但 done 标记没出现' };
    });
  });

  /* C8 —— 语速按钮四连点：本轮康哥报的缺陷就在这里（第 3 档含 SVG 图标）
     修前：点第 2 次起，按钮上出现 `<svg class="play-icon-sm" viewBox="0 0 24 24" wid…` 纯文本 */
  await step('C8 语速按钮四连点不吐 HTML 源码', async () => {
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      try { go('home'); renderHome(); } catch (e) {}
      await sleep(320);
      const entry = document.querySelector('#home-scenes .card button[onclick*="openScene"]');
      if (!entry) return { err: '首页找不到场景入口' };
      entry.click(); await sleep(460);
      const btn = document.querySelector('#sc-list .phrase .btn.speed');
      if (!btn) return { err: '找不到语速按钮 #sc-list .phrase .btn.speed' };
      const log = [];
      for (let i = 0; i < 4; i++) {
        btn.click(); await sleep(140);
        let own = '';
        [...btn.childNodes].forEach((n) => { if (n.nodeType === 3) own += n.textContent; });
        own = own.replace(/\s+/g, ' ').trim();
        log.push({
          tap: i + 1,
          own: own.slice(0, 40),
          svgEls: btn.querySelectorAll('svg').length,
          leaked: /<svg|viewBox=|stroke-width=/.test(btn.textContent || ''),
        });
      }
      const leak = log.filter((x) => x.leaked);
      return {
        log,
        detail: log.map((x) => '第' + x.tap + '点「' + x.own + '」svg=' + x.svgEls).join(' · '),
        err: leak.length ? '第 ' + leak.map((x) => x.tap).join(',') + ' 次点击后按钮里出现 HTML 源码' : null,
      };
    });
    if (r && r.log) r.log.forEach((x) => console.log('        \u21b3 第' + x.tap + '点 文本节点「' + x.own + '」· 真 svg 元素 ' + x.svgEls + ' 个 · 泄漏=' + x.leaked));
    return r;
  });

  if (!NO_SHOT) {
    await page.evaluate(() => { try { go('home'); renderHome(); } catch (e) {} });
    await page.waitForTimeout(320);
    await page.screenshot({ path: path.join(SHOTS, 'journey-1-home.png') });
    await page.evaluate(() => { try { S.phrases = S.phrases || {}; S.phrases['arrival'] = [0, 1, 2]; go('review'); renderReview(); } catch (e) {} });
    await page.waitForTimeout(320);
    await page.screenshot({ path: path.join(SHOTS, 'journey-2-review.png') });
    await page.evaluate(() => { try { go('practice'); } catch (e) {} });
    await page.waitForTimeout(320);
    await page.screenshot({ path: path.join(SHOTS, 'journey-3-practice.png') });
    await page.evaluate(() => { try { go('settings'); renderSettings(); } catch (e) {} });
    await page.waitForTimeout(320);
    await page.screenshot({ path: path.join(SHOTS, 'journey-4-settings.png') });
    info('旅程截图 4 张已写入 shots/');
  }

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 D. 导航栏装饰层定位（Me 页签上下金饰） \u2550\u2550\u2550\u2550\u2550\u2550');
  const deco = await page.evaluate(() => {
    const me = document.getElementById('nav-me');
    if (!me) return { err: '#nav-me 不存在' };
    const r = me.getBoundingClientRect();
    const shot = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const b = getComputedStyle(el, '::before'), a = getComputedStyle(el, '::after');
      return {
        who: el.tagName + '.' + String(el.className || '').slice(0, 40) + (el.id ? '#' + el.id : ''),
        rect: Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height),
        bgImage: cs.backgroundImage.slice(0, 70), bg: cs.backgroundColor, overflow: cs.overflow,
        before: b.content === 'none' ? null : { img: b.backgroundImage.slice(0, 60), wh: b.width + 'x' + b.height, pos: b.left + ',' + b.top },
        after: a.content === 'none' ? null : { img: a.backgroundImage.slice(0, 60), wh: a.width + 'x' + a.height, pos: a.left + ',' + a.top },
      };
    };
    const at = (x, y) => shot(document.elementFromPoint(x, y));
    const cx = r.left + r.width / 2;
    return {
      me: shot(me),
      above24: at(cx, Math.max(1, r.top - 24)),
      above10: at(cx, Math.max(1, r.top - 10)),
      onIcon: at(cx, r.top + 10),
      below12: at(cx, r.bottom + 12),
      navSelf: shot(document.querySelector('nav')),
      navBefore: (function () { const s = getComputedStyle(document.querySelector('nav'), '::before'); return { content: s.content, img: s.backgroundImage.slice(0, 70), wh: s.width + 'x' + s.height, pos: s.left + ',' + s.top }; })(),
      navAfter: (function () { const s = getComputedStyle(document.querySelector('nav'), '::after'); return { content: s.content, img: s.backgroundImage.slice(0, 70), wh: s.width + 'x' + s.height, pos: s.left + ',' + s.top }; })(),
    };
  });
  console.log(JSON.stringify(deco, null, 2).split('\n').map((l) => '  ' + l).join('\n'));

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 E. Service Worker 能否真注册（v0.23.8 修复成果） \u2550\u2550\u2550\u2550\u2550\u2550');
  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const p2 = await ctx2.newPage();
  try { await p2.goto(base + '/index.html', { waitUntil: 'load' }); } catch (e) {}
  await p2.waitForTimeout(2500);
  const swInfo = await p2.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      return {
        supported: true, n: regs.length,
        active: regs.length ? !!regs[0].active : false,
        scope: regs.length ? regs[0].scope : '',
      };
    } catch (e) { return { supported: true, n: -1, err: String(e).slice(0, 80) }; }
  });
  if (swInfo.n > 0 && swInfo.active) ok('E1', 'Service Worker 注册成功（' + swInfo.n + ' 个 · active=' + swInfo.active + ' · scope=' + swInfo.scope + '）');
  else no('E1', 'Service Worker 未注册：' + JSON.stringify(swInfo));
  await ctx2.close();

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 F. 设置行标签未被挤压换行 \u2550\u2550\u2550\u2550\u2550\u2550');
  const LABELS = function () {
    const out = [];
    document.querySelectorAll('#v-settings .setrow').forEach((row) => {
      const lab = row.querySelector(':scope > span:first-child');
      if (!lab || lab.getClientRects().length === 0) return;
      const cs = getComputedStyle(lab);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20;
      out.push({
        txt: (lab.innerText || '').trim().slice(0, 16),
        w: Math.round(lab.getBoundingClientRect().width),
        h: lab.offsetHeight, lh: Math.round(lh),
        wrapped: lab.offsetHeight > lh * 1.6,
      });
    });
    return out;
  };
  await page.evaluate(() => { try { go('settings'); renderSettings(); } catch (e) {} });
  await page.waitForTimeout(340);
  const labels = await page.evaluate(LABELS);
  labels.forEach((l, i) => {
    if (l.wrapped) no('F' + (i + 1), '标签「' + l.txt + '」被压成多行（宽 ' + l.w + 'px · 高 ' + l.h + 'px / 行高 ' + l.lh + '）');
    else ok('F' + (i + 1), '标签「' + l.txt + '」宽 ' + l.w + 'px，单行');
  });

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 G. 汇总判定 \u2550\u2550\u2550\u2550\u2550\u2550');
  if (pageErrors.length === 0) ok('G1', 'JavaScript 运行时异常 0 条');
  else { no('G1', 'JavaScript 运行时异常 ' + pageErrors.length + ' 条'); pageErrors.slice(0, 6).forEach((e) => console.log('        \u21b3 ' + e)); }

  if (netFailsLocal.length === 0) ok('G2', '本地资源加载失败 0 条（共观测 ' + httpLog.filter((x) => x.u.startsWith(base)).length + ' 个本地请求）');
  else { no('G2', '本地资源加载失败 ' + netFailsLocal.length + ' 条'); [...new Set(netFailsLocal)].slice(0, 10).forEach((e) => console.log('        \u21b3 ' + e)); }
  if (netFailsExt.length) info('外域 4xx/5xx ' + netFailsExt.length + ' 条（多为被 mock 掉的真实服务，仅供参照）：' + [...new Set(netFailsExt)].slice(0, 4).join(' | '));

  if (ovf === 0) ok('G3', '横向溢出 0 个视图');
  else no('G3', '横向溢出 ' + ovf + ' 个视图');

  if (broken === 0) ok('G4', '破图 0 个视图');
  else no('G4', '破图 ' + broken + ' 个视图');

  if (allBad.length === 0) ok('G5', '低对比度可见文字 0 处（共量 ' + totalChecked + ' 处，阈值 3.0）');
  else {
    no('G5', '低对比度可见文字 ' + allBad.length + ' 处（共量 ' + totalChecked + ' 处）');
    allBad.slice(0, 12).forEach((b) => console.log('        \u21b3 ' + b.view.padEnd(13) + b.ratio.toFixed(2) + ':1 ' + b.color + ' on ' + b.bg + ' \u300c' + b.text + '\u300d .' + b.cls));
  }

  if (navFails === 0) ok('G6', 'nav 切换全部正常');
  else no('G6', 'nav 切换异常 ' + navFails + ' 个');

  const jBad = journey.filter((j) => j.newErr > 0 || (j.r && j.r.err)).length;
  if (jBad === 0) ok('G7', '关键旅程 ' + journey.length + ' 步全部走通');
  else no('G7', '关键旅程 ' + jBad + ' / ' + journey.length + ' 步有问题');

  if (allMarkup.length === 0) ok('G8', '裸 HTML 标记泄漏 0 处（17 视图 × 直接文本节点）');
  else {
    no('G8', '裸 HTML 标记泄漏 ' + allMarkup.length + ' 处');
    allMarkup.slice(0, 10).forEach((b) => console.log('        \u21b3 ' + b.view.padEnd(13) + b.tag + '.' + b.cls + (b.id ? '#' + b.id : '') + ' \u300c' + b.text + '\u300d'));
  }

  if (allContent.length === 0) ok('G9', '内容残缺（undefined / NaN / 未替换占位）0 处');
  else {
    no('G9', '内容残缺 ' + allContent.length + ' 处');
    allContent.slice(0, 10).forEach((b) => console.log('        \u21b3 ' + b.view.padEnd(13) + '【' + b.hit + '】.' + b.cls + ' \u300c' + b.text + '\u300d'));
  }

  if (allNoA11y.length === 0) ok('G10', '可点元素无名称 0 处');
  else {
    info('可点元素无名称 ' + allNoA11y.length + ' 处（不影响可用性，但用户不知道点它会怎样）：');
    allNoA11y.slice(0, 10).forEach((b) => console.log('        \u21b3 ' + b.view.padEnd(13) + b.who));
  }

  if (allTap.length === 0) ok('G11', '触控目标 < 24px 的 0 处');
  else {
    no('G11', '触控目标过小 ' + allTap.length + ' 处（< 24px）');
    allTap.slice(0, 12).forEach((b) => {
      console.log('        \u21b3 ' + b.view.padEnd(13) + b.w + 'x' + b.h + ' .' + b.cls + ' \u300c' + b.txt + '\u300d');
      if (b.html) console.log('            ' + b.html);
    });
  }

  if (allClipped.length === 0) ok('G12', '装饰层被裁切 0 处');
  else {
    no('G12', '装饰层被裁切 ' + allClipped.length + ' 处');
    allClipped.slice(0, 12).forEach((b) => console.log('        \u21b3 ' + b.view.padEnd(13) + b.who + ' 盒' + b.box + ' 伪元素' + b.pseudo + ' (' + b.why + ') overflow=' + b.parentOverflow));
  }

  if (emptyViews.length) info('可见文字为 0 的视图（可能为空态，仅报数）：' + emptyViews.join(' '));

  console.log('\n\u2500\u2500\u2500 结果：' + pass + ' 通过 / ' + fail + ' 失败 \u2500\u2500\u2500');
  if (!NO_SHOT) console.log('截图：' + SHOTS);

  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
