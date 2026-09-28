/* live_verify_onboard.cjs — 本次「官网 4 张诺诺抠图」修复的**线上定向验收**
 *
 * 为什么不能只靠 verify_www_vs_live：
 *   那个闸门证明的是「www/ 的字节传上去了、和本地一样」，
 *   证明不了「线上的 features 页**真的引用**这些图、且**渲染正确**」。
 *   中间还隔着：HTML 里的 src 路径、CF clean-URL、以及图像能否解码。
 *   ⇒ 这里用真 Chrome 打开**线上** features 页，逐张卡片同时验三件事：
 *       ① 渲染层：naturalW/H 与渲染盒（证明解码成功、无变形）
 *       ② 字节层：浏览器实际取到的字节 md5 === 本地 www 的 md5（证明不是旧图）
 *       ③ 视觉层：元素级截图，供人工目检
 *
 * 用法：NODE_PATH=… NODE_OPTIONS=--use-system-ca node _internal/fix-2026-09-28/live_verify_onboard.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const HERE = __dirname;
const APP = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, '_live');
const LIVE = 'https://sinoky.pages.dev/landing/features.html';

/* 官网 features 页实际引用的 4 张（顺序与页面 .split 一致） */
const TARGETS = [
  { name: 'step4-score', nw: 512, nh: 512 },
  { name: 'step1-pinyin', nw: 512, nh: 512 },
  { name: 'main', nw: 800, nh: 600 },
  { name: 'step2-listen', nw: 512, nh: 512 },
];

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let fails = 0;
  const ok = (label, cond, extra = '') => {
    if (!cond) fails++;
    console.log('  ' + (cond ? '✅' : '❌') + ' ' + label + (extra ? ' — ' + extra : ''));
  };

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });

  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errs.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ': ' + r.url()); });
  /* 🔴 零生产写入：官网不发 API，但守一律照旧 */
  await page.route('**/api/**', (r) => r.abort());

  console.log('\n=== 线上官网 4 张诺诺卡片 定向验收 ===');
  console.log('  目标：' + LIVE);

  await page.goto(LIVE, { waitUntil: 'load' });

  /* 🔴 顺序坑（已固化）：loading="lazy" 必须先「滚一遍」再「等条件」，
     只等不等滚 ⇒ 图永远不加载，断言会以「naturalWidth=0」的形式假失败 */
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('img')];
    return imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, null, { timeout: 30000 });
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', null, { timeout: 15000 }).catch(() => {});

  console.log('\n  ── 逐张核验 ──');
  for (const t of TARGETS) {
    const sel = `img[src*="onboard/${t.name}.webp"]`;
    const handle = await page.$(sel);
    if (!handle) { ok(`${t.name}：页面上存在该 <img>`, false, sel); continue; }

    const box = await handle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const shot = el.closest('.shot');
      const sr = shot ? shot.getBoundingClientRect() : null;
      return {
        nw: el.naturalWidth, nh: el.naturalHeight,
        w: +r.width.toFixed(2), h: +r.height.toFixed(2),
        src: el.currentSrc || el.src,
        shotW: sr ? +sr.width.toFixed(2) : null,
        shotH: sr ? +sr.height.toFixed(2) : null,
        radius: s.borderRadius,
      };
    });

    /* ① 渲染层 */
    ok(`${t.name}：线上天然尺寸 ${box.nw}×${box.nh}`,
      box.nw === t.nw && box.nh === t.nh, `期望 ${t.nw}×${t.nh}`);
    const arNat = +(t.nw / t.nh).toFixed(4);
    const arCss = +(box.w / box.h).toFixed(4);
    ok(`${t.name}：渲染盒 ${box.w}×${box.h}，无变形（AR ${arNat} vs ${arCss}）`,
      Math.abs(arNat - arCss) < 0.01);
    ok(`${t.name}：卡片仍是 340px 上限内（.shot 宽 ${box.shotW}）`,
      box.shotW !== null && box.shotW <= 340.5);

    /* ② 字节层：浏览器真实取到的字节 vs 本地 www */
    const liveBytes = await page.evaluate(async (url) => {
      const r = await fetch(url, { cache: 'no-store' });
      const b = await r.arrayBuffer();
      return [...new Uint8Array(b)];
    }, box.src);
    const liveMd5 = md5(Buffer.from(liveBytes));
    const localMd5 = md5(fs.readFileSync(path.join(APP, 'www', 'assets', 'onboard', t.name + '.webp')));
    const oldMd5 = md5(fs.readFileSync(path.join(HERE, '_backup', t.name + '.webp')));
    ok(`${t.name}：线上字节 === 本地 www（${liveMd5.slice(0, 10)}）`, liveMd5 === localMd5,
      liveMd5 === oldMd5 ? '⚠️ 落回了旧图！' : '');

    /* ③ 视觉层 */
    if (box.shotW !== null) {
      const shotEl = await handle.evaluateHandle((el) => el.closest('.shot'));
      await shotEl.asElement().screenshot({ path: path.join(OUT, t.name + '.png') });
    }
    console.log('');
  }

  /* 整页截图（供整体风格一致性目检） */
  await page.screenshot({ path: path.join(OUT, 'features-live-full.png'), fullPage: true });

  ok('全程零 pageerror / 零 console error / 零 4xx-5xx', errs.length === 0,
    [...new Set(errs)].slice(0, 4).join(' | '));

  console.log('─'.repeat(52));
  console.log(fails === 0 ? '✅ 线上定向验收全绿 — 0 失败' : `❌ 线上定向验收 ${fails} 项失败`);
  console.log('截图：' + path.relative(APP, OUT) + '/');
  console.log('─'.repeat(52));

  await browser.close();
  process.exit(fails === 0 ? 0 : 1);
})();
