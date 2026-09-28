/* 更新提示死循环修复 A/B 验证（真浏览器 + Capacitor mock + version.json mock）
   场景：
     old-apk-equal : 旧代码，App(2903)，apk 段=2903，网页=0.29.4 → 复现 bug（横幅+reload 提示）
     new-apk-equal : 新代码，同上 → 必须零打扰（无横幅/无弹窗/hint=Up to date）
     new-apk-newer : 新代码，App(2903)，apk 段=2904 → 必须弹原生 APK 更新框（更新路径活着）
     new-web       : 新代码，无 Capacitor（网页），网页=0.29.4 → 横幅照旧（网页行为不回归）
*/
const { chromium } = require('playwright');

const VJ = (apkCode) => ({
  version: '0.29.4',
  noteEn: ['test note'],
  apk: {
    versionCode: apkCode, version: apkCode >= 2904 ? '0.29.4' : '0.29.3',
    url: 'https://sinoky.pages.dev/apk/Sinoky-v0.29.4-release.apk',
    md5: 'be0df2eb81c5989e388f8b04c97b364b', size: 24210532
  }
});

const CASES = [
  { name: 'old-apk-equal', file: '/_test_old293.html', native: true,  apkCode: 2903 },
  { name: 'new-apk-equal', file: '/_test_new293.html', native: true,  apkCode: 2903 },
  { name: 'new-apk-newer', file: '/_test_new293.html', native: true,  apkCode: 2904 },
  { name: 'new-web',       file: '/_test_new293.html', native: false, apkCode: 0    },
];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = {};
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
    if (c.native) {
      await ctx.addInitScript(() => {
        window.Capacitor = {
          isNativePlatform: () => true,
          Plugins: { UpdatePlugin: { getAppVersionCode: async () => ({ value: 2903 }) } }
        };
      });
    }
    await ctx.route('**/version.json*', r =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(VJ(c.apkCode)) }));
    // 其余请求放行到本地 server；外域一律打断（避免真联网）
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 120)));
    await page.goto('http://127.0.0.1:8792' + c.file, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500); // 自动横幅链（fetch + checkApkUpdate + dialog）
    const r1 = await page.evaluate(() => {
      const bar = document.getElementById('updatebar');
      return {
        updatebarShown: !!bar && bar.style.display === 'block',
        updatebarText: bar ? bar.textContent.trim().slice(0, 60) : '(none)',
        apkDialog: !!document.querySelector('#apk-upd-ov')
      };
    });
    // settings 的 Check update 链
    const r2 = await page.evaluate(async () => {
      if (typeof checkUpdate !== 'function') return { hint: '(no fn)' };
      try { await checkUpdate(); } catch (e) { return { hint: 'ERR ' + e }; }
      const h = document.getElementById('set-updhint');
      return { hint: h ? h.textContent.trim() : '(no el)' };
    });
    results[c.name] = Object.assign({}, r1, r2, { errors: errors.slice(0, 3) });
    await ctx.close();
  }
  await browser.close();
  let fail = 0;
  const expect = {
    'old-apk-equal': { updatebarShown: true,  apkDialog: false, hintContains: 'New version available' },
    'new-apk-equal': { updatebarShown: false, apkDialog: false, hintContains: 'Up to date' },
    'new-apk-newer': { updatebarShown: false, apkDialog: true,  hintContains: 'New app version' },
    'new-web':       { updatebarShown: true,  apkDialog: false, hintContains: 'New version available' },
  };
  for (const [name, r] of Object.entries(results)) {
    const e = expect[name];
    const ok = r.updatebarShown === e.updatebarShown && r.apkDialog === e.apkDialog
      && r.hint.includes(e.hintContains) && r.errors.length === 0;
    if (!ok) fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}: banner=${r.updatebarShown} dialog=${r.apkDialog} hint="${r.hint}" errors=${r.errors.length}${r.errors.length ? ' ' + JSON.stringify(r.errors) : ''}`);
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
