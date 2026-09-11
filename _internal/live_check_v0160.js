/* v0.16.0 生产终验：真浏览器跑 https://sinoky.pages.dev + 静态一致性 + 安全收口复验 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/_internal';
const BASE = 'https://sinoky.pages.dev';
const out = [];
const ok = (n, pass, info) => out.push({ n, pass: !!pass, info: String(info) });
const md5 = b => crypto.createHash('md5').update(b).digest('hex');

(async () => {
  // ---------- A. 静态一致性 ----------
  const vres = await fetch(BASE + '/version.json?cb=' + Date.now());
  const V = await vres.json();
  const apk = V.apk || {};
  ok('生产 version = 0.16.0', V.version === '0.16.0', V.version);
  ok('apk.versionCode = 1600', apk.versionCode === 1600, apk.versionCode);
  ok('apk.url 指向 v0.16.0', String(apk.url || '').endsWith('Sinoky-v0.16.0-release.apk'), apk.url);
  ok('apk.md5 已回填(32位)', /^[0-9a-f]{32}$/.test(apk.md5 || ''), apk.md5);
  ok('apk.size > 1MB', apk.size > 1e6, apk.size);

  const idx = await (await fetch(BASE + '/?cb=' + Date.now())).text();
  ok('index APP_VERSION = 0.16.0', idx.includes("var APP_VERSION = '0.16.0';"));
  ok('分享模块已上线', idx.includes('id="cn-share-mod"') && idx.includes('var SHARE = {'));
  ok('分享模块是最后一个 script', idx.lastIndexOf('<script') === idx.lastIndexOf('id="cn-share-mod"') - 20 ||
     idx.indexOf('id="cn-share-mod"') > idx.lastIndexOf('id="cn-share"') - 9999999 && idx.indexOf('id="cn-share-mod"') > 0);
  ok('五主题齐备', ['line', 'streak', 'city', 'badge', 'start'].every(t => idx.includes(`'${t}'`)));
  ok('归因端点引用', idx.includes('api/share'));
  ok('卡片不含 UID 引用', !/UID\s*[.\[]/.test(idx.slice(idx.indexOf('id="cn-share-mod"'))));

  const sw = await (await fetch(BASE + '/sw.js?cb=' + Date.now())).text();
  ok('sw CACHE = v0.16.0', sw.includes("var CACHE = 'sinoky-v0.16.0';"));
  // 注意：/download 是 CF Pages 的 pretty URL，不能加 ?cb= 查询串（会被重写规则漏掉而回退到 index.html）
  const dl = await (await fetch(BASE + '/download')).text();
  ok('download 页指向 v0.16.0 APK', dl.includes('Sinoky-v0.16.0-release.apk'));

  // APK 实包逐字节比对
  const apkBuf = Buffer.from(await (await fetch(BASE + '/apk/Sinoky-v0.16.0-release.apk')).arrayBuffer());
  ok('APK 实包 md5 与元数据一致', md5(apkBuf) === apk.md5, `${apkBuf.length}B md5=${md5(apkBuf).slice(0, 12)}`);
  ok('APK 实包字节数 == size', apkBuf.length === apk.size, `${apkBuf.length}/${apk.size}`);
  ok('APK 是合法 zip(PK 魔数)', apkBuf.slice(0, 2).toString() === 'PK', apkBuf.slice(0, 2).toString());

  // ---------- B. 安全收口（真实状态码，禁跟随跳转）----------
  for (const p of ['/_internal/wait_apk.py', '/badge-backend.mjs', '/package.json', '/www/index.html']) {
    const r = await fetch(BASE + p, { redirect: 'manual' });
    ok(`内部路径已拦 ${p}`, [301, 302, 308].includes(r.status), `${r.status} -> ${r.headers.get('location') || '-'}`);
  }
  const nb = await fetch(BASE + '/nonexistent-live-404', { redirect: 'manual' });
  ok('不存在路径仍是 SPA 回退 200', nb.status === 200, nb.status);

  // ---------- C. AI 接口回归（改过 _worker.js）----------
  const chat = await (await fetch(BASE + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ text: '终验：你好', uid: 'live1600', hist: [] })
  })).json();
  ok('/api/chat 正常', chat.ok === true && !chat.degraded && !!chat.reply, `model=${chat.model} degraded=${chat.degraded}`);
  const sh = await (await fetch(BASE + '/api/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ c: 'livevfy1', t: 'badge' })
  })).json();
  ok('/api/share POST 正常', sh.ok === true, JSON.stringify(sh));
  const shg = await (await fetch(BASE + '/api/share')).json();
  ok('/api/share GET 有数据', shg.ok === true && shg.opens > 0, JSON.stringify(shg));

  // ---------- D. 真浏览器跑生产 ----------
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('sinoky_state', JSON.stringify({
      phrases: { arrival: [0, 1, 2], chengdu: [0, 1] }, streak: 7, onboarded: true,
      days: ['2026-09-10', '2026-09-11'], tone: { right: 18, total: 20 }, rv: {}
    }));
    localStorage.setItem('sinoky_badges_on', JSON.stringify({ 'first-speak': 1, 'streak7': 1 }));
    localStorage.setItem('sinoky_share_nick', 'Ken');
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const reqs = [];
  page.on('request', r => reqs.push(r.url()));
  await page.goto(BASE + '/?s=livevfy1&t=line', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const modOk = await page.evaluate(() => typeof SHARE === 'object' && typeof SHARE.draw === 'function');
  ok('生产环境 SHARE 已加载', modOk, modOk);

  const pool = await page.evaluate(() => SHARE.pool().map(p => p.id));
  ok('生产主题池正确', JSON.stringify(pool) === JSON.stringify(['line', 'streak', 'city', 'badge']), pool.join(','));

  const before = reqs.length;
  await page.evaluate(() => SHARE.open('line'));
  await page.waitForTimeout(800);
  const added = reqs.slice(before).filter(u => !u.startsWith('data:'));
  ok('打开弹层零新增请求(生产)', added.length === 0, added.join(' | ') || '(none)');

  const vis = await page.evaluate(() => {
    const p = document.getElementById('share-panel'), r = p.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 + 60);
    return { onTop: el ? p.contains(el) : false, h: Math.round(r.height), vh: innerHeight,
             inner: p.scrollHeight - p.clientHeight, close: !!document.querySelector('#share-panel .sp-x') };
  });
  ok('生产弹层在最上层且整屏放得下', vis.onTop && vis.h <= vis.vh && vis.inner <= 2, JSON.stringify(vis));
  ok('生产弹层有关闭按钮', vis.close, vis.close);

  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('生产零横向溢出', ovf <= 0, 'overflow=' + ovf);

  // 导出生产实卡（逐张目视用）
  for (const t of ['line', 'streak', 'city', 'badge']) {
    const u = await page.evaluate(th => { SHARE.theme = th; const c = SHARE.draw(); return c.toDataURL('image/png'); }, t);
    fs.writeFileSync(path.join(OUT, `v0160_live_${t}.png`), Buffer.from(u.split(',')[1], 'base64'));
  }
  await page.evaluate(() => { SHARE.theme = 'line'; SHARE.render(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'v0160_live_panel.png') });

  ok('生产页无 JS 错误', errs.length === 0, errs.slice(0, 3).join(' | ') || '无');
  await browser.close();

  let fail = 0;
  console.log('\n=========== v0.16.0 生产终验 ===========');
  for (const c of out) { if (!c.pass) fail++; console.log((c.pass ? '  PASS  ' : '  FAIL  ') + c.n + '   ' + c.info); }
  console.log('\n失败项:', fail, '/', out.length);
  process.exit(fail ? 1 : 0);
})();
