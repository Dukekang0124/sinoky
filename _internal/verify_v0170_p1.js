/* v0.17.0 P1 验收：竖版 / 报告卡 / deep link / 尺寸切换 / 原生保存降级 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = 'D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/_internal';
const BASE = 'http://127.0.0.1:8899';
const out = [];
const ok = (n, pass, info) => out.push({ n, pass: !!pass, info: String(info) });

// 种子 A：said=9（触发报告卡门槛）、days=3
const SEED_A = {
  phrases: { arrival: [0, 1, 2, 3], chengdu: [0, 1, 2, 3, 4] },
  streak: 7, onboarded: true,
  days: ['2026-09-09', '2026-09-10', '2026-09-11'],
  tone: { right: 18, total: 20 }, rv: {}
};
// 种子 B：said=5、days=2（报告卡不该出现）
const SEED_B = {
  phrases: { arrival: [0, 1, 2], chengdu: [0, 1] },
  streak: 7, onboarded: true, days: ['2026-09-10', '2026-09-11'], tone: { right: 1, total: 2 }, rv: {}
};
const BADGES = { 'first-speak': 1, 'streak7': 1 };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // ---------- A. 主流程（种子 A）----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript(({ seed, bg }) => {
    localStorage.setItem('sinoky_state', JSON.stringify(seed));
    localStorage.setItem('sinoky_badges_on', JSON.stringify(bg));
    localStorage.setItem('sinoky_share_nick', 'Ken');
  }, { seed: SEED_A, bg: BADGES });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const reqs = [];
  page.on('request', r => reqs.push(r.url()));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 1 报告卡进入主题池（said=9）
  const poolA = await page.evaluate(() => SHARE.pool().map(p => p.id));
  ok('said>=8 时报告卡进入主题池', poolA.includes('report'), poolA.join(','));

  // 2 方图尺寸
  await page.evaluate(() => { SHARE.FMT = 'square'; SHARE.open('line'); });
  await page.waitForTimeout(400);
  const sq = await page.evaluate(() => { const c = SHARE._cv; return { w: c.width, h: c.height }; });
  ok('方图 1080×1080', sq.w === 1080 && sq.h === 1080, JSON.stringify(sq));

  // 3 竖版尺寸
  await page.evaluate(() => SHARE.setFmt('story'));
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => {
    const c = SHARE._cv, p = document.getElementById('share-panel');
    const img = document.getElementById('sp-img');
    return { w: c.width, h: c.height, hPx: Math.round(p.getBoundingClientRect().height), vh: innerHeight,
             inner: p.scrollHeight - p.clientHeight,
             imgH: img ? Math.round(img.getBoundingClientRect().height) : 0,
             on: document.querySelector('#share-panel .sp-fbtn.on') ? document.querySelector('#share-panel .sp-fbtn.on').getAttribute('data-fmt') : 'none' };
  });
  ok('竖版 1080×1920', st.w === 1080 && st.h === 1920, `${st.w}x${st.h}`);
  ok('切到竖版后按钮高亮跟随', st.on === 'story', st.on);
  ok('竖版预览高度受限(未撑破面板)', st.imgH > 0 && st.imgH < st.vh, 'imgH=' + st.imgH);
  ok('竖版下面板仍整屏放得下', st.hPx <= st.vh && st.inner <= 2, JSON.stringify({ h: st.hPx, vh: st.vh, inner: st.inner }));

  // 4 竖版零新增请求
  const b4 = reqs.length;
  await page.evaluate(() => { SHARE.setFmt('square'); SHARE.setFmt('story'); });
  await page.waitForTimeout(400);
  const add4 = reqs.slice(b4).filter(u => !u.startsWith('data:'));
  ok('切换尺寸零新增请求', add4.length === 0, add4.join(' | ') || '(none)');

  // 5 导出：五主题 × 方图 + 竖版（逐张目视）
  const themes = ['line', 'streak', 'city', 'badge', 'report'];
  const meta = {};
  for (const fmt of ['square', 'story']) {
    for (const t of themes) {
      const r = await page.evaluate(({ th, f }) => {
        SHARE.theme = th; SHARE.FMT = f;
        const c = SHARE.draw(f); SHARE._cv = c;
        return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
      }, { th: t, f: fmt });
      fs.writeFileSync(path.join(OUT, `v0170_${t}_${fmt}.png`), Buffer.from(r.url.split(',')[1], 'base64'));
      meta[`${t}_${fmt}`] = `${r.w}x${r.h}`;
    }
  }
  ok('导出 5 主题 × 2 尺寸', Object.keys(meta).length === 10, JSON.stringify(meta));

  // 6 报告卡数字必须等于真实状态（不许编造）
  const rep = await page.evaluate(() => {
    const said = SHARE.said();
    let lit = 0; try { lit = litCount(); } catch (e) {}
    return { said, streak: S.streak || 0, lit, badges: SHARE.badgeOn().length };
  });
  ok('报告卡数据源=真实状态', rep.said === 9 && rep.streak === 7 && rep.badges === 2, JSON.stringify(rep));

  // 7 分享链带 &l=（line 主题）
  const link = await page.evaluate(() => { SHARE.theme = 'line'; SHARE.code = SHARE.newCode(); return SHARE.link(); });
  ok('line 卡链接带 &l=scene:idx', /[?&]l=arrival%3A\d+/.test(link) || /[?&]l=arrival:\d+/.test(link), link);
  const linkReport = await page.evaluate(() => { SHARE.theme = 'report'; return SHARE.link(); });
  ok('非句子卡不带 &l=', !/[?&]l=/.test(linkReport), linkReport);

  // 8 面板截图（竖版 + 报告卡）
  await page.evaluate(() => { SHARE.theme = 'report'; SHARE.FMT = 'story'; SHARE.render(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'v0170_panel.png') });
  await page.evaluate(() => { SHARE.theme = 'line'; SHARE.FMT = 'square'; SHARE.render(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'v0170_panel_square.png') });

  // 9 保存：网页端无 Capacitor → 走浏览器下载分支且不抛错
  const saveOk = await page.evaluate(async () => {
    SHARE.theme = 'line';
    try { SHARE.doSave(); await new Promise(r => setTimeout(r, 500)); return true; } catch (e) { return String(e); }
  });
  ok('网页端 doSave 不抛错（走下载兜底）', saveOk === true, saveOk);

  // 10 零横向溢出
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('无横向溢出', ovf <= 0, 'overflow=' + ovf);
  ok('主流程无 JS 错误', errs.length === 0, errs.slice(0, 3).join(' | ') || '无');
  await ctx.close();

  // ---------- B. 报告卡门槛（种子 B）----------
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctxB.addInitScript((seed) => { localStorage.setItem('sinoky_state', JSON.stringify(seed)); }, SEED_B);
  const pb = await ctxB.newPage();
  await pb.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pb.waitForTimeout(2200);
  const poolB = await pb.evaluate(() => SHARE.pool().map(p => p.id));
  ok('said<8 且 days<3 时不出报告卡', !poolB.includes('report'), poolB.join(','));
  await ctxB.close();

  // ---------- C. deep link（接收者视角）----------
  const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctxC.addInitScript((seed) => {
    localStorage.setItem('sinoky_state', JSON.stringify(seed));
  }, { phrases: {}, streak: 0, onboarded: true, days: [], tone: { right: 0, total: 0 }, rv: {} });
  const pc = await ctxC.newPage();
  const cerrs = [];
  pc.on('pageerror', e => cerrs.push(e.message));
  await pc.goto(BASE + '/?s=deeplynk&t=line&l=arrival:1', { waitUntil: 'domcontentloaded' });
  await pc.waitForTimeout(3500);
  const dl = await pc.evaluate(() => {
    const el = document.getElementById('ph-1');
    const sv = document.getElementById('v-scene');
    const t = document.getElementById('toast');
    return {
      parsed: !!SHARE.pendingLine || true,
      sceneOn: sv ? sv.classList.contains('on') : false,
      curScene: (typeof curScene !== 'undefined' && curScene) ? curScene.id : null,
      phExists: !!el,
      phFocus: el ? el.classList.contains('focus') : false,
      inView: el ? (function () { const r = el.getBoundingClientRect(); return r.top > -50 && r.top < innerHeight; })() : false,
      toast: t ? t.classList.contains('show') || t.textContent : ''
    };
  });
  ok('deep link 打开对应场景', dl.sceneOn && dl.curScene === 'arrival', JSON.stringify({ sceneOn: dl.sceneOn, cur: dl.curScene }));
  ok('deep link 定位到第 2 句(#ph-1)', dl.phExists, 'phExists=' + dl.phExists);
  ok('deep link 该句高亮并进入视口', dl.phFocus && dl.inView, JSON.stringify({ focus: dl.phFocus, inView: dl.inView }));
  ok('deep link 有说明提示', String(dl.toast).length > 0, String(dl.toast).slice(0, 40));
  ok('deep link 无 JS 错误', cerrs.length === 0, cerrs.slice(0, 2).join(' | ') || '无');
  await pc.screenshot({ path: path.join(OUT, 'v0170_deeplink.png') });

  // D. 非法 deep link 不能炸
  await pc.goto(BASE + '/?l=../etc%2Fpasswd:99', { waitUntil: 'domcontentloaded' });
  await pc.waitForTimeout(2500);
  const bad = await pc.evaluate(() => ({ p: SHARE.pendingLine, home: document.getElementById('v-home') ? document.getElementById('v-home').classList.contains('on') : false }));
  ok('非法 ?l= 被拒且不跳场景', bad.p === null, JSON.stringify(bad));
  await pc.goto(BASE + '/?l=arrival:99', { waitUntil: 'domcontentloaded' });
  await pc.waitForTimeout(2200);
  const oob = await pc.evaluate(() => ({ p: SHARE.pendingLine }));
  ok('越界 idx 被拒', oob.p === null, JSON.stringify(oob));
  await ctxC.close();

  // ---------- E. 微信 UA：保存按钮仍隐藏 ----------
  const ctxW = await browser.newContext({
    viewport: { width: 390, height: 844 }, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15 MicroMessenger/8.0.40'
  });
  await ctxW.addInitScript((seed) => { localStorage.setItem('sinoky_state', JSON.stringify(seed)); }, SEED_A);
  const pw = await ctxW.newPage();
  await pw.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pw.waitForTimeout(2200);
  await pw.evaluate(() => SHARE.open('line'));
  await pw.waitForTimeout(400);
  const wxs = await pw.evaluate(() => ({
    save: getComputedStyle(document.getElementById('sp-save')).display,
    copy: getComputedStyle(document.getElementById('sp-copy')).display,
    fmt: !!document.querySelector('#share-panel .sp-fmtrow')
  }));
  ok('微信内仍隐藏保存按钮', wxs.save === 'none', JSON.stringify(wxs));
  ok('微信内尺寸切换仍可用', wxs.fmt, wxs.fmt);
  await ctxW.close();

  await browser.close();
  let fail = 0;
  console.log('\n=========== v0.17.0 P1 验收 ===========');
  for (const c of out) { if (!c.pass) fail++; console.log((c.pass ? '  PASS  ' : '  FAIL  ') + c.n + '   ' + c.info); }
  console.log('\n失败项:', fail, '/', out.length);
  process.exit(fail ? 1 : 0);
})();
