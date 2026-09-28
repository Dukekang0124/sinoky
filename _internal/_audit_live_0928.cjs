/* 2026-09-28 产品全面审计 · 线上真跑取证
   目的（三件，全部只读、零生产写入）：
     ① 真实加载指标：DOMContentLoaded / load / 传输字节 / 最大资源 / LCP
     ② 运行时健康：pageerror / console error / 4xx-5xx 响应 / 请求失败
     ③ 硬事实取证：解锁码是否出现在**公网可取的 HTML** 里；限流与限额的客户端行为
   纪律：page.route 拦掉所有 /api/* 写端点，避免污染生产 KV。
   用法：node _internal/_audit_live_0928.cjs
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://sinoky.pages.dev/';
const OUT = path.join(__dirname, '_audit_0928');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  const errors = [];
  const responses = [];
  const failed = [];
  page.on('pageerror', e => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('requestfailed', r => failed.push(r.url() + ' :: ' + (r.failure() || {}).errorText));
  page.on('response', r => { if (r.status() >= 400) responses.push(r.status() + ' ' + r.url()); });

  /* 🔴 纪律：任何写生产状态的请求一律本地拦掉，绝不污染线上数据 */
  await page.route('**/api/**', async route => {
    const u = route.request().url();
    const method = route.request().method();
    const isWrite = method === 'POST' || method === 'DELETE' || /push-send|agg|ai-probe/.test(u);
    if (isWrite) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"stub":true}' });
    return route.continue();
  });

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  const tLoad = Date.now() - t0;

  /* 三层遮挡逐层点掉（lang-gate → 开屏「先跳过」→ v-onboard） */
  const layers = [];
  for (const [name, sel] of [['lang-gate', '#lang-gate .lg-btn, #lang-gate button'],
                             ['splash-skip', '.sp-skip, #splash .skip, #sp-skip']]) {
    const el = await page.$(sel);
    if (el) { try { await el.click({ timeout: 3000 }); layers.push(name + ' 点掉'); } catch (e) { layers.push(name + ' 点击超时'); } }
  }
  await page.waitForTimeout(1500);
  const gateStill = await page.$('#lang-gate');

  /* 真实性能指标 */
  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource').map(r => ({
      n: r.name.split('/').pop().slice(0, 40), t: r.initiatorType,
      tr: r.transferSize, dec: r.decodedBodySize, d: Math.round(r.duration)
    })).filter(r => r.tr > 0).sort((a, b) => b.tr - a.tr).slice(0, 10);
    let lcp = 0;
    try { const e = performance.getEntriesByType('largest-contentful-paint'); if (e.length) lcp = Math.round(e[e.length - 1].startTime); } catch (x) {}
    return {
      ttfb: Math.round(nav.responseStart || 0),
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      transfer: nav.transferSize || 0,
      decoded: nav.decodedBodySize || 0,
      lcp, top: res
    };
  });

  /* 硬事实：解锁码 / 微信号是否在公网 HTML 里（页面自身源码，非猜测） */
  const srcFacts = await page.evaluate(() => {
    const h = document.documentElement.outerHTML;
    return {
      hasUnlockCode: h.includes('sinuoqi66'),
      hasWechat: h.includes('Skkhaha456'),
      hasDoUnlockGlobal: /window\.SK\s*=/.test(h),
      unlockBtnInApp: h.includes('SK.doUnlock()'),
      quotaBlockedSentence: (h.match(/quotaBlocked\('sentence'\)/g) || []).length,
      quotaIncSentence: (h.match(/quotaInc\('sentence'\)/g) || []).length,
    };
  });

  /* 限额行为真跑：SK 是否在全局、限额函数在真实环境下的返回 */
  const quotaProbe = await page.evaluate(() => {
    try {
      if (!window.SK) return { sk: false };
      const before = { sentence: SK.quotaLeft('sentence'), score: SK.quotaLeft('score'), chat: SK.quotaLeft('chat'), tone: SK.quotaLeft('tone') };
      /* 模拟「用户今天已经开口 20 句」——写入本地计数，看闸门是否拦 */
      let blockedAfter = null;
      try {
        const k = 'sinoky_quota';
        const d = JSON.parse(localStorage.getItem(k) || '{}');
        d.used = d.used || {}; d.used.sentence = 20; d.used.score = 99;
        localStorage.setItem(k, JSON.stringify(d));
        blockedAfter = { sentence: SK.quotaBlocked('sentence'), score: SK.quotaBlocked('score') };
      } catch (e) { blockedAfter = 'err:' + e.message; }
      return { sk: true, before, blockedAfter, isUnlocked: SK.isUnlocked() };
    } catch (e) { return { sk: false, err: e.message }; }
  });

  await page.screenshot({ path: path.join(OUT, 'home.png') });

  const report = {
    generatedAt: new Date().toISOString(),
    url: BASE,
    navMs: tLoad,
    overlay: { layers, langGateStillPresent: !!gateStill },
    perf,
    srcFacts,
    quotaProbe,
    errors,
    badResponses: responses.slice(0, 20),
    failedRequests: failed.slice(0, 20),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('=== 加载耗时（实测 wall clock）===');
  console.log('  goto→load 完成：' + tLoad + ' ms');
  console.log('  TTFB ' + perf.ttfb + 'ms · DCL ' + perf.dcl + 'ms · load ' + perf.load + 'ms · LCP ' + perf.lcp + 'ms');
  console.log('  主文档 transfer ' + perf.transfer + 'B（解压后 ' + perf.decoded + 'B）');
  console.log('\n=== 最大资源 TOP10（transferSize）===');
  perf.top.forEach(r => console.log('  ' + String(r.tr).padStart(8) + 'B  ' + String(r.d).padStart(5) + 'ms  ' + r.t.padEnd(10) + ' ' + r.n));
  console.log('\n=== 遮挡层处理 ===');
  console.log('  ' + JSON.stringify(report.overlay));
  console.log('\n=== 公网 HTML 硬事实 ===');
  console.log('  ' + JSON.stringify(srcFacts, null, 2));
  console.log('\n=== 限额行为真跑 ===');
  console.log('  ' + JSON.stringify(quotaProbe, null, 2));
  console.log('\n=== 运行时健康 ===');
  console.log('  pageerror/console.error: ' + errors.length + (errors.length ? '\n    ' + errors.slice(0, 8).join('\n    ') : ''));
  console.log('  4xx/5xx 响应: ' + responses.length + (responses.length ? '\n    ' + responses.slice(0, 8).join('\n    ') : ''));
  console.log('  请求失败: ' + failed.length + (failed.length ? '\n    ' + failed.slice(0, 8).join('\n    ') : ''));

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
