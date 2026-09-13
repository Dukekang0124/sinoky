/**
 * ab-splash-brand.mjs —— v0.23.12 开屏「字标闪现」缺陷的确定性 A/B
 *
 * 为什么要 A/B：这条缺陷只在**首帧**存在，静态检查（grep / 语法 / 对照 CSS）全绿却完全看不见。
 * 必须让「HTML 正在流式到达」这个状态可复现 —— 所以自建一个按 **8KB/30ms 分块慢吐**的
 * 本地服务（比 CDP 限速更可控），旧版 / 新版各跑一遍同一探针。
 *
 * 判据（三条，都是「用户看不看得见」）：
 *   F1 `.sp-brand` 可见时长（brand=block 且**没有** sp-fallback）→ 期望 0ms
 *   F2 「图已就绪但字标仍在」时长 —— 两套字标并存的时长 → 期望 0ms
 *   F3 是否出现过 sp-fallback（真降级态）→ 期望 false（本地图必定加载成功）
 *
 * 用法：node _internal/fix-2026-09-13/ab-splash-brand.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const SHOTS = path.join(HERE, 'shots');
const WEBP = path.join(APP, 'assets', 'splash', 'a8_9x16.webp');

const NEW_HTML = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const OLD_HTML = fs.readFileSync(path.join(HERE, '_old_index.html.bak'), 'utf8');
if (NEW_HTML === OLD_HTML) { console.log('✗ 新旧一致，A/B 无意义'); process.exit(1); }

const CHUNK = 8192, DELAY = 30;
const PAGE = { '/old': OLD_HTML, '/new': NEW_HTML };

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (PAGE[u] !== undefined) {
    const html = PAGE[u];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    let i = 0;
    const push = () => {
      if (i >= html.length) { res.end(); return; }
      res.write(html.slice(i, i + CHUNK));
      i += CHUNK;
      setTimeout(push, DELAY);
    };
    return push();
  }
  if (/\.webp$/.test(u)) {
    res.writeHead(200, { 'Content-Type': 'image/webp' });
    return res.end(fs.readFileSync(WEBP));
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(8899, '127.0.0.1', r));

const SAMPLER = () => {
  window.__b = { s: [], err: [] };
  const pump = () => {
    try {
      const sp = document.getElementById('splash');
      const br = sp ? sp.querySelector('.sp-brand') : null;
      const img = sp ? sp.querySelector('img') : null;
      window.__b.s.push({
        t: Math.round(performance.now()),
        has: !!sp,
        brand: br ? getComputedStyle(br).display : null,
        fallback: sp ? sp.classList.contains('sp-fallback') : null,
        op: sp ? parseFloat(getComputedStyle(sp).opacity) : null,
        imgNW: img ? img.naturalWidth : 0,
        bg: sp ? getComputedStyle(sp).backgroundColor : null,
      });
    } catch (e) { window.__b.err.push(String(e).slice(0, 60)); }
  };
  try { setInterval(pump, 20); pump(); } catch (e) { window.__b.err.push('init:' + String(e).slice(0, 60)); }
};

const b = await chromium.launch({ channel: 'chrome', headless: true });
const out = {};
for (const key of ['/old', '/new']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(SAMPLER);
  await page.goto('http://127.0.0.1:8899' + key, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});

  // 采到开屏移除或 15s 为止；顺手在「图就绪且字标还在」的那一刻截图留证
  let flashShot = null;
  const t0 = Date.now();
  let seen = false;                       // 🔴 必须区分「还没解析出来」和「已移除」——
  while (Date.now() - t0 < 15000) {       //    否则会在首帧就把 has=null 当成 gone 直接退场
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => {
      const sp = document.getElementById('splash');
      if (!sp) return { gone: true };
      const br = sp.querySelector('.sp-brand');
      const img = sp.querySelector('img');
      return {
        gone: false, fallback: sp.classList.contains('sp-fallback'),
        brand: br ? getComputedStyle(br).display : null,
        imgNW: img ? img.naturalWidth : 0,
      };
    }).catch(() => null);
    if (!st) continue;
    if (st.gone) { if (seen) break; else continue; }   // 未解析完 ⇒ 继续等
    seen = true;
    if (!flashShot && st.brand === 'block' && st.imgNW > 0 && st.fallback === false) {
      flashShot = path.join(SHOTS, 'ab-flash' + key.replace('/', '-') + '.png');
      await page.screenshot({ path: flashShot }).catch(() => { flashShot = null; });
    }
  }
  const tl = await page.evaluate(() => ({ s: window.__b.s, err: window.__b.err })).catch(() => null);
  await ctx.close();
  out[key] = { tl, flashShot };
}
await b.close();
server.close();

function summarize(key) {
  const { tl, flashShot } = out[key];
  if (!tl) return { key, err: '取不到时间线' };
  const S = tl.s.filter(x => x.has);
  const brandVisible = S.filter(x => x.brand === 'block' && x.fallback === false);
  const coexist = S.filter(x => x.brand === 'block' && x.fallback === false && x.imgNW > 0);
  const fb = tl.s.some(x => x.fallback === true);
  const dur = (arr) => {
    if (!arr.length) return 0;
    // 连续区段求和（采样 20ms 一条，按条数×20ms 估算，并给出首末时刻）
    return { first: arr[0].t, last: arr[arr.length - 1].t, span: arr[arr.length - 1].t - arr[0].t, n: arr.length };
  };
  const bgFirst = tl.s.find(x => x.has && x.bg);
  return {
    key, samples: tl.s.length, errCount: tl.err.length,
    F1_brandVisible: dur(brandVisible),
    F2_coexist: dur(coexist),
    F3_everFallback: fb,
    splashBgFirstSeen: bgFirst ? bgFirst.bg : null,
    flashShot: flashShot ? path.basename(flashShot) : '(无)',
  };
}

console.log('\n================ A/B 结果（同一探针，HTML 按 8KB/30ms 慢吐）================');
for (const key of ['/old', '/new']) {
  const r = summarize(key);
  console.log('\n%s', key === '/old' ? '/old  ← 修复前（线上现状 v0.23.11）' : '/new  ← 修复后（v0.23.12）');
  console.log('  采样 %s 条 | 采样器 err %s | 首帧底色 %s', r.samples, r.errCount, r.splashBgFirstSeen);
  const f1 = r.F1_brandVisible, f2 = r.F2_coexist;
  console.log('  F1 字标可见（无 sp-fallback）：%s',
    f1.span ? ('❌ ' + f1.span + 'ms（+' + f1.first + ' → +' + f1.last + '，' + f1.n + ' 条）') : '✅ 0ms');
  console.log('  F2 图已就绪 · 字标仍在（两套字标并存）：%s',
    f2.span ? ('❌ ' + f2.span + 'ms（+' + f2.first + ' → +' + f2.last + '）') : '✅ 0ms');
  console.log('  F3 出现过真降级态 sp-fallback：%s', r.F3_everFallback ? '❌ 是' : '✅ 否');
  console.log('  留证截图：%s', r.flashShot);
}
console.log('\n结论：F1/F2 期望在 /new 上为 0ms。');
