/**
 * test_contrast.mjs —— 「文字看不清」类缺陷的行为级验收（WCAG 对比度）
 *
 * 起因（康哥 2026-09-13 报的截图）：Smart review 卡里的英文 "My phone is lost."
 * 是**黑的**，压在深色底上看不清；同一张卡的中文是浅青色（能看清）。
 *
 * 根因：`--fg` 这个 CSS 变量**从来没被定义过**（定义 0 次 / 使用 5 次）。
 *   `.rv-en{color:var(--fg)}` ⇒ var() 无 fallback 且变量未定义 ⇒ 该声明
 *   **invalid at computed-value time** ⇒ `color` 退化成 `unset` = `inherit`
 *   ⇒ 从父元素 `<button class="rv-line">` 继承 UA 的 `buttontext`（黑色）。
 *   中文用 `var(--teal)`（有定义）⇒ 正常浅色。⇒ 一黑一亮的「同卡不同色」。
 *
 * ⚠️ 为什么不能只断言「颜色等于 #eef2f7」：
 *   那是**量我要的实现**而不是**量用户能不能看清**。真正的判据是
 *   **对比度**——它同时咬住前景色与背景色，换主题/换底色时也依然有效。
 *   （这也是本项目的教训：断言要咬「我打算怎么实现」，不是「我希望用户看到什么」；
 *     但对比度这类**客观可计算**的用户可感知量，是少数可以直接咬的。）
 *
 * 用法：
 *   node _internal/fix-2026-09-13/test_contrast.mjs            # 断言模式
 *   node _internal/fix-2026-09-13/test_contrast.mjs --report   # 只报数不判失败
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
const REPORT_ONLY = process.argv.includes('--report');

let pass = 0, fail = 0, warn = 0;
const ok = (id, m) => { pass++; console.log('  ✅ %s %s', id, m); };
const no = (id, m) => { fail++; console.log('  ❌ %s %s', id, m); };
const info = (m) => console.log('  📊 ' + m);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

function serve(root) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      const fp = path.join(root, rel);
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        resp.writeHead(404); return resp.end('nf');
      }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

/* 注入到页面里跑的测量函数：对每个选择器取「计算色 + 最近的不透明祖先底色」，
   再算 WCAG 对比度。全部在真实渲染的页面上取，不是解析 CSS 文本。
   ⚠️ 必须以**真函数**传（不能传字符串模板）：Playwright 对字符串只当表达式求值，
   不会把求值结果当函数再带参调用 ⇒ 静默返回 undefined（本脚本第一版就栽在这）。 */
const PROBE = function (sels) {
  const parse = (c) => {
    const s = String(c).trim();
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter((x) => x !== '').map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: (p.length > 3 && !isNaN(p[3])) ? p[3] : 1 };
    }
    /* Chrome 对部分计算色回成 color(srgb r g b) —— 只认 rgb() 会漏（本脚本踩过） */
    m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
    if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
    return null;
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const effBg = (el) => {
    let cur = el, acc = null;
    while (cur && cur.nodeType === 1) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc; }
      cur = cur.parentElement;
    }
    return acc || { r: 22, g: 26, b: 32, a: 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const out = [];
  sels.forEach((id) => {
    const el = document.querySelector(id.sel);
    if (!el) { out.push({ id: id.id, sel: id.sel, missing: true }); return; }
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    const bg = effBg(el);
    if (!fg) { out.push({ id: id.id, sel: id.sel, unparsed: cs.color }); return; }
    const solid = over(fg, bg);
    out.push({
      id: id.id, sel: id.sel,
      color: cs.color, bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
      ratio: Math.round(ratio(solid, bg) * 100) / 100,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      text: (el.textContent || '').trim().slice(0, 28),
    });
  });
  const rootFg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
  return { out, rootFg, rootTxt: getComputedStyle(document.documentElement).getPropertyValue('--txt').trim() };
};

/* 被测目标：覆盖 var(--fg) 的全部 5 处 + var(--text)/var(--text-sec) 的 3 处无 fallback 点。
   每项给「最小可读字号」判据：正文 4.5，大字（≥18.66px 粗体 / ≥24px）3.0。 */
const TARGETS = [
  { id: 'V1', sel: '.rv-en', label: 'Smart review 英文（康哥报的那处）', min: 4.5 },
  { id: 'V2', sel: '.rv-hz', label: 'Smart review 中文（对照组，本来就好的）', min: 4.5 },
  { id: 'V3', sel: '.ear-play', label: '听辨卡「Play the sound」按钮', min: 4.5 },
  { id: 'V4', sel: '.ear-res', label: '听辨卡答题结果行', min: 4.5 },
  { id: 'V5', sel: '.day1-step', label: '首页 Day-1 三步走按钮', min: 4.5 },
  { id: 'V6', sel: '.day1-step .panda-practice', label: 'Day-1 行内 🐼 跟练按钮', min: 3.0 },
  { id: 'V7', sel: '.fc-level-btn', label: '字卡等级按钮（var(--text) 无 fallback）', min: 4.5 },
  { id: 'V8', sel: '.fc-pending-zh', label: '字卡「待补充」说明（var(--text) 无 fallback）', min: 4.5 },
  /* ⚠️ 这个选择器**不能**写成 [style*="text-sec"] —— 修复后那处已改用 var(--sub)，
     旧选择器会永远匹配不到、静默变成"未渲染跳过"，测试就悄悄失效了。
     写选择器要咬**元素身份**（这是哪段字），不要咬**我上次的实现痕迹**。 */
  { id: 'V9', sel: '.setrow small', label: 'Settings About 小字（var(--text-sec) 无 fallback）', min: 4.5 },
];

/* ── 全局低对比度扫描 ────────────────────────────────────────────────
   目标：不只看「康哥报的那一处」，而是把**整个 App 所有可见文字**量一遍。
   判失败的门槛故意压到 **3.0**（WCAG 大字线）—— 这是"几乎不可能误伤、
   一旦低于必定真的看不清"的位置；4.5 以下另作 📊 报数，供人判断。 */
const SWEEP = function () {
  const parse = (c) => {
    const s = String(c).trim();
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[,\s/]+/).filter((x) => x !== '').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: (p.length > 3 && !isNaN(p[3])) ? p[3] : 1 }; }
    m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
    if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : +m[4] };
    return null;
  };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
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

  const bad = [], borderline = [];
  let checked = 0, skipped = 0;
  document.querySelectorAll('body *').forEach((el) => {
    if (el.closest('nav') === null && false) return;
    // 只看**可见**元素：display:none 下的样式不是用户看到的样子
    if (el.getClientRects().length === 0) return;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
    // 只看**自己直接含文字**的元素（避免父容器被算成一次）
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) return;
    if (/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\p{P}\p{S}]+$/u.test(own)) { skipped++; return; }
    const fg = parse(getComputedStyle(el).color);
    if (!fg || fg.a === 0) { skipped++; return; }
    const { bg, overImage } = effBg(el);
    const r = Math.round(ratio(over(fg, bg), bg) * 100) / 100;
    const rec = {
      view: el.closest('.views') ? el.closest('.views').id : (el.closest('nav') ? 'nav' : 'chrome'),
      cls: String(el.className || el.tagName).slice(0, 46),
      color: getComputedStyle(el).color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
      ratio: r, text: own.slice(0, 26), overImage,
    };
    checked++;
    if (r < 3.0 && !overImage) bad.push(rec);
    else if (r < 4.5 && !overImage) borderline.push(rec);
  });
  return { bad, borderline, checked, skipped };
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { srv, port } = await serve(APP);
  const base = 'http://127.0.0.1:' + port;
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, score: 88 }) }));

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // ① 首页 + 渲染（几何/颜色断言必须先让容器可见 —— 隐藏元素算出来的色是没意义的）
  await page.evaluate(() => { try { go('home'); renderHome(); } catch (e) {} });

  // ② 听辨卡：先渲染，再真答一题让 .ear-res 出现
  await page.evaluate(() => {
    try {
      const pane = document.getElementById('listen-pane-1');
      if (pane && !pane.innerHTML.trim()) pane.innerHTML = listenCardHtml();
      const b1 = document.getElementById('eb-1');
      if (b1 && !document.getElementById('ear-res')) b1.click();
    } catch (e) {}
  });
  await page.waitForTimeout(250);

  // ③ 复习队列：造一句「说过的话」，让它真的到期（否则 .rv-en 根本不渲染，测试空转）
  await page.evaluate(() => {
    try {
      S.phrases = S.phrases || {};
      S.phrases['arrival'] = [0, 1, 2];
      S.rev = S.rev || {};
    } catch (e) {}
  });

  // ④ 字卡「待补充」态：HSK2/3 无卡时才会出现，直接调渲染函数把它造出来
  await page.evaluate(() => { try { go('cards'); } catch (e) {} });
  await page.waitForTimeout(500);
  await page.evaluate(() => { try { showLevelPending(2); } catch (e) {} });
  await page.waitForTimeout(150);

  /* ⑤ 逐视图扫描：**必须一个视图一个视图地扫** ——
     只有当前显示的那个视图里，元素才真的可见；而「可见性」是低对比度扫描的前提
     （隐藏元素的 color 仍能读到，但它不是用户看到的样子 ⇒ 扫了等于没扫）。 */
  const viewIds = await page.evaluate(() => [...document.querySelectorAll('.views')].map((e) => e.id));
  const allBad = [], allBorder = [];
  let checked = 0, skipped = 0;
  console.log('\n=== 全局低对比度扫描（逐视图，真实渲染态） ===');
  for (const vid of viewIds) {
    await page.evaluate((v) => {
      try { go(v.slice(2)); } catch (e) {}
      ['renderHome', 'renderReview', 'renderMe', 'renderSettings'].forEach((f) => { try { window[f] && window[f](); } catch (e) {} });
    }, vid);
    await page.waitForTimeout(140);
    const sw = await page.evaluate(SWEEP);
    checked += sw.checked; skipped += sw.skipped;
    sw.bad.forEach((b) => allBad.push(b));
    sw.borderline.forEach((b) => allBorder.push(b));
    const flag = sw.bad.length ? '❌' : (sw.borderline.length ? '⚠️ ' : '✅');
    console.log('  ' + flag + ' ' + vid.padEnd(14) + '量了 ' + String(sw.checked).padStart(3) + ' 处文字' +
      (sw.bad.length ? '，' + sw.bad.length + ' 处 <3.0' : '') +
      (sw.borderline.length ? '，' + sw.borderline.length + ' 处 3.0–4.5' : ''));
  }

  // ⑥ 目标元素的精确测量（颜色与可见性无关 ⇒ 可以在任意视图下量）
  await page.evaluate(() => { try { go('home'); renderHome(); } catch (e) {} });
  await page.waitForTimeout(150);
  const res = await page.evaluate(PROBE, TARGETS);
  console.log('\n=== 目标元素 · 计算样式实测 ===');
  console.log('  --txt = ' + res.rootTxt + '（--fg 已从代码中移除，不再是可用的名字）');
  console.log('  ' + 'ID'.padEnd(4) + '选择器'.padEnd(28) + '前景色'.padEnd(22) + '合成底色'.padEnd(22) + '对比度');
  let missing = 0;
  for (const r of res.out) {
    if (r.missing) { missing++; console.log('  ' + r.id.padEnd(4) + r.sel.padEnd(28) + '— 元素未渲染，跳过判定'); continue; }
    if (r.unparsed) { missing++; console.log('  ' + r.id.padEnd(4) + r.sel.padEnd(28) + '— 颜色无法解析：' + r.unparsed); continue; }
    console.log('  ' + r.id.padEnd(4) + r.sel.padEnd(28) + r.color.padEnd(22) + r.bg.padEnd(22) + r.ratio + ' : 1');
  }

  console.log('\n=== 判定（WCAG AA：正文 ≥4.5，大字 ≥3.0） ===');
  for (const t of TARGETS) {
    const r = res.out.find((x) => x.id === t.id);
    if (!r || r.missing) { console.log('  ⏭  %s %s（元素未渲染，未判定）', t.id, t.label); continue; }
    const good = r.ratio >= t.min;
    const msg = t.id + ' ' + t.label + ' — ' + r.color + ' on ' + r.bg + ' = ' + r.ratio + ':1（需 ≥' + t.min + '）「' + r.text + '」';
    if (good) ok(t.id, msg);
    else if (REPORT_ONLY) { warn++; console.log('  ⚠️  %s', msg); }
    else no(t.id, msg);
  }

  /* ── 全局扫描判定：门檻压到 3.0（大字线），低于它必定真的看不清，
        几乎不可能误伤；3.0–4.5 只报数不判失败（供人判断，可能是刻意的弱层级文字）。 ── */
  console.log('\n=== 全局扫描判定（失败线 <3.0；3.0–4.5 仅报数） ===');
  if (allBad.length === 0) {
    pass++;
    console.log('  ✅ S1 全部 ' + checked + ' 处可见文字对比度均 ≥3.0（跳过 ' + skipped + ' 处纯符号/表情/透明字）');
  } else {
    fail++;
    console.log('  ❌ S1 发现 ' + allBad.length + ' 处对比度 <3.0（真实看不清）：');
    allBad.slice(0, 20).forEach((b) => console.log('       ' + b.view + ' · ' + b.cls + ' — ' + b.color + ' on ' + b.bg + ' = ' + b.ratio + ':1 「' + b.text + '」'));
  }
  if (allBorder.length) {
    console.log('  📊 S2 另有 ' + allBorder.length + ' 处落在 3.0–4.5（未达 AA 正文线，但可读；如果其中有你看着别扭的，告诉我是哪处）：');
    allBorder.slice(0, 12).forEach((b) => console.log('       ' + b.view + ' · ' + b.cls + ' = ' + b.ratio + ':1 「' + b.text + '」'));
  }

  if (errors.length) console.log('\n  ⚠️ 页面 JS 报错 ' + errors.length + ' 条：' + errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败' + (warn ? ' / ' + warn + ' 仅报数' : '') + (missing ? ' / ' + missing + ' 未渲染' : ''));
  process.exit(fail ? 1 : 0);
})();
