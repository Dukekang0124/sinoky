/* 通用多页截图工具（可重复使用，非一次性脚本）
 * ---------------------------------------------------------------------------
 * 用途：视觉改版后的「逐页复核」。改一次设计语言，必须能一键拿到全站每页的
 *       当期截图，而不是靠某次一次性脚本留下的过期 png 猜现状。
 *
 * 跑法：NODE_PATH=<managed node_modules> node _internal/tools/capture_pages.js [outDir] [lang]
 *   默认 outDir = _internal/fix-2026-09-23（与既有 shot-*.png 同处）
 *   默认 lang   = zh（同时验证静态 chrome 的 i18n 是否真的生效）
 *
 * 覆盖：5 个导航页 + 5 个二级页 + 攻略中心 + 对话卡 + 卡片/句子/朗读 + 开屏 + 诺诺面板
 *
 * 注意（踩过的坑）：
 *  ① 必须在仓库根起 http server —— file:// 下 fetch / SW 都不工作。
 *  ② route 是后注册优先 ⇒ 通用 mock 必须先注册，具体 mock 后注册。
 *  ③ 只 go('xxx') 不够：首页引导卡(one-time)与诺诺首访提示都会改变布局，
 *     需显式清 localStorage(sinoky_tour) 并设 S.onboarded，否则截到的不是稳态。
 *  ④ 开屏 #splash 必须手动 hide，否则每张图都是同一张开屏图。
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ⚠️ 本文件必须是 .js（CommonJS），不能是 .mjs —— 两条实测踩坑：
   「.mjs 是 ES module ⇒ 无 require / __dirname」
   「ES module 的 import 解析**不认 NODE_PATH** ⇒ Cannot find package 'playwright'」
   而 playwright 装在托管 workspace 里，只能靠 NODE_PATH 找到 ⇒ 只能走 CJS。 */

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '_internal', 'fix-2026-09-23');
const LANG = process.argv[3] || 'zh';
const PORT = 8144;
const VP = { width: 430, height: 932 };

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

function serve(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

/* 页面清单：id = go() 的参数，name = 输出文件名后缀 */
const PAGES = [
  { id: 'home', name: 'home', note: '首页（含 one-time 引导卡）' },
  { id: 'practice', name: 'practice', note: '练习页' },
  { id: 'explore', name: 'explore', note: '探索页' },
  { id: 'prog', name: 'prog', note: '进度页（徽章墙 + AI 自检）' },
  { id: 'me', name: 'me', note: '我的页' },
  { id: 'settings', name: 'settings', note: '设置页' },
  { id: 'cards', name: 'cards', note: '字卡页' },
  { id: 'sentences', name: 'sentences', note: '句子页' },
  { id: 'days', name: 'days', note: '每日页' },
  { id: 'tone', name: 'tone', note: '声调训练页' },
  { id: 'cities', name: 'cities', note: '城市列表' },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer(serve);
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: VP, deviceScaleFactor: 2 });

  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // ① 通用 mock 先注册（route 后注册优先）
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: 'mock' }) }));
  await page.route('**/*.{mp3,wav}', r => r.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' }));

  await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // ③ 稳态：清 one-time 引导、跳过 onboard、指定语言
  await page.evaluate((lang) => {
    try { localStorage.removeItem('sinoky_tour'); } catch (e) {}
    try { if (typeof S !== 'undefined') { S.onboarded = true; S.lang = lang; } } catch (e) {}
    try { if (typeof setLang === 'function') setLang(lang); } catch (e) {}
    try { const s = document.getElementById('splash'); if (s) s.classList.add('hide'); } catch (e) {}
  }, LANG);
  await page.waitForTimeout(500);

  const shot = async (name) => {
    const p = path.join(OUT, 'p1-' + name + '.png');
    await page.screenshot({ path: p, fullPage: false });
    return p;
  };

  const report = [];
  for (const pg of PAGES) {
    const ok = await page.evaluate((id) => { try { if (typeof go === 'function') { go(id); return true; } } catch (e) { return 'ERR:' + e.message; } return false; }, pg.id);
    await page.waitForTimeout(450);
    // 把滚动位置归零，保证可比性
    await page.evaluate(() => { try { window.scrollTo(0, 0); } catch (e) {} });
    await page.waitForTimeout(120);
    report.push({ ...pg, ok, file: await shot(pg.name) });
  }

  // ④ 攻略中心（二级页，需 JS 进入）
  const cg = await page.evaluate(() => { try { if (typeof openCityGuide === 'function') { openCityGuide('shanghai'); return true; } } catch (e) { return 'ERR:' + e.message; } return false; });
  await page.waitForTimeout(700);
  report.push({ id: 'cityguide', name: 'cityguide', note: '上海攻略中心', ok: cg, file: await shot('cityguide') });

  // ⑤ 攻略内展开一个分区（验证行/对话卡/短语卡）
  const zone = await page.evaluate(() => {
    try { const b = document.querySelector('#cg-zones .cg-zhead'); if (b) { b.click(); return true; } } catch (e) { return 'ERR:' + e.message; }
    return false;
  });
  await page.waitForTimeout(600);
  report.push({ id: 'cityguide-open', name: 'cityguide-open', note: '攻略分区展开态', ok: zone, file: await shot('cityguide-open') });

  // ⑥ 对话卡页
  const dg = await page.evaluate(() => { try { if (typeof openDialog === 'function' && typeof DIALOGS !== 'undefined' && DIALOGS[0]) { openDialog(DIALOGS[0].id); return true; } } catch (e) { return 'ERR:' + e.message; } return false; });
  await page.waitForTimeout(600);
  report.push({ id: 'dialog', name: 'dialog', note: '对话卡页', ok: dg, file: await shot('dialog') });

  // ⑦ 诺诺面板（浮标交互）
  await page.evaluate(() => { try { if (typeof go === 'function') go('home'); } catch (e) {} });
  await page.waitForTimeout(400);
  const np = await page.evaluate(() => { try { if (typeof nonoShow === 'function') { nonoShow(); return true; } } catch (e) { return 'ERR:' + e.message; } return false; });
  await page.waitForTimeout(700);
  report.push({ id: 'nono-panel', name: 'nono-panel', note: '诺诺面板', ok: np, file: await shot('nono-panel') });

  console.log('\nOUT = ' + OUT + '   viewport = ' + VP.width + 'x' + VP.height + '   lang = ' + LANG);
  console.log('─'.repeat(72));
  for (const r of report) {
    const st = r.ok === true ? ' ok ' : ' FAIL(' + r.ok + ')';
    console.log(' [' + st + ']  p1-' + r.name.padEnd(16) + r.note);
  }
  console.log('─'.repeat(72));
  console.log('共 ' + report.length + ' 张；页面报错 ' + errs.length + ' 条');
  if (errs.length) errs.slice(0, 8).forEach(e => console.log('   ! ' + e));

  await browser.close();
  server.close();
  process.exit(errs.length || report.some(r => r.ok !== true) ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
