/* 2026-09-28 审计 · 收尾两件（断言全部改成「不会被恒真满足」的形式）
   ① 离线真可用性：断网重载 → 逐层点掉遮挡 → 断言 hub 可见 / 视图切换真的发生
      （❌ 上一版 `!!document.querySelector('#v-me.views')` 恒真，是坏断言）
   ② 把「74 条与英文逐字相同」的串全量导出，供人工分类 UI chrome / 教学内容
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'https://sinoky.pages.dev/';
const OUT = path.join(__dirname, '_audit_0928');

async function killOverlays(page) {
  for (let i = 0; i < 8; i++) {
    const hit = await page.evaluate(() => {
      let h = false;
      const cands = [
        ['#lang-gate', '.lg-btn, button'],
        ['#splash', '.sp-skip, button'],
        ['#v-onboard', '.ob-skip, button'],
      ];
      for (const [root, btnSel] of cands) {
        const el = document.querySelector(root);
        if (!el) continue;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) continue;
        const b = el.querySelector(btnSel);
        if (b) { b.click(); h = true; }
      }
      return h;
    });
    if (!hit) break;
    await page.waitForTimeout(700);
  }
}
const vis = sel => `(() => { const e=document.querySelector('${sel}'); if(!e) return -1; const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return (s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.height>0)?r.height:0; })()`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const failedUrls = [];
  page.on('requestfailed', r => failedUrls.push(r.url().replace(BASE, '') + ' :: ' + ((r.failure() || {}).errorText || '')));
  await page.route('**/api/**', r => (r.request().method() === 'GET' && !/push-send|agg|ai-probe/.test(r.request().url()))
    ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"stub":true}' }));

  /* 在线：装好 SW + 走完引导（让状态进入 localStorage） */
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await killOverlays(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => { try { go('home'); } catch (e) {} });
  await page.waitForTimeout(1500);
  await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
  await page.evaluate(() => new Promise(r => setTimeout(r, 4000)));

  const online = await page.evaluate(new Function('return ' + vis('#v-home .hub')));
  const swInfo = await page.evaluate(async () => {
    const names = await caches.keys(); const d = {};
    for (const n of names) { const c = await caches.open(n); d[n] = (await c.keys()).length; }
    return { names, d };
  });

  /* 离线 */
  await ctx.setOffline(true);
  failedUrls.length = 0;
  const off = { docLoaded: false, hubH: null, viewSwitchWorks: false, err: '' };
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    off.docLoaded = true;
    await page.waitForTimeout(1800);
    await killOverlays(page);
    await page.waitForTimeout(1800);
    off.hubH = await page.evaluate(new Function('return ' + vis('#v-home .hub')));
    /* 真·视图切换断言：点击 Cities hub → #v-home 应当不再可见、#v-cities 可见 */
    off.viewSwitchWorks = await page.evaluate(() => {
      const before = document.querySelector('#v-home');
      let clicked = false;
      document.querySelectorAll('.hub').forEach(b => {
        if (!clicked && /Cities|城市/i.test(b.textContent || '')) { b.click(); clicked = true; }
      });
      return new Promise(res => setTimeout(() => {
        const cities = document.querySelector('#v-cities');
        const h = cities ? cities.getBoundingClientRect().height : 0;
        res({ clicked, citiesH: Math.round(h), homeStillOn: before ? before.classList.contains('on') : null });
      }, 1200));
    });
  } catch (e) { off.err = String(e.message).slice(0, 140); }
  const offFailed = [...failedUrls];
  await ctx.setOffline(false);

  /* ② 全量导出「与英文逐字相同」的串（用已有报告） */
  const rep = JSON.parse(fs.readFileSync(path.join(OUT, 'i18n_diff.json'), 'utf8'));
  const en = rep.enItems;
  const zh = new Set(rep.perLang.zh.items);
  const same = en.filter(t => zh.has(t));

  const out = { generatedAt: new Date().toISOString(), onlineHubHeight: online, swInfo, offline: off, offFailedRequests: offFailed, sameAsEnglishCount: same.length, sameAsEnglish: same };
  fs.writeFileSync(path.join(OUT, 'final_probe.json'), JSON.stringify(out, null, 2), 'utf8');

  console.log('=== ① 离线真可用性 ===');
  console.log('  在线时 #v-home .hub 高度 = ' + online + 'px');
  console.log('  SW 缓存: ' + JSON.stringify(swInfo.d));
  console.log('  断网重载: docLoaded=' + off.docLoaded + '  hub高度=' + off.hubH + 'px  err=' + (off.err || '无'));
  console.log('  视图切换: ' + JSON.stringify(off.viewSwitchWorks));
  console.log('  离线失败资源(' + offFailed.length + '): ' + offFailed.slice(0, 12).join(' | '));
  console.log('\n=== ② 与英文逐字相同、但界面语言非英文时仍未变的串（' + same.length + ' 条）===');
  same.forEach((t, i) => console.log('  ' + String(i + 1).padStart(3) + '. ' + t));

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
