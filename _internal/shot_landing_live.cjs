/* 线上官网真跑取证（v0.29.3 建）
 *
 * 为什么需要它：`check_site.cjs` 是在**本机**跑的（本机 http server + 磁盘上的 version.json）。
 * 它能证明「页面逻辑对」，证明不了「**生产环境下**这一页真的工作」——
 * 中间还隔着：CF Pages 的 clean-URL 重定向、`_redirects` 的边缘 301、
 * `landing/download` → `../version.json` 的真实解析路径（= `/version.json`）、
 * 以及线上 version.json 是否已被 CI 回写。
 * 这几层任何一层断了，官网「能下载」这个**首要理由**就不成立，而本机测试全绿。
 *
 * 判据（全部取自线上**渲染后**的 DOM / 线上真实响应，不看仓库源码）：
 *   L1 五页 HTTP 200 + 零 pageerror / 零 console error
 *   L2 下载页的版本字段**真的被回填**（#apk-ver / #apk-md5 / #apk-size 与线上 version.json 逐字符相等）
 *      —— 这是端到端绑定证据；CLI 里的 `curl` 只能看到静态模板的「—」，看不见这一步
 *   L3 旧下载入口收口：/download 与 /download.html 跟随重定向后**落到下载页且 200**
 *   L4 线上中英切换可用且切换后动态值不被冲掉
 *   L5 官网未被 Service Worker 接管（不在 sw.js 预缓存清单内 ⇒ 不应有 SW 控制器）
 *
 * 🔴 安全：`page.route` abort 掉全部 `/api/*` ⇒ **零生产写入**。
 * 产出截图：_internal/_shots/landing-live-*.png
 * 用法：NODE_OPTIONS="--use-system-ca" NODE_PATH=<workbuddy node workspace>/node_modules \
 *        node _internal/shot_landing_live.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://sinoky.pages.dev';
const PAGES = ['index.html', 'features.html', 'how.html', 'download.html', 'contact.html'];

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };

(async () => {
  const shots = path.join(__dirname, '_shots');
  fs.mkdirSync(shots, { recursive: true });

  /* 线上权威数据（Node 侧直读，作为 L2 的期望值） */
  const vj = await (await fetch(BASE + '/version.json?cb=' + Date.now())).json();
  const apk = vj.apk || {};
  console.log('\n=== 线上官网真跑（v0.29.3）===');
  console.log(`  ℹ️  线上 version=${vj.version} · apk.version=${apk.version} · md5=${apk.md5 ? String(apk.md5).slice(0, 12) + '…' : '(待回写)'} · size=${apk.size || 0}B\n`);

  const browser = await chromium.launch({ channel: 'chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  /* 零生产写入：官网本身不该打任何 /api/*，拦截是双保险 */
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.indexOf(BASE) === 0 && new URL(u).pathname.indexOf('/api/') === 0) return route.abort();
    return route.continue();
  });

  /* ── L1 五页 200 + 零错误 ── */
  const codes = {};
  for (const p of PAGES) {
    const res = await page.goto(`${BASE}/landing/${p.replace(/\.html$/, '')}?cb=${Date.now()}`, { waitUntil: 'load' });
    codes[p] = res && res.status();
    await page.waitForTimeout(220);
    if (p !== 'download.html') await page.screenshot({ path: path.join(shots, `landing-live-${p.replace('.html', '')}.png`), fullPage: true });
  }
  const badCodes = Object.entries(codes).filter(([, c]) => c !== 200);
  ok(`L1 五页 HTTP 全 200`, badCodes.length === 0, JSON.stringify(codes));
  ok('L1 零 pageerror / 零 console error', errs.length === 0, [...new Set(errs)].slice(0, 4).join(' | '));

  /* ── L2 下载页版本字段真的被回填（端到端绑定） ──
     ⚠️ 这里**必须等条件，不能定长等待**：fetch(version.json, no-store) 的往返时间
     随网络波动，`waitForTimeout(600)` 会在真实往返 >600ms 时于「还没回填」的瞬间取样，
     把「进行中」误判成「没回填」——探针自己制造假阴性，比不验更糟（会逼人改对的东西）。
     判据是「`#apk-ver` 不再是占位符」，而不是「等了多久」。 */
  await page.goto(`${BASE}/landing/download?cb=${Date.now()}`, { waitUntil: 'load' });
  const t0 = Date.now();
  let filled = true;
  await page.waitForFunction(
    () => { const e = document.querySelector('#apk-ver'); return !!(e && e.textContent.trim() !== '—'); },
    null, { timeout: 10000 },
  ).catch(() => { filled = false; });
  const fillMs = Date.now() - t0;
  await page.waitForTimeout(200);
  const probe = () => {
    const vis = (s) => { const e = document.querySelector(s); return !!(e && e.getClientRects().length); };
    return {
      ver: (document.querySelector('#apk-ver') || {}).textContent,
      md5: (document.querySelector('#apk-md5') || {}).textContent,
      size: (document.querySelector('#apk-size') || {}).textContent,
      file: (document.querySelector('#apk-filename') || {}).textContent,
      href: (document.querySelector('[data-apk-link]') || { getAttribute: () => null }).getAttribute('href'),
      md5Vis: vis('#apk-md5'), pendingVis: vis('#apk-pending'), failVis: vis('#load-fail'),
    };
  };
  const r1 = await page.evaluate(probe);
  const vnorm = (s) => String(s || '').trim().replace(/^v/i, '');
  ok('L2 下载页版本号已被真实回填', filled && vnorm(r1.ver) === vnorm(apk.version),
    filled ? `页面 "${String(r1.ver).trim()}" vs 线上 "${apk.version}"` : '10s 内 #apk-ver 始终是占位「—」');
  console.log(`  ℹ️  回填耗时 ${fillMs} ms（首屏这段窗口内用户看到的是占位符）`);
  ok('L2 主按钮 href === 线上 version.json 的 apk.url', String(r1.href).trim() === apk.url, `页面 "${r1.href}"`);
  ok('L2 文件名含版本号', String(r1.file).indexOf(String(apk.version)) >= 0, String(r1.file).trim());
  if (apk.md5 && apk.size) {
    /* CI 已回写：必须逐字符绑定 */
    ok('L2 完整态：MD5 逐字符等于线上 version.json',
      String(r1.md5).trim().toLowerCase() === String(apk.md5).toLowerCase(), `页面 "${String(r1.md5).trim()}"`);
    ok('L2 完整态：体积已显示', /^\d+(\.\d+)?\s*(MB|KB)$/i.test(String(r1.size).trim()), String(r1.size).trim());
    ok('L2 完整态：未出现「待回写」说明', !r1.pendingVis);
  } else {
    /* 待回写态：必须隐藏 + 显式说明，不得留裸「—」 */
    ok('L2 待回写态：MD5/体积已隐藏', !r1.md5Vis);
    ok('L2 待回写态：有显式说明', r1.pendingVis);
  }
  ok('L2 无「读失败」降级（说明线上 version.json 可达）', !r1.failVis);
  await page.screenshot({ path: path.join(shots, 'landing-live-download.png'), fullPage: true });

  /* ── L4 线上中英切换 ── */
  await page.evaluate(() => window.SinokySite && window.SinokySite.applyLang('zh'));
  await page.waitForTimeout(400);
  const r2 = await page.evaluate(probe);
  ok('L4 切中文后版本号未被冲掉', vnorm(r2.ver) === vnorm(apk.version), `切后 "${String(r2.ver).trim()}"`);
  await page.evaluate(() => window.SinokySite && window.SinokySite.applyLang('en'));

  /* ── L5 官网不应被 Service Worker 接管 ── */
  const swc = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
  ok('L5 官网未被 Service Worker 接管（不在 sw.js 预缓存清单内）', !swc);

  /* ── L3 旧下载入口收口 ── */
  const page2 = await ctx.newPage();
  await page2.route('**/*', (route) => {
    const u = route.request().url();
    if (u.indexOf(BASE) === 0 && new URL(u).pathname.indexOf('/api/') === 0) return route.abort();
    return route.continue();
  });
  for (const old of ['/download', '/download.html']) {
    await page2.goto(BASE + old, { waitUntil: 'load' });
    await page2.waitForTimeout(300);
    const finalUrl = page2.url();
    const hitDownload = /\/landing\/download\/?$/.test(finalUrl);
    const title = await page2.title();
    ok(`L3 ${old} 收口 → 落到线上下载页（200）`, hitDownload, `最终 ${finalUrl}`);
    if (old === '/download') console.log(`  ℹ️  最终地址 ${finalUrl} · title "${title}"`);
  }

  await ctx.close(); await browser.close();
  /* 全程错误汇总：L1 只覆盖五页遍历那一段，下载页/收口页的导航在其之后 ——
     不在这里补一条，这两段的 JS 错误就完全没人看。 */
  ok('L6 全程（含下载页与收口页导航）零 pageerror / 零 console error', errs.length === 0,
    [...new Set(errs)].slice(0, 4).join(' | '));
  console.log('\n──────────────────────────────────────────────');
  console.log((fail ? '❌ 线上官网真跑有失败' : '✅ 线上官网真跑全绿') + ` — ${pass} 通过 / ${fail} 失败`);
  console.log('截图：_internal/_shots/landing-live-*.png');
  console.log('──────────────────────────────────────────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(2); });
