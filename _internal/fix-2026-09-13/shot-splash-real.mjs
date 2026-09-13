/**
 * shot-splash-real.mjs —— 拍「线上真站、非冻结」的开屏原生帧
 *
 * 为什么要这个：probe-splash-live.mjs 用「包住 remove + 钉 opacity」冻结截图，但实测
 * phone.png 与 phone-mid.png **字节完全相同（557,351 B）** ⇒ 冻结那一次没起作用，交付物其实是
 * 「淡出中途」的画面。康哥要看的是**用户打开时真正看到的那一帧**。
 *
 * ⚠️ 前两版踩的坑（留作反面教材）：
 *   ① 「goto 之后 page.evaluate 读状态 → page.screenshot」连拍：**第一次 evaluate 的往返就吃 742ms**，
 *      而开屏可见窗口只有约 870ms ⇒ 读完第一帧开屏已经没了，全部帧 has=false。
 *      **要抓短窗口内的画面，观测动作本身不能占用窗口时间。**
 *   ② 改用 CDP screencast 后判定「opacity≥0.99 且 imgNW>0」就截图：选出的帧**底部能透出下一层页面**。
 *      根因是开屏逻辑的时间基准 —— `t0` 取在**脚本执行时**（index.html:6352），若图此时还没就绪
 *      （实测 +389ms 才就绪），`go()` 在 load 时算出的等待是 `max(0, 420-389)=31ms`
 *      ⇒ **图的满不透明窗口只有 31ms**，命中的必然是两个状态之间的合成帧。
 *
 * 正解（本版）：
 *   ① **只在采样导航前后开关 screencast**，不给窗口制造负担，也少写几百个无用的帧文件；
 *   ② `Page.screencastFrame` 存成 `f<idx>-<epochMs>.png`，并另存 `splash-timeline.json`
 *      （document-start 采样器 + `performance.timeOrigin`）⇒ 帧与 DOM 状态可精确对齐；
 *   ③ **决策不做在这里** —— screencast 会发出"画了一半"的部分合成帧，时间戳判不出来。
 *      交给 `pick-splash-frame.py` 按**像素判据**挑：四条边带必须是 `#0E3739` 纯色、中央必须非纯色。
 *
 * 不装 DOM 钩子、不改样式、不拦网络、不 block Service Worker（真实用户是有 SW 的）。
 * 开屏时间窗（index.html:6351-6372）：MIN_MS=420 满不透明 → 450ms 淡出 → +520ms 移除。
 *
 * 用法：node _internal/fix-2026-09-13/shot-splash-real.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
const SITE = 'https://sinoky.pages.dev';

/** document-start 采样器：所有 DOM 访问做存在性判断 + 全部包 try/catch（探针坑②④） */
const SAMPLER = () => {
  window.__sl = { samples: [], err: [] };
  const s = () => {
    try {
      const de = document.documentElement;               // 🔴 document-start 时可能为 null
      const sp = document.getElementById('splash');
      const img = sp ? sp.querySelector('img') : null;
      const brand = sp ? sp.querySelector('.sp-brand') : null;
      window.__sl.samples.push({
        t: Math.round(performance.now()),
        has: !!sp,
        opacity: sp ? parseFloat(getComputedStyle(sp).opacity) : null,
        imgNW: img ? img.naturalWidth : 0,
        complete: img ? !!img.complete : null,
        brand: brand ? getComputedStyle(brand).display : null,
        vw: de ? de.clientWidth : null,
      });
    } catch (e) { window.__sl.err.push(String(e).slice(0, 70)); }
  };
  try { setInterval(s, 20); s(); } catch (e) { window.__sl.err.push('init:' + String(e).slice(0, 70)); }
};

async function burst(browser, label, ctxOpts, scale) {
  const dir = path.join(SHOTS, 'realfilm-' + label);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.addInitScript(SAMPLER);

  // 预热两次：第 1 次装 SW 并填缓存，第 2 次让这次导航由 SW 接管（真实用户的常态）。
  // 目的：让开屏图的 `img.complete` 在脚本执行时已为真 ⇒ 拿到完整的 420ms 满不透明窗口。
  for (let i = 0; i < 2; i++) {
    await page.goto(SITE + '/', { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2200);
  }

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.enable');
  const frames = [];
  cdp.on('Page.screencastFrame', async (ev) => {
    const ts = Math.round(ev.metadata.timestamp * 1000);
    const file = path.join(dir, 'f' + String(frames.length).padStart(3, '0') + '-' + ts + '.png');
    frames.push({ idx: frames.length, ts, file, size: 0 });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch (e) { /* 关流后失败 */ }
    try {
      fs.writeFileSync(file, Buffer.from(ev.data, 'base64'));
      frames[frames.length - 1].size = fs.statSync(file).size;
    } catch (e) { /* 忽略 */ }
  });

  const W = Math.round(ctxOpts.viewport.width * scale);
  const H = Math.round(ctxOpts.viewport.height * scale);
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: W, maxHeight: H });

  // 采样导航：不带 ?cb=（要的就是 SW 缓存命中这条真实路径）
  await page.goto(SITE + '/', { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1700);         // 覆盖 420 满不透明 + 450 淡出 + 520 移除
  await cdp.send('Page.stopScreencast').catch(() => {});
  await page.waitForTimeout(150);

  const tl = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    samples: window.__sl.samples,
    err: window.__sl.err,
    sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
  })).catch(() => null);
  await ctx.close();

  const mine = frames.filter(f => f.size > 1000);
  if (tl) {
    fs.writeFileSync(path.join(dir, 'splash-timeline.json'),
      JSON.stringify({ label, viewport: { w: W, h: H }, frames: mine, timeline: tl }, null, 2));
  }

  const S = tl ? tl.samples : [];
  const readyAtScript = S.length ? S[0].complete : null;
  const full = S.filter(s => s.has && s.imgNW > 0 && s.opacity !== null && s.opacity >= 0.99);
  const fade = S.find(s => s.has && s.opacity !== null && s.opacity < 0.99);

  console.log('\n===== %s =====', label);
  console.log('  SW 接管：%s | 脚本执行时图已 complete：%s', tl ? tl.sw : '?', readyAtScript);
  console.log('  采样 %d 条（err %d）| 有效帧 %d 张 | 画布 %dx%d', S.length, tl ? tl.err.length : -1, mine.length, W, H);
  if (full.length) console.log('  满不透明窗口：+%dms → +%dms（%dms）', full[0].t, full[full.length - 1].t, full[full.length - 1].t - full[0].t);
  if (fade) console.log('  开始淡出：+%dms', fade.t);
  if (tl && tl.err.length) console.log('  ⚠️ 采样器 error：%s', tl.err.slice(0, 3).join(' | '));
  const idx = path.join(dir, 'splash-timeline.json');
  console.log('  → 时间线 %s（%.1f KB）', path.basename(idx), fs.statSync(idx).size / 1024);
  return dir;
}

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await burst(b, 'phone', {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA,
  }, 2);
  await burst(b, 'desktop', { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }, 1);
  console.log('\n下一步：python pick-splash-frame.py');
} finally {
  await b.close();
}
