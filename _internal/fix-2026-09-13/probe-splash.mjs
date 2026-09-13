/**
 * probe-splash.mjs —— v0.23.11 开屏换图专项验收
 *
 * 验什么（每条都咬「用户能不能看到对的画面」，不咬「我打算怎么实现」）：
 *   S1 视觉：开屏整图渲染正确（图真的铺上了 / 无两套字标 / 底色与图内一致 / 不溢出）
 *   S2 真页面·图正常：开屏确实换成 a8_9x16.webp，且最终会消失（不黏屏）
 *   S3 真页面·图晚到 900ms：淡出**等图**（旧版会「图还没出来就淡出」）
 *   S4 真页面·图 404：降级到 CSS 字标、不留白屏、不死锁
 *   S5 A/B 对照：同一脚本跑 HEAD 旧版 ⇒ 证明「不等图」是旧行为、且新版确实换了图源
 *
 * ⚠️ 本脚本踩过的坑（写的时候就要避开）：
 *   ① `page.route` 不拦 SW 发起的 fetch ⇒ 必须 serviceWorkers:'block'
 *   ② route 后注册优先 ⇒ 通用规则（abort 外网）先注册、具体 mock 后注册
 *   ③ `page.evaluate` 第一参数必须是真函数
 *   ④ 不能靠「冻结 setTimeout(1600)」稳住开屏 —— 页面里 kick 也用了 1600ms，会误伤
 *      ⇒ 视觉验收改用「从真 index.html 程序化抠 CSS+DOM 拼探针页」，取的是真样式
 *
 * 用法：node _internal/fix-2026-09-13/probe-splash.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const TMP = path.join(HERE, 'tmp');
const OLD = path.join(TMP, 'oldapp');
const SHOTS = path.join(HERE, 'shots');
const IMG_REL = 'assets/splash/a8_9x16.webp';
const IMG_ABS = path.join(APP, IMG_REL);

let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log('  \u2705 %s %s', id, m); };
const no = (id, m) => { fail++; console.log('  \u274c %s %s', id, m); };
const info = (m) => console.log('  \u2139\ufe0f  ' + m);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* ── 探针页：从真 index.html 抠出开屏 CSS 与 DOM（保证「取的是真样式」） ── */
function buildProbeHtml() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const css = [...html.matchAll(/^[^\n]*#splash[^\n]*\{[^}]*\}$/gm)].map(m => m[0].trim());
  /* ⚠️ 坑：`/<div id="splash">[\s\S]*?<\/div>/` 非贪婪会停在 `.sp-brand` 自己的 </div> 上
     ⇒ 抠出来的 DOM 里**没有 <img>**，探针页测了个空壳（首轮实测：S1 全红、nw=null）。
     必须用后面的 #updatebar 当锚点，才能吃到开屏那一层的闭合。 */
  const dom = (html.match(/<div id="splash">[\s\S]*?<\/div>(?=\s*<div id="updatebar">)/) || [])[0] || '';
  return { css, dom };
}

function serve(roots) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/__probe_splash.html') {
        const { css, dom } = buildProbeHtml();
        const body = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#161a20;--paper:#f5f1e8;--red:#e63946;--teal:#8ab8b2;--gold:#c9a86c;--txt:#eae6dd;--sub:#9aa3ac;--card:#20242c}
html,body{margin:0;padding:0;height:100%;background:#0E3739}
/* ↓↓↓ 以下规则逐字取自真 index.html ↓↓↓ */
${css.join('\n')}
</style></head><body>${dom}</body></html>`;
        resp.writeHead(200, { 'Content-Type': MIME['.html'] });
        return resp.end(body);
      }
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      let fp = null;
      for (const r of roots) {
        const c = path.join(r, rel);
        if (fs.existsSync(c) && fs.statSync(c).isFile()) { fp = c; break; }
      }
      if (!fp) { resp.writeHead(404, { 'Content-Type': 'text/plain' }); return resp.end('nf'); }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      res({ srv, port, base: 'http://127.0.0.1:' + port });
    });
  });
}

/* ── 页面内：记录开屏 hide / gone / fallback 的耗时 ── */
const INIT_TIMELINE = () => {
  window.__sl = { t0: performance.now(), hide: null, gone: null, fallback: null };
  const iv = setInterval(() => {
    const s = document.getElementById('splash');
    const d = Math.round(performance.now() - window.__sl.t0);
    if (!s) { if (window.__sl.gone == null) window.__sl.gone = d; clearInterval(iv); return; }
    if (window.__sl.hide == null && s.classList.contains('hide')) window.__sl.hide = d;
    if (window.__sl.fallback == null && s.classList.contains('sp-fallback')) window.__sl.fallback = d;
  }, 16);
};

/* ── 页面内：开屏状态快照 ── */
const SNAP = () => {
  const s = document.getElementById('splash');
  if (!s) return { exists: false };
  const img = s.querySelector('img');
  const brand = s.querySelector('.sp-brand');
  const r = img ? img.getBoundingClientRect() : null;
  return {
    exists: true, cls: s.className || '',
    bg: getComputedStyle(s).backgroundColor,
    src: img ? img.getAttribute('src') : null,
    nw: img ? img.naturalWidth : null,
    complete: img ? img.complete : null,
    box: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    brandDisplay: brand ? getComputedStyle(brand).display : null,
    vw: innerWidth, vh: innerHeight,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

async function withPage(ctx, base, fn, { delayMs, failImg, vp } = {}) {
  const page = await ctx.newPage();
  if (vp) await page.setViewportSize(vp);
  await page.addInitScript(INIT_TIMELINE);
  // 通用先注册：非本站请求一律掐断（避免等外网超时）
  await page.route(u => !String(u).startsWith(base), r => r.abort());
  // 具体后注册
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  if (delayMs) {
    await page.route(`**/${IMG_REL}*`, async (r) => {
      await new Promise(s => setTimeout(s, delayMs));
      if (!r.request().url().includes('__never')) {
        try { await r.fulfill({ path: IMG_ABS, contentType: 'image/webp' }); } catch (e) { /* page closed */ }
      }
    });
  }
  if (failImg) {
    await page.route(`**/${IMG_REL}*`, r => r.fulfill({ status: 404, contentType: 'text/plain', body: 'nf' }));
  }
  try { return await fn(page); } finally { await page.close().catch(() => {}); }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(OLD, { recursive: true });
  /* 旧版对照：**钉死到不可变 SHA**，不用 HEAD。
     🔴 v0.23.12 修：原写 `git show HEAD:index.html` ⇒ 基线随每次提交前进，
     而 S5 断言绑的是「v0.23.10 → v0.23.11 换图源」那一代 ⇒ 一提交就假红（实测 S5-1 红）。
     这正是本项目 v0.23.9 记过的教训：**A/B 基线必须钉到不可变 SHA，取不到时跳过而非失败**。
     这里钉 `6e287dd` = v0.23.10（换满版开屏图之前那一版，开屏仍是 nono-splash + CSS 字标）。 */
  const BASE_SHA = '6e287dd';
  let baselineOk = false;
  try {
    const old = execFileSync('git', ['show', BASE_SHA + ':index.html'], { cwd: APP, maxBuffer: 1 << 28, encoding: 'utf8' });
    fs.writeFileSync(path.join(OLD, 'index.html'), old, 'utf8');
    baselineOk = true;
    info('旧版对照已就绪：tmp/oldapp/index.html（基线 ' + BASE_SHA + ' = v0.23.10，不可变）');
  } catch (e) {
    info('⚠ 基线 ' + BASE_SHA + ' 取不到（浅克隆 / 该 commit 不存在）⇒ S5 将**跳过而非失败**：' + String(e.message).slice(0, 80));
  }

  /* 🔴🔴 必须**分成两个 server**。首轮实测的错：把 oldapp 放在 roots 前面 ⇒ `/` 命中旧版
     index.html ⇒ S2/S3/S4 全跑在旧页面上（读到 nono-splash、.sp-brand 还 block），
     结果「新版断言」量的是旧版行为 —— 又是「断言在量别的东西」。 */
  const A = await serve([APP]);            // 被测：新版
  const B = await serve([OLD, APP]);       // 对照：旧版优先命中 index.html
  const base = A.base;
  const baseOld = B.base;
  const browser = await chromium.launch({ channel: 'chrome' });

  /* ═══ S1 视觉：探针页（从真 index.html 抠 CSS+DOM） ═══ */
  console.log('\n\u2500\u2500 S1 视觉验收（手机 390x844 / 桌面 1440x900）\u2500\u2500');
  for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: vp, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(base + '/__probe_splash.html', { waitUntil: 'load' });
    await page.waitForFunction(() => { const i = document.querySelector('#splash img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 8000 }).catch(() => {});
    const s = await page.evaluate(SNAP);
    await page.screenshot({ path: path.join(SHOTS, `splash-${name}.png`) });
    if (s.exists && s.nw === 1080) ok(`S1-${name}`, `整图加载成功 1080x1920（实际 ${s.nw}）`);
    else no(`S1-${name}`, `图未就绪 nw=${s.nw}`);
    if (s.brandDisplay === 'none') ok(`S1-${name}b`, `.sp-brand 正常态隐藏（display:none）⇒ 不会出现两套字标`);
    else no(`S1-${name}b`, `.sp-brand display=${s.brandDisplay}，应为 none`);
    if (s.bg === 'rgb(14, 55, 57)') ok(`S1-${name}c`, `底色 = rgb(14,55,57) 与图内实测色一致（contain 补色无缝）`);
    else no(`S1-${name}c`, `底色 = ${s.bg}，应为 rgb(14, 55, 57)`);
    if (s.box && s.box.h <= vp.height + 1 && s.box.w <= vp.width + 1) ok(`S1-${name}d`, `图盒 ${s.box.w}x${s.box.h} 未超出视口 ${s.vw}x${s.vh}（contain 不裁切）`);
    else no(`S1-${name}d`, `图盒 ${JSON.stringify(s.box)} 超出视口`);
    if (s.docOverflow <= 0) ok(`S1-${name}e`, `无横向溢出（scrollWidth-clientWidth=${s.docOverflow}）`);
    else no(`S1-${name}e`, `横向溢出 ${s.docOverflow}px`);
    info(`${name} 截图 → shots/splash-${name}.png`);
    await ctx.close();
  }

  /* ═══ S2 真页面 · 图正常 ═══ */
  console.log('\n\u2500\u2500 S2 真页面（图正常）\u2500\u2500');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const r = await withPage(ctx, base, async (page) => {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);
      const early = await page.evaluate(SNAP);
      await page.waitForTimeout(2200);
      const tl = await page.evaluate(() => window.__sl);
      const after = await page.evaluate(SNAP);
      return { early, tl, after };
    });
    if (r.early.exists && r.early.src && r.early.src.indexOf('assets/splash/a8_9x16.webp') > -1)
      ok('S2-1', `开屏图源 = ${r.early.src}（已从 nono-splash 换成满版开屏图）`);
    else no('S2-1', `开屏图源异常：${r.early && r.early.src}`);
    if (r.early.src && r.early.src.indexOf('nono-splash') > -1) no('S2-2', '开屏仍在用旧的 nono-splash.webp');
    else ok('S2-2', '开屏不再引用 nono-splash.webp（该素材仅保留给「展开全身」）');
    if (r.early.brandDisplay === 'none') ok('S2-3', '.sp-brand 隐藏');
    else no('S2-3', `.sp-brand display=${r.early.brandDisplay}`);
    if (r.after.exists === false) ok('S2-4', `开屏最终被移除（hide@${r.tl.hide}ms / gone@${r.tl.gone}ms）⇒ 不黏屏`);
    else no('S2-4', '开屏 2.2s 后仍在 DOM 里');
    if (r.tl.hide != null && r.tl.hide >= 350 && r.tl.hide <= 1000) ok('S2-5', `淡出时刻 ${r.tl.hide}ms ∈[350,1000]（图已缓存时≈420ms，与旧版一致）`);
    else no('S2-5', `淡出时刻 ${r.tl.hide}ms 超出预期区间`);
    await ctx.close();
  }

  /* ═══ S3 真页面 · 图晚到 900ms ═══ */
  console.log('\n\u2500\u2500 S3 真页面（图延迟 900ms 到达）\u2500\u2500');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const r = await withPage(ctx, base, async (page) => {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2600);
      return { tl: await page.evaluate(() => window.__sl), after: await page.evaluate(SNAP) };
    }, { delayMs: 900 });
    if (r.tl.hide != null && r.tl.hide >= 700) ok('S3-1', `新版：图 900ms 才到 ⇒ 淡出等到 ${r.tl.hide}ms（**等图**，不会「图没出来就淡出」）`);
    else no('S3-1', `新版淡出仅 ${r.tl.hide}ms —— 没有等图，慢网下会出现空开屏`);
    if (r.after.exists === false) ok('S3-2', '最终仍正常移除');
    else no('S3-2', '开屏未移除');
    await ctx.close();
  }

  /* ═══ S4 真页面 · 图 404 ⇒ 降级 ═══ */
  console.log('\n\u2500\u2500 S4 真页面（图 404 ⇒ 降级路径）\u2500\u2500');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const r = await withPage(ctx, base, async (page) => {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(120);
      const mid = await page.evaluate(SNAP);
      await page.waitForTimeout(2200);
      return { mid, tl: await page.evaluate(() => window.__sl), after: await page.evaluate(SNAP) };
    }, { failImg: true });
    if (r.mid.cls && r.mid.cls.indexOf('sp-fallback') > -1) ok('S4-1', '图加载失败 ⇒ 加上 .sp-fallback（不整块移除，不留纯白屏）');
    else no('S4-1', `未进入降级态，class="${r.mid.cls}"`);
    if (r.mid.brandDisplay !== 'none') ok('S4-2', `降级态下 CSS 字标可见（display=${r.mid.brandDisplay}）⇒ 仍有品牌露出`);
    else no('S4-2', '降级态下字标仍被隐藏 ⇒ 开屏会是纯色空屏');
    if (r.after.exists === false) ok('S4-3', '降级后开屏仍会消失（不死锁在开屏）');
    else no('S4-3', '降级后开屏卡住未消失');
    await ctx.close();
  }

  /* ═══ S5 A/B 对照 · 基线 6e287dd（v0.23.10，不可变） ═══ */
  console.log('\n\u2500\u2500 S5 A/B 对照（基线 v0.23.10 / %s，同条件图延迟 900ms）\u2500\u2500', BASE_SHA);
  if (!baselineOk) {
    info('⏭ S5-1 / S5-2 跳过：基线不可用 —— **跳过而不是失败**（基线过期不该报红）');
  } else {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const r = await withPage(ctx, baseOld, async (page) => {
      await page.goto(baseOld + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);
      const early = await page.evaluate(SNAP);
      await page.waitForTimeout(2200);
      return { early, tl: await page.evaluate(() => window.__sl) };
    });
    if (r.early.src && r.early.src.indexOf('nono-splash') > -1)
      ok('S5-1', `旧版开屏图源 = ${r.early.src}（确认对照基线是「旧图」）`);
    else no('S5-1', `旧版对照异常，src=${r.early && r.early.src}`);
    if (r.tl.hide != null && r.tl.hide <= 640)
      ok('S5-2', `旧版固定 ${r.tl.hide}ms 淡出 ⇒ **不等图**（同一 900ms 延迟下，新版等到了 ${'≥700'}ms）`);
    else no('S5-2', `旧版淡出 ${r.tl.hide}ms，与预期「固定 420ms」不符`);
    await ctx.close();
  }

  /* ═══ S6 静态顺序闸门：首屏元素的样式必须早于元素（v0.23.12 新增） ═══
     这条对应 v0.23.11 真实出过的缺陷：`.sp-brand{display:none}` 落在 6500+ 行的样式块里，
     而开屏 div 在 1138 行 ⇒ 首帧按默认 display:block 渲染，CSS 字标闪现，
     且与满版图内自带的 LOGO 同时出现（限速实测 5.7s，其中 4.9s 两套字标并存）。
     静态顺序断言是这类缺陷最便宜的防线：跑一次 grep 就能拦住。 */
  console.log('\n\u2500\u2500 S6 首屏样式顺序（防「规则晚于元素」回归）\u2500\u2500');
  {
    const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    const elAt = html.indexOf('<div id="splash">');
    const ruleAt = html.indexOf('#splash .sp-brand{display:none');
    if (ruleAt > -1 && elAt > -1 && ruleAt < elAt)
      ok('S6-1', `.sp-brand{display:none} 位置 ${ruleAt} < 开屏 div 位置 ${elAt} ⇒ 首帧不会漏出 CSS 字标`);
    else
      no('S6-1', `规则位置 ${ruleAt} 未早于元素位置 ${elAt} ⇒ 首帧会闪现 CSS 字标（与满版图内 LOGO 同时出现）`);
    const n = (html.match(/#splash \.sp-brand\{display:none/g) || []).length;
    if (n === 1) ok('S6-2', '.sp-brand{display:none} 全局仅此一份（不会因两处失同步而静默回流）');
    else no('S6-2', `出现了 ${n} 份 —— 启动屏规则应只留 <head> 内一份`);
    const rules = [...html.matchAll(/^[^\n]*#splash[^\n]*\{[^}]*\}$/gm)].map(m => m.index);
    const late = rules.filter(i => i > elAt);
    if (!late.length) ok('S6-3', `全部 ${rules.length} 条 #splash 规则都在元素之前`);
    else no('S6-3', `有 ${late.length} 条 #splash 规则落在元素之后（首帧底色/布局会跳变）`);
  }

  await browser.close();
  A.srv.close(); B.srv.close();
  console.log('\n════════════════════════════════════');
  console.log('  合计：通过 %d / 失败 %d', pass, fail);
  console.log('════════════════════════════════════');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('探针崩溃：', e); process.exit(2); });
