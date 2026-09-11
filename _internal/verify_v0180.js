/* v0.18.0 审计修复复验 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const OUT = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/_internal';
const BASE = 'http://127.0.0.1:8899';
const SEED = { phrases: { arrival: [0,1,2,3], chengdu: [0,1,2] }, streak: 7, onboarded: true,
  days: ['2026-09-09','2026-09-10','2026-09-11'], tone: { right: 18, total: 20 }, rv: {},
  feat: { tone: 3, cards: 2, reading: 1, sentences: 4, prog: 5 } };
const out = []; const ok = (n, p, i) => out.push({ n, pass: !!p, info: String(i == null ? '' : i) });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(s => { localStorage.setItem('sinoky_state', JSON.stringify(s)); localStorage.setItem('sinoky_lang','zh'); }, SEED);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);

  // ---------- P0-1 ----------
  await page.evaluate(() => { try{nonoMin();}catch(e){} go('review'); });
  await page.waitForTimeout(900);
  const h2 = await page.evaluate(() => {
    const h = document.querySelector('#v-review h2');
    return { t: h ? h.textContent.trim() : '', html: h ? h.innerHTML : '' };
  });
  ok('P0-1 review 标题不再是转义字面量', !/u\{1F501\}/.test(h2.t) && h2.t.indexOf('🔁') >= 0, JSON.stringify(h2));

  // ---------- P0-2 ----------
  const ovf = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth; const bad = [];
    document.querySelectorAll('.rv-acts .btn').forEach(e => { const b = e.getBoundingClientRect();
      if (b.right > vw + 1) bad.push({ t: e.textContent.trim().slice(0,10), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }); });
    return { sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0,4) };
  });
  ok('P0-2 review 无横向溢出', ovf.sw <= ovf.vw + 1, `scrollWidth=${ovf.sw} vw=${ovf.vw}`);
  ok('P0-2 🐼 按钮不再撑破', ovf.bad.length === 0, JSON.stringify(ovf.bad));
  const panda = await page.evaluate(() => { const e = document.querySelector('.rv-acts .btn:last-child'); const b = e.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) }; });
  ok('P0-2 🐼 按钮尺寸合理', panda.w > 20 && panda.w < 90, JSON.stringify(panda));

  // ---------- P0-3 Nono 气泡不跨视图残留 ----------
  await page.evaluate(() => { try{ nonoToggle(); }catch(e){} });
  await page.evaluate(() => go('cards'));
  await page.waitForTimeout(1600);
  await page.evaluate(() => go('days'));
  await page.waitForTimeout(700);
  const linger = await page.evaluate(() => { const p = document.getElementById('nono-panel');
    return p ? (getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0) : false; });
  ok('P0-3 切视图后诺诺气泡已收起', linger === false, 'visible=' + linger);

  // ---------- P0-4 徽章气泡可读名 ----------
  const badge = await page.evaluate(() => {
    localStorage.setItem('sinoky_badges_on', JSON.stringify({}));
    go('prog');
    return new Promise(res => setTimeout(() => {
      const t = (document.getElementById('nono-msg') || {}).textContent || '';
      res({ msg: t.slice(0, 120), hasId: /\b(streak3|first_city|first-speak|tone-master)\b/.test(t) });
    }, 900));
  });
  ok('P0-4 徽章气泡不含内部 ID', badge.hasId === false, badge.msg);

  // ---------- 全站：无 \u{...} 字面量 / 无横向溢出 ----------
  let leaksAll = [], ovfAll = [];
  for (const v of ['home','practice','explore','prog','me','settings','cards','sentences','reading','days','cities','tone','dialog','review']) {
    await page.evaluate(x => go(x), v);
    await page.waitForTimeout(650);
    const r = await page.evaluate(() => {
      const found = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const t = n.textContent || '';
        if (/\\u\{[0-9A-Fa-f]{4,6}\}/.test(t)) { const p = n.parentElement;
          if (p && p.closest('script,style')) continue; found.push(t.trim().slice(0,60)); } }
      return { found: found.slice(0,3), sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth };
    });
    if (r.found.length) leaksAll.push(v + ':' + r.found.join('|'));
    if (r.sw > r.vw + 1) ovfAll.push(`${v}(${r.sw}>${r.vw})`);
  }
  ok('全站零 \\u{...} 字面量泄漏', leaksAll.length === 0, leaksAll.join(' ; ') || '(none)');
  ok('全站零横向溢出', ovfAll.length === 0, ovfAll.join(' ; ') || '(none)');

  // ---------- 触控目标 ----------
  await page.evaluate(() => go('me')); await page.waitForTimeout(600);
  const tap = await page.evaluate(() => {
    const need = [['#v-me .daylink', 44], ['#v-days .daytab', 44], ['.day1-step .panda-practice', 30]];
    const res = {};
    res['days-tab'] = (() => { const e = document.querySelector('#v-days .daytab'); return e ? Math.round(e.getBoundingClientRect().height) : 0; })();
    return res;
  });
  await page.evaluate(() => go('days')); await page.waitForTimeout(700);
  const dt = await page.evaluate(() => ({ tab: Math.round((document.querySelector('.daytab')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height) }));
  ok('触控：天数切换 ≥44', dt.tab >= 44, dt.tab + 'px');

  // ---------- i18n 复验：zh 未译条数下降 ----------
  const gaps = {};
  let applyBug = {};
  for (const v of ['home','days','cities','prog','review','dialog','tone','cards','sentences']) {
    await page.evaluate(x => go(x), v);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const sc = document.querySelector('.views.on'); if (!sc) return { g: [], b: [] };
      const g = [], b = [], seen = new Set();
      const w = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const t = (n.textContent || '').replace(/\s+/g,' ').trim();
        if (t.length < 3 || !/^[A-Za-z][A-Za-z0-9 ,.'!?&:/()·\-]{2,}$/.test(t)) continue;
        const p = n.parentElement; if (!p) continue; const rr = p.getBoundingClientRect();
        if (!rr.width || !rr.height) continue; if (seen.has(t)) continue; seen.add(t);
        let tr = t; try { tr = T(t); } catch (e) {}
        if (tr && tr !== t) b.push(t); else g.push(t);
      }
      return { g, b };
    });
    r.g.forEach(x => gaps[x] = 1); r.b.forEach(x => applyBug[x] = 1);
  }
  ok('i18n：未译条数 ≤ 30（原 137）', Object.keys(gaps).length <= 30, '剩余 ' + Object.keys(gaps).length + ' 条: ' + Object.keys(gaps).slice(0, 12).join(' | '));
  ok('i18n：无「有译文未应用」', Object.keys(applyBug).length === 0, Object.keys(applyBug).join(' | '));

  // ---------- 合规：中国香港 ----------
  const hk = await page.evaluate(() => {
    const t = document.body.innerHTML;
    return { zh: (t.match(/中国香港/g) || []).length, bad: /(?<!中国)香港特别行政区/.test(t) };
  });
  await page.evaluate(() => go('cities')); await page.waitForTimeout(700);
  const hkCity = await page.evaluate(() => document.body.innerText.includes('中国香港'));
  ok('合规：城市标签为中国香港', hkCity, 'zh 出现 ' + hk.zh + ' 次');

  ok('零 JS 运行时错误', errs.length === 0, errs.slice(0,3).join(' | '));

  // 截图
  await page.evaluate(() => { try{nonoMin();}catch(e){} go('review'); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'v0180_review.png') });
  await page.evaluate(() => go('days')); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'v0180_days.png') });
  await page.evaluate(() => go('cities')); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'v0180_cities.png') });

  fs.writeFileSync(path.join(OUT, 'v0180_verify.json'), JSON.stringify(out, null, 1), 'utf8');
  const pass = out.filter(x => x.pass).length;
  console.log('\n===== v0.18.0 复验 =====');
  out.forEach(x => console.log(`  ${x.pass ? 'PASS' : 'FAIL'}  ${x.n}${x.info ? '  :: ' + x.info : ''}`));
  console.log(`\n合计 ${pass}/${out.length}`);
  await browser.close();
})();
