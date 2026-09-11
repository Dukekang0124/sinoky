/* v0.18.0 全面审计：逐视图走查，产出结构化问题清单 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/_internal/audit';
const BASE = 'http://127.0.0.1:8899';
fs.mkdirSync(OUT, { recursive: true });

const SEED = {
  phrases: { arrival: [0, 1, 2, 3], chengdu: [0, 1, 2, 3, 4], food: [0, 1, 2] },
  streak: 7, onboarded: true,
  days: ['2026-09-09', '2026-09-10', '2026-09-11'],
  tone: { right: 18, total: 20 }, rv: {}, feat: { tone: 3, cards: 2, reading: 1, sentences: 4, prog: 5 },
  seen: {}, nick: 'Ken'
};
const BADGES = { 'first-speak': 1, 'streak7': 1, 'tone-master': 1 };

const VIEWS = ['home', 'practice', 'explore', 'prog', 'me', 'settings', 'cards', 'sentences', 'reading', 'days', 'cities', 'tone', 'dialog', 'review'];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(({ seed, bg }) => {
    localStorage.setItem('sinoky_state', JSON.stringify(seed));
    localStorage.setItem('sinoky_badges_on', JSON.stringify(bg));
    localStorage.setItem('sinoky_lang', 'zh');
  }, { seed: SEED, bg: BADGES });

  const page = await ctx.newPage();
  const errors = [], failed = [], badResponses = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => failed.push(r.url() + ' :: ' + (r.failure() || {}).errorText));
  page.on('response', r => { if (r.status() >= 400 && !r.url().startsWith('data:')) badResponses.push(r.status() + ' ' + r.url()); });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const installed = await page.evaluate(() => ({
    T: typeof window.T, SHARE: typeof window.SHARE, S: typeof window.S, NONO: typeof window.NONO,
    keys: Object.keys(window).filter(k => /^[A-Z_]{2,}$/.test(k)).slice(0, 40)
  }));
  console.log('globals:', JSON.stringify(installed));

  const report = { views: {}, global: {} };
  const glitches = [];

  // 断点检测函数（注入页面）
  const PROBE = `(() => {
    const el = document.querySelector('section.on') || document.body;
    const out = { id: el.id || '(none)', overflowX: 0, noName: [], smallTap: [], brokenImg: [], clipped: [], eng: [], overlap: [] };
    out.overflowX = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth,
                             el.scrollWidth - el.clientWidth, 0);
    const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05; };
    // 触控目标
    el.querySelectorAll('button,a,[onclick],[role=button],input,select').forEach(e => {
      if (!vis(e)) return;
      const r = e.getBoundingClientRect();
      if (r.height < 30 || r.width < 30) out.smallTap.push({ tag: e.tagName, id: e.id || '', cls: (e.className||'').toString().slice(0,40), w: Math.round(r.width), h: Math.round(r.height), t: (e.textContent||'').trim().slice(0,24) });
    });
    // 图片加载失败
    el.querySelectorAll('img').forEach(e => { if (e.getAttribute('src') && e.complete && e.naturalWidth === 0) out.brokenImg.push(e.getAttribute('src')); });
    // 文字被裁（溢出容器）
    el.querySelectorAll('*').forEach(e => {
      if (e.children.length) return;
      const t = (e.textContent || '').trim(); if (!t) return;
      if (e.scrollWidth > e.clientWidth + 6 && getComputedStyle(e).overflow !== 'visible')
        out.clipped.push({ cls: (e.className||'').toString().slice(0,40), t: t.slice(0, 40), sw: e.scrollWidth, cw: e.clientWidth });
    });
    // 疑似未翻译英文
    const WL = /^(HSK|OK|Sinoky|Sino|Pinyin|Tone|ID|URL|App|Android|iOS|AI|PDF|v[0-9]|Nono|Line|WeChat|Qiang|Chengdu|Beijing|Shanghai|Xi|Hangzhou|Guangzhou|Shenzhen|Ken|English|Chinese|Mandarin|Story|Day|Streak|Phrases|Badges|Report|My|Share|Save|Copy|Home|Practice|Explore|Progress|Me|Size|Square)$/;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const seenT = new Set();
    let n; while ((n = walk.nextNode())) {
      const t = (n.textContent || '').trim();
      if (t.length < 3 || !/^[A-Za-z][A-Za-z0-9 ,.'!?&:/()\\-]{2,}$/.test(t)) continue;
      if (WL.test(t)) continue;
      if (/\\d{2,}/.test(t)) continue;
      if (seenT.has(t)) continue; seenT.add(t);
      const p = n.parentElement; if (!p || !vis(p)) continue;
      const tp = p.closest('[data-i18n-ok]'); if (tp) continue;
      out.eng.push(t.slice(0, 80));
    }
    return out;
  })()`;

  for (const v of VIEWS) {
    await page.evaluate(x => go(x), v);
    await page.waitForTimeout(700);
    try {
      const r = await page.evaluate(PROBE);
      report.views[v] = r;
      await page.screenshot({ path: path.join(OUT, 'view_' + v + '.png') });
    } catch (e) { report.views[v] = { err: e.message }; }
  }

  // 场景视图（需参数）
  try {
    await page.evaluate(() => openScene('arrival', 1, 'home'));
    await page.waitForTimeout(900);
    report.views['scene'] = await page.evaluate(PROBE);
    await page.screenshot({ path: path.join(OUT, 'view_scene.png') });
  } catch (e) { report.views['scene'] = { err: e.message }; }

  // 引导页视图（清 onboarded）
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(2200);
  try {
    report.views['onboard'] = await p2.evaluate(PROBE);
    await p2.screenshot({ path: path.join(OUT, 'view_onboard.png') });
  } catch (e) { report.views['onboard'] = { err: e.message }; }

  report.global = {
    errors: errors, requestFailed: failed, badResponses: badResponses, onboardErrors: errs2,
  };
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(report, null, 1), 'utf8');

  // 汇总打印
  console.log('\n===== 全局 =====');
  console.log('JS 错误:', errors.length, errors.slice(0, 8));
  console.log('请求失败:', failed.length, failed.slice(0, 8));
  console.log('HTTP>=400:', badResponses.length, [...new Set(badResponses)].slice(0, 10));
  console.log('\n===== 逐视图 =====');
  for (const [k, r] of Object.entries(report.views)) {
    if (r.err) { console.log(`\n[${k}] 探测失败: ${r.err}`); continue; }
    const flags = [];
    if (r.overflowX > 1) flags.push('横向溢出 ' + r.overflowX + 'px');
    if (r.smallTap.length) flags.push('小触控 ' + r.smallTap.length);
    if (r.brokenImg.length) flags.push('图裂 ' + r.brokenImg.length);
    if (r.clipped.length) flags.push('文字被裁 ' + r.clipped.length);
    if (r.eng.length) flags.push('疑似未译 ' + r.eng.length);
    console.log(`\n[${k}] ${flags.length ? flags.join(' | ') : 'OK'}`);
    if (r.smallTap.length) console.log('   小触控:', JSON.stringify(r.smallTap.slice(0, 6)));
    if (r.brokenImg.length) console.log('   图裂:', JSON.stringify(r.brokenImg.slice(0, 6)));
    if (r.clipped.length) console.log('   被裁:', JSON.stringify(r.clipped.slice(0, 6)));
    if (r.eng.length) console.log('   未译:', JSON.stringify(r.eng.slice(0, 12)));
  }
  await browser.close();
})();
