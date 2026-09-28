/* 2026-09-28 审计 · i18n 差异法（同视图、同条件，只换语言）
   ❌ 前两版的问题：
      v1 用错 localStorage key（语言没切）→ 假阳性
      v2 各语言跑到不同界面（onboarding 进度不同）→ 比较不成立
   ✅ 本版：每个语言都 setLang() 后**强制 go('home')**，只扫 `#v-home` 子树，
      语言之间逐条对齐，并输出「英文原文 → 目标语言实际渲染」对照，可直接目检验伪。
   离线：断网后逐层点掉遮挡，再判主页是否真的可用（不是只看有没有 HTML）。
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://sinoky.pages.dev/';
const OUT = path.join(__dirname, '_audit_0928');
fs.mkdirSync(OUT, { recursive: true });

async function killOverlays(page) {
  for (let i = 0; i < 6; i++) {
    const done = await page.evaluate(() => {
      let hit = false;
      for (const sel of ['#lang-gate', '#splash', '.sp-skip', '#v-onboard', '#ob-skip', '.ob-skip']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) continue;
        const btn = el.querySelector('.lg-btn, button, .sp-skip, .ob-skip, [onclick]');
        if (btn) { btn.click(); hit = true; }
      }
      return hit;
    });
    if (!done) break;
    await page.waitForTimeout(600);
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/api/**', r => (r.request().method() === 'GET' && !/push-send|agg|ai-probe/.test(r.request().url()))
    ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"stub":true}' }));

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await killOverlays(page);
  await page.waitForTimeout(2000);

  /* ===== 差异法：同一视图 #v-home，只换语言 ===== */
  const perLang = {};
  for (const lang of ['en', 'es', 'th', 'zh']) {
    await page.evaluate(l => { try { setLang(l); } catch (e) {} }, lang);
    await page.waitForTimeout(900);
    /* 强制同一视图，并等渲染稳定 */
    await page.evaluate(() => { try { go('home'); } catch (e) {} });
    await page.waitForTimeout(1400);
    const r = await page.evaluate(() => {
      const root = document.querySelector('#v-home');
      if (!root) return { err: 'no #v-home', items: [] };
      const seen = new Set(), items = [];
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement; if (!p) return NodeFilter.FILTER_REJECT;
          const st = getComputedStyle(p);
          if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return NodeFilter.FILTER_REJECT;
          const t = (n.nodeValue || '').trim().replace(/\s+/g, ' ');
          if (t.length < 2 || t.length > 120) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let n;
      while ((n = walk.nextNode())) {
        const t = (n.nodeValue || '').trim().replace(/\s+/g, ' ');
        if (seen.has(t)) continue; seen.add(t); items.push(t);
      }
      return { cur: (typeof curLang === 'function' ? curLang() : '?'), count: items.length, items };
    });
    perLang[lang] = r;
  }

  /* 对齐：以 en 为基准，逐条看 es/th/zh 是否仍是英文原样（= 未翻译） */
  const base = perLang.en.items || [];
  const gaps = {};
  for (const l of ['es', 'th', 'zh']) {
    const cur = new Set(perLang[l].items || []);
    const sameAsEn = base.filter(t => cur.has(t) && /[A-Za-z]{4}/.test(t) && !/[\u4e00-\u9fff]/.test(t));
    gaps[l] = { sameCount: sameAsEn.length, baseCount: base.length, sample: sameAsEn.slice(0, 18) };
  }

  /* ===== 离线：断网 → 逐层点掉 → 判主页是否真可用 ===== */
  await page.evaluate(l => { try { setLang(l); } catch (e) {} }, 'en');
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  const offline = { docLoaded: false, hubVisible: false, navWorks: false, err: '' };
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    offline.docLoaded = true;
    await page.waitForTimeout(1500);
    await killOverlays(page);
    await page.waitForTimeout(1500);
    offline.hubVisible = await page.evaluate(() => {
      const b = document.querySelectorAll('.hub');
      return b.length > 0 && b[0].offsetHeight > 0;
    });
    offline.navWorks = await page.evaluate(() => { try { go('me'); return !!document.querySelector('#v-me.views'); } catch (e) { return 'err:' + e.message; } });
  } catch (e) { offline.err = String(e.message).slice(0, 140); }
  await ctx.setOffline(false);

  const out = { generatedAt: new Date().toISOString(), perLangCounts: Object.fromEntries(Object.entries(perLang).map(([k, v]) => [k, { cur: v.cur, count: v.count }])), gaps, offline };
  fs.writeFileSync(path.join(OUT, 'i18n_diff.json'), JSON.stringify({ ...out, enItems: base, perLang }, null, 2), 'utf8');

  console.log('=== 同一视图 #v-home 各语言文本节点数 ===');
  console.log('  ' + JSON.stringify(out.perLangCounts));
  console.log('\n=== 差异法：这些英文在目标语言下**原样未变**（=未翻译）===');
  for (const [l, g] of Object.entries(gaps)) {
    console.log('  [' + l + '] ' + g.sameCount + ' / ' + g.baseCount + ' 条未翻译');
    g.sample.forEach(s => console.log('      · ' + s));
  }
  console.log('\n=== 离线真可用性 ===');
  console.log('  ' + JSON.stringify(offline));

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
