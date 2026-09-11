/* v0.17.0 生产终验：真浏览器跑生产 + deep link 线上实测 + 静态一致性 + 安全收口复验 */
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
  const V = await (await fetch(BASE + '/version.json?cb=' + Date.now())).json();
  const apk = V.apk || {};
  ok('生产 version = 0.17.0', V.version === '0.17.0', V.version);
  ok('apk.versionCode = 1700', apk.versionCode === 1700, apk.versionCode);
  ok('apk.md5 已回填', /^[0-9a-f]{32}$/.test(apk.md5 || ''), apk.md5);
  ok('apk.size > 1MB', apk.size > 1e6, apk.size);

  const idx = await (await fetch(BASE + '/?cb=' + Date.now())).text();
  ok('index APP_VERSION = 0.17.0', idx.includes("var APP_VERSION = '0.17.0';"));
  ok('分享模块在线', idx.includes('id="cn-share-mod"') && idx.includes('var SHARE = {'));
  ok('六主题齐备(含 report)', ['line', 'streak', 'city', 'badge', 'start', 'report'].every(t => idx.includes("'" + t + "'")));
  ok('竖版参数化 draw(fmt)', idx.includes('SHARE.draw = function(fmt)'));
  ok('尺寸切换按钮', idx.includes('data-fmt="story"') && idx.includes('SHARE.setFmt'));
  ok('deep link 解析 + 播放', idx.includes('SHARE.pendingLine') && idx.includes('SHARE.playDeepLink'));
  ok('原生相册桥接调用', idx.includes('saveImageToGallery'));

  const sw = await (await fetch(BASE + '/sw.js?cb=' + Date.now())).text();
  ok('sw CACHE = v0.17.0', sw.includes("var CACHE = 'sinoky-v0.17.0';"));
  // /download 是 pretty URL；内容可能在部署后有几秒~几十秒的边缘传播时延 → 加轮询
  let dlOk = false, dlInfo = '';
  for (let i = 0; i < 12; i++) {
    const dl = await (await fetch(BASE + '/download')).text();
    dlOk = dl.includes('Sinoky-v0.17.0-release.apk');
    dlInfo = `${dl.length}B apk=${(dl.match(/Sinoky-v[\d.]+-release\.apk/) || ['无'])[0]}`;
    if (dlOk) break;
    await new Promise(r => setTimeout(r, 10000));
  }
  ok('download 指向 v0.17.0 APK', dlOk, dlInfo);

  const apkBuf = Buffer.from(await (await fetch(BASE + '/apk/Sinoky-v0.17.0-release.apk')).arrayBuffer());
  ok('APK 实包 md5 一致', md5(apkBuf) === apk.md5, `${apkBuf.length}B md5=${md5(apkBuf).slice(0, 12)}`);
  ok('APK 字节数 == size', apkBuf.length === apk.size, `${apkBuf.length}/${apk.size}`);
  ok('APK 是合法 zip', apkBuf.slice(0, 2).toString() === 'PK', apkBuf.slice(0, 2).toString());

  // ---------- B. 安全收口（真实状态码，禁跟随跳转）----------
  // 内部路径拦截：_redirects 随部署生效，边缘传播有窗口期 → 重试直到全部 302
  const INTERNAL = ['/_internal/wait_apk.py', '/_internal/v0170_report_square.png', '/badge-backend.mjs', '/package.json', '/www/index.html'];
  let states = {};
  for (let i = 0; i < 10; i++) {
    states = {};
    for (const p of INTERNAL) {
      const r = await fetch(BASE + p, { redirect: 'manual' });
      states[p] = r.status;
    }
    if (INTERNAL.every(p => [301, 302, 308].includes(states[p]))) break;
    await new Promise(r => setTimeout(r, 8000));
  }
  for (const p of INTERNAL) ok('内部路径已拦 ' + p, [301, 302, 308].includes(states[p]), String(states[p]));
  ok('不存在路径仍 200 SPA 回退', (await fetch(BASE + '/nope-v0170', { redirect: 'manual' })).status === 200);

  // ---------- C. 接口回归 ----------
  const chat = await (await fetch(BASE + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ text: '终验 v0.17.0：你好', uid: 'live1700', hist: [] })
  })).json();
  ok('/api/chat 正常', chat.ok === true && !chat.degraded, `model=${chat.model} degraded=${chat.degraded}`);
  const sh = await (await fetch(BASE + '/api/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ c: 'live170', t: 'report' })
  })).json();
  ok('/api/share POST 正常', sh.ok === true, JSON.stringify(sh));
  const shg = await (await fetch(BASE + '/api/share')).json();
  ok('/api/share GET 有数据', shg.ok === true && shg.opens > 0, JSON.stringify(shg));
  ok('/api/badges 仍正常(未被 302 打坏)', (await (await fetch(BASE + '/api/badges?uid=live1700')).text()).startsWith('{'));

  // ---------- D. 真浏览器跑生产 ----------
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('sinoky_state', JSON.stringify({
      phrases: { arrival: [0, 1, 2, 3], chengdu: [0, 1, 2, 3, 4] }, streak: 7, onboarded: true,
      days: ['2026-09-09', '2026-09-10', '2026-09-11'], tone: { right: 18, total: 20 }, rv: {}
    }));
    localStorage.setItem('sinoky_badges_on', JSON.stringify({ 'first-speak': 1, 'streak7': 1 }));
    localStorage.setItem('sinoky_share_nick', 'Ken');
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const reqs = [];
  page.on('request', r => reqs.push(r.url()));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  ok('生产 SHARE 已加载', await page.evaluate(() => typeof SHARE === 'object' && typeof SHARE.draw === 'function'));

  const pool = await page.evaluate(() => SHARE.pool().map(p => p.id));
  ok('生产主题池含 report', JSON.stringify(pool) === JSON.stringify(['line', 'streak', 'city', 'badge', 'report']), pool.join(','));

  const before = reqs.length;
  await page.evaluate(() => { SHARE.FMT = 'story'; SHARE.open('report'); });
  await page.waitForTimeout(800);
  const added = reqs.slice(before).filter(u => !u.startsWith('data:'));
  ok('生产打开竖版报告卡零新增请求', added.length === 0, added.join(' | ') || '(none)');

  const st = await page.evaluate(() => {
    const c = SHARE._cv, p = document.getElementById('share-panel'), r = p.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + 60);
    return { w: c.width, h: c.height, onTop: el ? p.contains(el) : false, panelH: Math.round(r.height),
             vh: innerHeight, inner: p.scrollHeight - p.clientHeight,
             on: document.querySelector('#share-panel .sp-fbtn.on') ? document.querySelector('#share-panel .sp-fbtn.on').getAttribute('data-fmt') : 'none' };
  });
  ok('生产竖版 1080×1920', st.w === 1080 && st.h === 1920, `${st.w}x${st.h}`);
  ok('生产面板在最上层且整屏放得下', st.onTop && st.panelH <= st.vh && st.inner <= 2, JSON.stringify(st));
  ok('生产尺寸按钮高亮跟随', st.on === 'story', st.on);

  for (const t of ['line', 'streak', 'city', 'badge', 'report']) {
    const u = await page.evaluate(({ th }) => { SHARE.theme = th; SHARE.FMT = 'story'; const c = SHARE.draw('story'); return c.toDataURL('image/png'); }, { th: t });
    fs.writeFileSync(path.join(OUT, `v0170_live_${t}_story.png`), Buffer.from(u.split(',')[1], 'base64'));
  }
  await page.evaluate(() => { SHARE.theme = 'report'; SHARE.FMT = 'story'; SHARE.render(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'v0170_live_panel.png') });
  ok('生产页无 JS 错误', errs.length === 0, errs.slice(0, 3).join(' | ') || '无');
  await ctx.close();

  // ---------- E. deep link 线上实测（接收者视角，全新设备）----------
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx2.addInitScript(() => {
    localStorage.setItem('sinoky_state', JSON.stringify({ phrases: {}, streak: 0, onboarded: true, days: [], tone: { right: 0, total: 0 }, rv: {} }));
  });
  const p2 = await ctx2.newPage();
  const e2 = [];
  p2.on('pageerror', e => e2.push(e.message));
  await p2.goto(BASE + '/?s=livedeep1&t=line&l=arrival:1', { waitUntil: 'domcontentloaded' });
  // openScene 的 .focus 只保留 2600ms，而说明提示要 1000ms 后才出现 → 分别累计，两个都拿到才停
  let sawFocus = false, toastText = '', sceneOn = false, curId = null, sawInView = false;
  for (let i = 0; i < 34; i++) {
    await p2.waitForTimeout(250);
    const r = await p2.evaluate(() => {
      const el = document.getElementById('ph-1'), sv = document.getElementById('v-scene'), t = document.getElementById('toast');
      return { sceneOn: sv ? sv.classList.contains('on') : false,
               cur: (typeof curScene !== 'undefined' && curScene) ? curScene.id : null,
               focus: el ? el.classList.contains('focus') : false,
               inView: el ? (function () { const x = el.getBoundingClientRect(); return x.top > -60 && x.top < innerHeight; })() : false,
               toast: t ? t.textContent : '' };
    });
    if (r.sceneOn) sceneOn = true;
    if (r.cur) curId = r.cur;
    if (r.focus) { sawFocus = true; sawInView = sawInView || r.inView; }
    if (r.toast && r.toast.trim()) toastText = r.toast;
    if (sawFocus && toastText) break;
  }
  const dlRes = { sceneOn: sceneOn, cur: curId, focus: sawFocus, inView: sawInView, toast: toastText };
  ok('线上 deep link 打开对应场景', dlRes.sceneOn && dlRes.cur === 'arrival', JSON.stringify({ on: dlRes.sceneOn, cur: dlRes.cur }));
  ok('线上 deep link 该句高亮且在视口', dlRes.focus && dlRes.inView, JSON.stringify({ focus: dlRes.focus, inView: dlRes.inView }));
  ok('线上 deep link 有中文说明提示', /朋友把这句话发给了你/.test(dlRes.toast), dlRes.toast.slice(0, 46));
  ok('线上 deep link 无 JS 错误', e2.length === 0, e2.slice(0, 3).join(' | ') || '无');
  await p2.screenshot({ path: path.join(OUT, 'v0170_live_deeplink.png') });
  await ctx2.close();

  await browser.close();
  let fail = 0;
  console.log('\n=========== v0.17.0 生产终验 ===========');
  for (const c of out) { if (!c.pass) fail++; console.log((c.pass ? '  PASS  ' : '  FAIL  ') + c.n + '   ' + c.info); }
  console.log('\n失败项:', fail, '/', out.length);
  process.exit(fail ? 1 : 0);
})();
