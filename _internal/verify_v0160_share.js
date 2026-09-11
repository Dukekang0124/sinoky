/* v0.16.0 分享功能 —— 真机浏览器验收
   铁律：Canvas 合成必须【看图】验收，computed style 与「不报错」都不算数。
   产出：5 个主题各导出一张真实 PNG 到 _internal/，供人工目视核对。 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app';
const OUT = path.join(APP, '_internal');
const BASE = 'http://127.0.0.1:8899';
const SEED = {
  phrases: { arrival: [0, 1, 2], chengdu: [0, 1] },
  streak: 7,
  onboarded: true,
  days: ['2026-09-10', '2026-09-11'],
  tone: { right: 18, total: 20 },
  dayDone: { 1: '2026-09-01', 2: '2026-09-02' },
  rv: {}
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
  });
  await ctx.addInitScript((seed) => {
    try {
      localStorage.setItem('sinoky_state', JSON.stringify(seed));
      localStorage.setItem('sinoky_badges_on', JSON.stringify({ 'first-speak': 1, 'streak7': 1 }));
      localStorage.setItem('sinoky_uid', 'testuid1234');
      localStorage.setItem('sinoky_onboard_done', '1');
    } catch (e) {}
  }, SEED);

  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', r => reqs.push(r.url()));
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 200)); });

  await page.goto(BASE + '/?s=testcode1&t=line', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const r = { checks: [] };
  const ok = (n, pass, info) => { r.checks.push({ n, pass: !!pass, info: String(info) }); };

  // 0 模块是否加载
  const modOk = await page.evaluate(() => typeof SHARE === 'object' && typeof SHARE.draw === 'function');
  ok('模块已加载', modOk, modOk);

  // 1 主题池（可用性过滤）
  const pool = await page.evaluate(() => SHARE.pool().map(p => p.id));
  ok('主题池 = line/streak/city/badge', JSON.stringify(pool) === JSON.stringify(['line','streak','city','badge']), pool.join(','));

  // 2 打开弹层
  await page.evaluate(() => SHARE.open('line'));
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => {
    const p = document.getElementById('share-panel');
    const img = document.getElementById('sp-img');
    return { vis: p && getComputedStyle(p).display !== 'none', src: img ? String(img.src).slice(0, 22) : 'none' };
  });
  ok('弹层可见', opened.vis, JSON.stringify(opened));
  ok('预览是 PNG dataURI', opened.src.indexOf('data:image/png;base64,') === 0, opened.src);
  // 2b 弹层必须真的在最上层（上次栽在这：弹层 display=block 但被引导页 z-index 100 盖住）
  const onTop = await page.evaluate(() => {
    const p = document.getElementById('share-panel');
    const r = p.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 + 60);
    const cover = document.getElementById('v-onboard');
    return { top: el ? (p.contains(el) ? 'panel' : (el.id || el.tagName)) : 'none',
             onboardOn: cover ? getComputedStyle(cover).display !== 'none' : false };
  });
  ok('弹层在最上层(未被引导页遮挡)', onTop.top === 'panel' && !onTop.onboardOn, JSON.stringify(onTop));
  // 2c 弹层必须整屏放得下（不靠内部滚动），且有关闭按钮
  const fit = await page.evaluate(() => {
    const p = document.getElementById('share-panel');
    const r = p.getBoundingClientRect();
    return { h: Math.round(r.height), vh: window.innerHeight,
             innerScroll: p.scrollHeight - p.clientHeight,
             close: !!document.querySelector('#share-panel .sp-x') };
  });
  ok('弹层整屏放得下(无需内部滚动)', fit.h <= fit.vh && fit.innerScroll <= 2, JSON.stringify(fit));
  ok('弹层有关闭按钮', fit.close, 'sp-x=' + fit.close);

  // 3 预览图非空白（真实像素方差）
  const variance = await page.evaluate(() => {
    const cv = SHARE._cv, ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let min = 255, max = 0, sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 997) { const v = (d[i] + d[i+1] + d[i+2]) / 3; min = Math.min(min, v); max = Math.max(max, v); sum += v; n++; }
    return { min: Math.round(min), max: Math.round(max), avg: Math.round(sum / n), w: cv.width, h: cv.height };
  });
  ok('画布 1080×1080', variance.w === 1080 && variance.h === 1080, `${variance.w}x${variance.h}`);
  ok('预览非空白(有明暗层次)', variance.max - variance.min > 60, JSON.stringify(variance));

  // 4 三个动作按钮（Android Chrome：应有 Share + Save + Copy）
  const btns = await page.evaluate(() => ({
    share: getComputedStyle(document.getElementById('sp-share')).display,
    save: getComputedStyle(document.getElementById('sp-save')).display,
    copy: getComputedStyle(document.getElementById('sp-copy')).display,
    wx: document.getElementById('sp-wx').textContent.trim()
  }));
  ok('Android: 保存图片可见', btns.save !== 'none', JSON.stringify(btns));
  ok('Android: 复制可见', btns.copy !== 'none', btns.copy);

  // 5 逐主题导出真实 PNG（人工目视用）
  const themes = ['line', 'streak', 'city', 'badge', 'start'];
  for (const t of themes) {
    const dataUrl = await page.evaluate((th) => {
      SHARE.theme = th;
      const cv = SHARE.draw(); SHARE._cv = cv;
      return cv.toDataURL('image/png');
    }, t);
    fs.writeFileSync(path.join(OUT, `v0160_card_${t}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  ok('五主题导出', true, 'v0160_card_*.png');

  // 6 弹层实拍（line 主题 + 昵称）
  await page.evaluate(() => {
    SHARE.theme = 'line';
    SHARE.setNick('Ken');
    document.getElementById('sp-nick').value = 'Ken';
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'v0160_panel.png') });
  await page.screenshot({ path: path.join(OUT, 'v0160_panel_full.png'), fullPage: true });

  // 7 昵称真的进了卡片（比较昵称前后像素差）
  const nickDiff = await page.evaluate(async () => {
    const a = SHARE.draw().toDataURL('image/png');
    localStorage.removeItem('sinoky_share_nick');
    const b = SHARE.draw().toDataURL('image/png');
    localStorage.setItem('sinoky_share_nick', 'Ken');
    return a !== b;
  });
  ok('昵称改变卡片像素', nickDiff, nickDiff);

  // 8 换一个 循环
  const swap = await page.evaluate(() => {
    SHARE.theme = 'line'; const seen = [SHARE.theme];
    for (let i = 0; i < 4; i++) { SHARE.swap(); seen.push(SHARE.theme); }
    return seen;
  });
  ok('Shuffle 循环覆盖全部可用主题', new Set(swap).size === 4, swap.join('->'));

  // 9 归因链接：含随机码、且与 UID 无关
  const link = await page.evaluate(() => { SHARE.code = SHARE.newCode(); return { link: SHARE.link(), uid: (typeof UID !== 'undefined' ? UID.slice(0, 8) : 'n/a'), code: SHARE.code }; });
  ok('链接带 ?s= 归因码', /\/\?s=[a-z0-9]{8}&t=/.test(link.link), link.link);
  ok('归因码与 UID 无关联', !link.link.includes(link.uid) && link.code !== link.uid, JSON.stringify(link));

  // 10 卡片不含隐私字段（画布上不可能出现 UID；这里校验文本模板）
  const txt = await page.evaluate(() => { SHARE.theme = 'line'; return SHARE.text(); });
  ok('分享文案不含 UID', !/testuid1234/.test(txt), txt.slice(0, 90));

  // 11 零新增网络请求（打开弹层期间不发起任何请求）
  const before = reqs.length;
  await page.evaluate(() => SHARE.open('line'));
  await page.waitForTimeout(900);
  const added = reqs.slice(before).filter(u => !u.startsWith('data:'));
  ok('打开弹层零新增请求', added.length === 0, added.join(' | ') || '(none)');

  // 12 无横向溢出
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('无横向溢出', ovf <= 0, 'overflow=' + ovf);

  // 13 微信 UA 下的兜底（新 context 模拟）
  const wxCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15 MicroMessenger/8.0.40'
  });
  await wxCtx.addInitScript((seed) => { localStorage.setItem('sinoky_state', JSON.stringify(seed)); }, SEED);
  const wxp = await wxCtx.newPage();
  await wxp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await wxp.waitForTimeout(2200);
  await wxp.evaluate(() => SHARE.open('line'));
  await wxp.waitForTimeout(500);
  const wxState = await wxp.evaluate(() => ({
    share: getComputedStyle(document.getElementById('sp-share')).display,
    save: getComputedStyle(document.getElementById('sp-save')).display,
    copy: getComputedStyle(document.getElementById('sp-copy')).display,
    hint: document.getElementById('sp-wx').textContent.trim().slice(0, 40)
  }));
  ok('微信内隐藏系统分享', wxState.share === 'none', JSON.stringify(wxState));
  ok('微信内给出长按提示', wxState.hint.length > 5, wxState.hint);
  await wxp.screenshot({ path: path.join(OUT, 'v0160_panel_wechat.png') });
  await wxCtx.close();

  // 14 新用户（零数据）→ 起点卡，不出空卡
  const newCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const np = await newCtx.newPage();
  await np.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await np.waitForTimeout(2200);
  const zero = await np.evaluate(() => { const p = SHARE.pool().map(x => x.id); SHARE.open(); return { pool: p, theme: SHARE.theme }; });
  ok('零数据用户 → 起点卡(start)', zero.pool.length === 1 && zero.pool[0] === 'start' && zero.theme === 'start', JSON.stringify(zero));
  const zeroUrl = await np.evaluate(() => { SHARE.theme = 'start'; return SHARE.draw().toDataURL('image/png'); });
  fs.writeFileSync(path.join(OUT, 'v0160_card_start_newuser.png'), Buffer.from(zeroUrl.split(',')[1], 'base64'));
  await newCtx.close();

  // 输出
  r.errors = errs;
  console.log('\n================ 验收结果 ================');
  let fail = 0;
  for (const c of r.checks) { if (!c.pass) fail++; console.log((c.pass ? '  PASS  ' : '  FAIL  ') + c.n + '   ' + c.info); }
  console.log('\n失败项:', fail);
  const noise = errs.filter(e => !/404|Failed to load resource|ERR_|net::/i.test(e));
  console.log('页面错误(已滤 404/网络):', noise.length ? noise.slice(0, 5) : '无');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
