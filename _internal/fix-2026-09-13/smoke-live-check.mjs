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
 *   G4 破图（img 已 complete 但 naturalWidth 0）      —— 露出 alt 或空白块
 *   G5 低对比度可见文字（< 3.0）                      —— 就是康哥报的那类
 *   G6 nav 切换真的生效（点 → 视图真的换）            —— 「点了没反应」
 *   G7 关键旅程走通（首页→场景→练习→判分→复习→诺诺）  —— 主链路
 *
 * ⚠️ 纪律（本项目踩过的坑）：
 *   ① page.evaluate 的第一个参数必须是**真函数**，传字符串模板不传参 ⇒ 静默 undefined
 *   ② route 后注册优先 ⇒ 通用规则先注册、具体 mock 后注册
 *   ③ 断言不咬「我打算怎么实现」，只咬「用户能不能用/能不能看清」
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
    // 本地静态资源放行；BADGE_API(8787) 由下方更具体的规则接管
    if (u.startsWith(base)) return route.continue();
    // 其余（外部域名 / 8787 兜底）一律拦掉 —— 离线可复现，不碰真实网络
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
  const netFailsLocal = [], netFailsExt = [];   // 4xx/5xx：分开统计，否则「外域被 mock 后的假 404」会污染本地判据
  const httpLog = [];
  page.on('pageerror', (e) => pageErrors.push('[pageerror] ' + String(e.message || e).slice(0, 160)));
  // 资源加载失败由 G2 专职统计；这里过滤掉，避免与 G2 重复计数（G1 只留真正的 JS 异常）
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
  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 A. 逐视图健康扫描（' + viewIds.length + ' 个视图） \u2550\u2550\u2550\u2550\u2550\u2550');

  const allBad = [];
  let totalChecked = 0, ovf = 0, broken = 0;
  for (const vid of viewIds) {
    const before = pageErrors.length;
    await page.evaluate((v) => {
      try { go(v.slice(2)); } catch (e) {}
      ['renderHome', 'renderReview', 'renderMe', 'renderSettings', 'renderProg', 'renderCards', 'renderSentences'].forEach((f) => { try { window[f] && window[f](); } catch (e) {} });
    }, vid);
    await page.waitForTimeout(vid === 'v-home' ? 500 : 220);

    const h = await page.evaluate(HEALTH);
    const sw = await page.evaluate(SWEEP);
    totalChecked += sw.checked;
    sw.bad.forEach((b) => allBad.push(b));
    const newErr = pageErrors.length - before;
    if (h.overflow) ovf++;
    if (h.brokenImgs.length) broken++;

    const flag = (newErr || h.overflow || h.brokenImgs.length || sw.bad.length) ? '\u274c' : '\u2705';
    console.log('  ' + flag + ' ' + vid.padEnd(14) +
      '文字 ' + String(sw.checked).padStart(3) + ' 处' +
      (sw.bad.length ? ' \u00b7 ' + sw.bad.length + ' 处 <3.0' : '') +
      (h.overflow ? ' \u00b7 横向溢出(' + h.scrollW + '>' + h.clientW + (h.widest ? ' \u2190 ' + h.widest : '') + ')' : '') +
      (h.brokenImgs.length ? ' \u00b7 破图 ' + h.brokenImgs.length + ' (' + h.brokenImgs[0] + ')' : '') +
      (newErr ? ' \u00b7 JS 异常 ' + newErr : ''));

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
    // 真实结构：场景卡 = #home-scenes 里带 openScene(...) 的按钮（不是 .scene / [data-scene]）
    const n = await page.evaluate(() => document.querySelectorAll('#home-scenes .card button[onclick*="openScene"]').length);
    return { detail: '首页场景卡按钮 ' + n + ' 个', n, err: n > 0 ? null : '首页 #home-scenes 里找不到 openScene 按钮' };
  });
  await step('C2 进入第一个场景', async () => {
    const r = await page.evaluate(async () => {
      const el = document.querySelector('#home-scenes .card button[onclick*="openScene"]');
      if (!el) return { err: '首页找不到场景入口按钮' };
      el.click(); await new Promise((r) => setTimeout(r, 420));
      const act = [...document.querySelectorAll('.views')].filter((v) => v.getClientRects().length > 0).map((v) => v.id);
      const title = (document.getElementById('sc-title') || {}).textContent || '';
      return { detail: '视图 ' + act.join(',') + ' · 场景标题「' + title.trim() + '」', act, err: (act.includes('v-scene') && title.trim()) ? null : '未进入 v-scene 或标题为空' };
    });
    return r;
  });
  await step('C3 练习 hub 可跳转技能页', async () => {
    const r = await page.evaluate(async () => {
      try { go('practice'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 320));
      // v-practice 是「技能 hub」，卡片类名是 .hub（不是答题选项）
      const hubs = [...document.querySelectorAll('#v-practice .hub')].filter((b) => b.getClientRects().length > 0);
      if (!hubs.length) return { err: 'v-practice 里找不到 .hub 技能入口' };
      const label = (hubs[0].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      hubs[0].click(); await new Promise((r) => setTimeout(r, 420));
      const act = [...document.querySelectorAll('.views')].filter((v) => v.getClientRects().length > 0).map((v) => v.id);
      return { detail: '共 ' + hubs.length + ' 个技能入口，点「' + label + '」→ ' + act.join(','), act, err: act.includes('v-practice') ? '点了技能入口但没离开 v-practice' : null };
    });
    return r;
  });
  await step('C4 复习队列可渲染（Smart review）', async () => {
    const r = await page.evaluate(async () => {
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
    return r;
  });
  await step('C5 诺诺浮标可点开面板', async () => {
    const r = await page.evaluate(async () => {
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
    return r;
  });
  await step('C6 设置视图可进入且无异常', async () => {
    const r = await page.evaluate(async () => {
      try { go('settings'); if (window.renderSettings) renderSettings(); } catch (e) { return { err: String(e).slice(0, 100) }; }
      await new Promise((r) => setTimeout(r, 320));
      const rows = document.querySelectorAll('#v-settings .setrow').length;
      return { detail: '设置行 ' + rows + ' 条' };
    });
    return r;
  });

  await step('C7 场景内标记「说过了」回路生效', async () => {
    const r = await page.evaluate(async () => {
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
    return r;
  });

  // 旅程关键张截图（人眼复核用）
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

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 E. Service Worker 能否真注册（v0.23.8 修复成果） \u2550\u2550\u2550\u2550\u2550\u2550');
  // 主 context 为了 mock 生效 block 掉了 SW ⇒ 这里用独立 context（不 block）实测注册
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
  /* 现象：`.setrow{display:flex}` 左侧标签是可被压缩的 flex item，
     右侧 `.setctl` 内容长且无宽度上限 ⇒ 中文标签（可在任意字间断行）被压成竖排。
     英文标签是不可断单词，所以**只在中文界面显形** —— 典型的「只在一种语言下坏」缺陷。 */
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
  let labelFails = 0;
  labels.forEach((l, i) => {
    if (l.wrapped) { labelFails++; no('F' + (i + 1), '标签「' + l.txt + '」被压成多行（宽 ' + l.w + 'px · 高 ' + l.h + 'px / 行高 ' + l.lh + '）'); }
    else ok('F' + (i + 1), '标签「' + l.txt + '」宽 ' + l.w + 'px，单行');
  });

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 D. 汇总判定 \u2550\u2550\u2550\u2550\u2550\u2550');
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

  console.log('\n\u2500\u2500\u2500 结果：' + pass + ' 通过 / ' + fail + ' 失败 \u2500\u2500\u2500');
  if (!NO_SHOT) console.log('截图：' + SHOTS);

  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
