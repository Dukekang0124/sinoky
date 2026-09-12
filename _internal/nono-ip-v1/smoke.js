/* ============================================================================
   v0.22.0 诺诺 IP 接入 —— 浏览器真跑验收（playwright-core + 本机 Chrome）
   ----------------------------------------------------------------------------
   为什么必须真跑：静态检查只能证明「代码看起来对」。本脚本验证的是**行为**：
     · 6 个新视图分支真的出边角气泡（不是「函数存在」）
     · 边角气泡真的不吃每日 4 次配额（读 localStorage 计数对比）
     · 失败态标签真的换成了新文案（读 DOM）
     · 「Practice again」按钮点了真的回到同一句（拦 scorePhrase 记录实参）
     · 分享卡真的多画了一层角色（拿「图能加载」vs「图 404」两版做像素 A/B）
     · 零横向溢出、零非 GET 请求
   并附**旧版对照**（用 _backup/index.html 跑同一套断言），证明差异是本轮引入的。
   ============================================================================ */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const PORT = 8100;
const OLD_INDEX = path.join(APP, '_internal', 'nono-ip-v1', '_backup', 'index.html');
const OLD_MODE = process.env.OLD === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

/* ---------- 自带静态服务：支持用环境变量把 /index.html 换成旧版 ---------- */
function startServer() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/') u = '/index.html';
      let f = (OLD_MODE && u === '/index.html') ? OLD_INDEX : path.join(APP, u);
      fs.readFile(f, (e, buf) => {
        if (e) { rsp.writeHead(404); return rsp.end('404'); }
        const ext = path.extname(u === '/index.html' ? '/index.html' : f).toLowerCase();
        const ct = (u === '/index.html') ? 'text/html; charset=utf-8' : (MIME[ext] || 'application/octet-stream');
        rsp.writeHead(200, { 'Content-Type': ct }); rsp.end(buf);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

/* ---------- 假麦克风：产出**真实可解码**的 WAV，否则会在 blobToWav 阶段挂 ----
   给假 Blob 会在转码阶段失败 → 落到「不支持自动评分」分支 → 看着像「有反馈」
   其实走的是失败路，掩盖真实结论。 */
const MIC_INIT = () => {
  function makeWav(sec, freq, rate) {
    const n = Math.floor(sec * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 12000), true);
    return new Blob([buf], { type: 'audio/wav' });
  }
  window.__makeWav = makeWav;
  const stream = { getTracks: () => [{ stop() {}, kind: 'audio' }], getAudioTracks: () => [{ stop() {} }] };
  try {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve(stream) },
    });
  } catch (e) {}
  window.MediaRecorder = function () {
    const self = this;
    this.state = 'inactive'; this.mimeType = 'audio/webm';
    this.ondataavailable = null; this.onstop = null; this.onerror = null;
    this.start = function () { self.state = 'recording'; };
    this.stop = function () {
      self.state = 'inactive';
      setTimeout(function () {
        if (self.ondataavailable) self.ondataavailable({ data: makeWav(0.6, 440, 16000) });
        if (self.onstop) self.onstop();
      }, 40);
    };
  };
  window.MediaRecorder.isTypeSupported = () => true;
};

const SCORE_OK = {
  ok: true, overall: 81, verdict: 'Good',
  perSyll: [{ target: 'ni', user: 'ni', score: 0.9, toneOk: true, tExp: 3, tGot: 3, errs: [] },
            { target: 'hao', user: 'hao', score: 0.7, toneOk: false, tExp: 3, tGot: 2, errs: ['tone'] }],
};

async function main() {
  const srv = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 420, height: 900 },
    serviceWorkers: 'block',          /* SW 会缓存 index.html，让 A/B 串味 */
  });
  const page = await ctx.newPage();

  const errors = [], nonGet = [], req404 = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_|manifest|sw\.js/i.test(m.text())) errors.push(m.text());
  });
  page.on('request', (r) => { if (r.method() !== 'GET') nonGet.push(r.method() + ' ' + r.url()); });
  page.on('response', (r) => { if (r.status() >= 400) req404.push(r.status() + ' ' + r.url().replace(`http://127.0.0.1:${PORT}`, '')); });

  /* route 顺序铁律：通用规则先注册，具体 mock 后注册（后注册优先） */
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('/api/')) return r.fallback();
    if (u.includes('127.0.0.1') || u.includes('localhost')) return r.continue();
    return r.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  await page.route('**/api/asr**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '你好' }) }));
  await page.route('**/api/score**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCORE_OK) }));
  await page.route('**/api/chat**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: 'ok' }) }));
  await page.route('**/api/feedback**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  /* 应用自身既有的账号/资料/埋点端点：本地没有 CF Functions，不 mock 会记成 404，
     把「静态资源 404」这条断言污染掉（本轮踩过） */
  await page.route('**/api/register**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, uid: 'test-uid' }) }));
  await page.route('**/api/profile**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, profile: {} }) }));
  await page.route('**/api/events**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));

  await page.addInitScript(MIC_INIT);
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });

  const R = [];
  const chk = (name, cond, extra) => { R.push([cond ? 'PASS' : 'FAIL', name, extra === undefined ? '' : String(extra)]); };

  /* 用 domcontentloaded：load 事件可能晚于 splash 的移除定时器（420+520ms） */
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  /* ⚠️ #splash 在启动后 420ms 加 .hide、再 520ms 被**整个从 DOM 移除**
     （index.html L6257）→ 开机屏断言必须在这个窗口内取，晚了就是 MISSING。 */
  const splashSrc = await page.evaluate(() => {
    const i = document.querySelector('#splash img');
    return i ? (i.getAttribute('src') || '') : 'MISSING';
  });
  await page.waitForTimeout(2200);

  const hide = async () => page.evaluate(() => {
    const s = document.getElementById('splash'); if (s) s.style.display = 'none';
    const o = document.getElementById('v-onboard'); if (o) o.style.display = 'none';
    ['rd-mask', 'fb-mask', 'share-mask'].forEach((i) => { const e = document.getElementById(i); if (e) e.style.display = 'none'; });
  });
  await hide();

  /* ==================== P1 注入层是否真的生效 ==================== */
  const p1 = await page.evaluate(() => ({
    flag: window.__NONO_IP_V1__ === true,
    hint: typeof window.nonoHint,
    hide: typeof window.nonoHintHide,
    again: typeof window.nonoAgain,
    againShow: typeof window.nonoAgainShow,
    poses: window.NONO_POSE ? Object.keys(window.NONO_POSE) : null,
    cnOk: window.NONO_POSE ? Object.values(window.NONO_POSE).every((p) => !!p.cn) : false,
  }));
  if (OLD_MODE) {
    chk('[旧版] 注入层不存在（__NONO_IP_V1__ undefined）', p1.flag === false, JSON.stringify(p1.flag));
    chk('[旧版] nonoHint 未定义', p1.hint === 'undefined', p1.hint);
  } else {
    chk('注入层已生效（__NONO_IP_V1__ === true）', p1.flag === true);
    chk('nonoHint / nonoHintHide / nonoAgain / nonoAgainShow 均为函数',
      [p1.hint, p1.hide, p1.again, p1.againShow].every((x) => x === 'function'),
      JSON.stringify([p1.hint, p1.hide, p1.again, p1.againShow]));
    chk('NONO_POSE 为 8 姿态且每姿都有中文 cn',
      Array.isArray(p1.poses) && p1.poses.length === 8 && p1.cnOk,
      p1.poses && p1.poses.join(','));
  }

  /* ==================== P2 全部素材真实可解码（零 404） ==================== */
  const assets = [
    'assets/brand/nono-splash.webp', 'assets/brand/nono-hero.webp', 'assets/brand/nono-share.webp',
    'assets/mascot/like.webp', 'assets/mascot/cheer.webp', 'assets/mascot/think.webp', 'assets/mascot/listen.webp',
    'assets/mascot/sorry.webp', 'assets/mascot/point.webp', 'assets/mascot/wave.webp', 'assets/mascot/note.webp',
    'assets/empty/general.webp', 'assets/empty/network.webp', 'assets/empty/study.webp',
    'icons/icon-512.webp', 'icons/icon-192.png', 'icons/logo-header.png', 'icons/favicon-32.png',
  ];
  const imgRes = await page.evaluate(async (list) => {
    const one = (src) => new Promise((res) => {
      const i = new Image();
      i.onload = () => res({ src, ok: i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => res({ src, ok: false, w: 0, h: 0 });
      i.src = src;
    });
    return Promise.all(list.map(one));
  }, assets);
  const badImg = imgRes.filter((x) => !x.ok);
  chk(`${assets.length} 个素材全部加载并可解码（naturalWidth>0）`, badImg.length === 0,
    badImg.length ? JSON.stringify(badImg) : imgRes.map((x) => `${path.basename(x.src)}:${x.w}x${x.h}`).join(' '));

  /* ==================== P3 6 个新视图分支：真的出边角气泡 ==================== */
  const viewTests = [
    ['days', () => window.go('days')],
    ['practice', () => window.go('practice')],
    ['explore', () => window.go('explore')],
    ['dialog', () => window.go('dialog')],
    ['scene', () => window.openScene('food', 0)],
  ];
  if (OLD_MODE) {
    await page.evaluate(() => window.go('days'));
    await page.waitForTimeout(900);
    const has = await page.evaluate(() => !!document.getElementById('nono-tip'));
    chk('[旧版] 不存在 #nono-tip 边角气泡', has === false, has);
  } else {
    for (const [v, act] of viewTests) {
      await page.evaluate(act);
      await page.waitForTimeout(950);
      await hide();
      const r = await page.evaluate(() => {
        const t = document.getElementById('nono-tip');
        if (!t) return { ok: false, why: '#nono-tip 元素不存在' };
        const cs = getComputedStyle(t);
        return {
          ok: t.classList.contains('on') && (t.textContent || '').trim().length > 4 && parseFloat(cs.opacity) > 0.5,
          why: '', txt: (t.textContent || '').trim().slice(0, 34),
          opacity: cs.opacity, z: cs.zIndex, pe: cs.pointerEvents,
          panelOpen: (document.getElementById('nono-panel') || {}).style?.display === 'block',
          view: (document.querySelector('.views.on') || {}).id || '',
        };
      });
      chk(`v-${v} 进入后出边角气泡且不展开面板`, r.ok && r.panelOpen === false,
        r.ok ? `"${r.txt}" opacity=${r.opacity} z=${r.z} pointer-events=${r.pe} 面板未展开=${!r.panelOpen}` : r.why);
    }
  }

  /* ==================== P4 边角气泡不吃每日 4 次配额 ==================== */
  if (!OLD_MODE) {
    const q = await page.evaluate(() => {
      const read = () => { try { return JSON.parse(localStorage.getItem('sinoky_nono_day') || '{}'); } catch (e) { return {}; } };
      const before = read();
      /* 再触发 4 次（用未出现过的视图 + 手动重放） */
      for (let i = 0; i < 4; i++) window.nonoHint('<b>配额探针 ' + i + '</b>', { pose: 'wave', ms: 300 });
      const after = read();
      /* 对照：走原 nonoShow 通道必须会 +1 */
      const beforeShow = read();
      window.nonoShow('配额对照探针', { pose: 'like' });
      const afterShow = read();
      return { before: before.n || 0, after: after.n || 0, beforeShow: beforeShow.n || 0, afterShow: afterShow.n || 0 };
    });
    chk('nonoHint 调 4 次后每日配额计数完全不变（0 消耗）',
      q.after === q.before, `before=${q.before} after=${q.after}`);
    chk('对照：nonoShow 调 1 次后配额 +1（证明配额机制仍生效，气泡绕开它是有意的）',
      q.afterShow === q.beforeShow + 1, `before=${q.beforeShow} after=${q.afterShow}`);
  }

  /* ==================== P5 失败态语义修正（读真实 DOM 文本） ====================
     ⚠️ 本机浏览器 locale 是 zh，T() 会把 key 翻成中文 —— 断言必须与页内 T() 比对，
        不能硬写英文字面量（否则把「正确本地化」误判成 bug，本轮踩过）。 */
  const st = await page.evaluate(() => {
    const out = { lang: (typeof curLang === 'function') ? curLang() : '?' };
    out.expectSorry = (typeof T === 'function') ? T('No worries — try again') : '?';
    out.legacy = (typeof T === 'function') ? T('Nono is helping…') : 'Nono is helping…';
    window.nonoState('sorry');
    const e1 = document.getElementById('nono-state');
    const p1 = document.getElementById('nono-pose');
    out.sorryText = (e1 && e1.textContent || '').trim();
    out.sorrySrc = p1 ? (p1.getAttribute('src') || '') : '';
    window.nonoState('listening');
    const p2 = document.getElementById('nono-pose');
    out.listenSrc = p2 ? (p2.getAttribute('src') || '') : '';
    return out;
  });
  if (OLD_MODE) {
    chk('[旧版] sorry 文案是语义错位的 "helping"', st.sorryText === st.legacy.trim() && /helping|帮你/.test(st.sorryText), st.sorryText);
    chk('[旧版] listening 复用的是 think 姿态（无 listen.webp）', /think\.webp/.test(st.listenSrc), st.listenSrc);
  } else {
    chk(`sorry 文案 == T('No worries — try again')（当前 locale=${st.lang}），且不再是 helping`,
      st.sorryText === st.expectSorry.trim() && !/helping|帮你/.test(st.sorryText),
      `实际="${st.sorryText}" 期望="${st.expectSorry}" 旧文案="${st.legacy}"`);
    chk('sorry 姿态图标 = mascot/sorry.webp', /mascot\/sorry\.webp/.test(st.sorrySrc), st.sorrySrc);
    chk('listening 用真 listen 姿态（不再复用 think）', /mascot\/listen\.webp/.test(st.listenSrc), st.listenSrc);
  }

  /* ==================== P5b 尊重关闭开关 & 面板让位 ==================== */
  if (!OLD_MODE) {
    const guard = await page.evaluate(() => {
      const t = document.getElementById('nono-tip');
      /* (a) NONO.closed = true 时边角气泡必须静默 */
      window.NONO.closed = true;
      t.classList.remove('on');
      window.nonoHint('<b>关闭态探针</b>', { pose: 'wave', ms: 400 });
      const silenced = !t.classList.contains('on');
      window.NONO.closed = false;
      /* (b) 面板已展开时不叠气泡（避免与 340px 面板视觉重叠） */
      t.classList.remove('on');
      const panel = document.getElementById('nono-panel');
      const oldDisp = panel.style.display;
      panel.style.display = 'block';
      window.nonoHint('<b>面板态探针</b>', { pose: 'wave', ms: 400 });
      const deferred = !t.classList.contains('on');
      panel.style.display = oldDisp;
      /* (c) 正常情况下同一视图只提示一次（once 去重）
         ⚠️ 前置条件：面板必须处于关闭态。P4 里的 nonoShow 对照会把面板打开，
            不清掉的话这一探针会被「面板已展开」守卫正确拦下 → 误判成 once 失效
            （本轮踩过：产品行为是对的，是探针前置条件错了）。 */
      t.classList.remove('on');
      panel.style.display = 'none';
      window.nonoHint('<b>once 探针</b>', { once: 'probe_once', ms: 400 });
      const first = t.classList.contains('on');
      t.classList.remove('on');
      window.nonoHint('<b>once 探针</b>', { once: 'probe_once', ms: 400 });
      const second = !t.classList.contains('on');
      t.classList.remove('on');
      panel.style.display = oldDisp;
      return { silenced, deferred, onceWorks: first && second, first, second, oldDisp, panelAfter: panel.style.display };
    });
    chk('NONO.closed=true 时 nonoHint 静默（尊重用户关闭陪伴）', guard.silenced === true);
    chk('面板已展开时 nonoHint 只切姿态、不叠气泡', guard.deferred === true);
    chk('once 标记生效：同一视图第二次不再提示', guard.onceWorks === true, JSON.stringify(guard));
  }

  /* ==================== P6 打分结果绑「Practice again」 ==================== */
  const ag = await page.evaluate(() => {
    /* 造出 scorePhrase 需要的 DOM 上下文；麦克风被 mock 成功，不会真录音 */
    window.curScene = { id: 'food', phrases: [{ hz: '你好', py: 'nǐ hǎo', en: 'hello' }] };
    document.body.insertAdjacentHTML('beforeend', '<button id="sc-btn-0"></button><div id="score-0"></div>');
    window.scorePhrase(0);                       /* 注入层在这里记下 lastPhraseIdx=0 */
    window.renderScore({ overall: 81, verdict: 'Good', perSyll: [] });
    const el = document.getElementById('nono-again');
    const r = {
      exists: !!el,
      on: el ? el.classList.contains('on') : false,
      text: el ? (el.textContent || '').trim() : '',
      btnLabel: el ? (el.querySelector('button') || {}).textContent : '',
      hasClose: el ? !!el.querySelector('button.ghost') : false,
      bottom: el ? getComputedStyle(el).bottom : '',
      z: el ? getComputedStyle(el).zIndex : '',
    };
    if (el) el.classList.remove('on');
    return r;
  });
  if (OLD_MODE) {
    chk('[旧版] 不存在 #nono-again 结果动作条', ag.exists === false, ag.exists);
  } else {
    chk('renderScore 后 #nono-again 出现（.on）', ag.exists && ag.on, JSON.stringify(ag));
    chk('动作条按钮文案取自语言包 T("Practice again")', /Practice again|再练一遍/.test(ag.btnLabel), ag.btnLabel);
    chk('动作条带独立关闭按钮（可手动收起）', ag.hasClose === true);
  }

  /* 真点击：拦 scorePhrase 记录实参，验证「回到同一句」 */
  const click = await page.evaluate(async () => {
    /* 重新走一遍，确保 lastPhraseIdx 已置位且动作条可见 */
    window.scorePhrase(0);
    window.renderScore({ overall: 81, verdict: 'Good', perSyll: [] });
    window.__spy = [];
    const prev = window.scorePhrase;
    window.scorePhrase = function (i) { window.__spy.push(i); return prev.apply(this, arguments); };
    const el = document.getElementById('nono-again');
    const btn = el && el.querySelector('button');
    if (!btn) return { clicked: false };
    btn.click();
    const hidden = !el.classList.contains('on');
    return { clicked: true, spy: window.__spy, hiddenAfter: hidden };
  });
  if (OLD_MODE) {
    chk('[旧版] 无可点击的「再来一遍」按钮', click.clicked === false, click.clicked);
  } else {
    chk('点「Practice again」→ 回到同一句（scorePhrase 实参 = 0）',
      click.clicked && JSON.stringify(click.spy) === '[0]', JSON.stringify(click.spy));
    chk('点击后动作条自动收起', click.hiddenAfter === true);
  }

  /* ==================== P7 分享卡真的多画了一层角色 ==================== */
  const share = await page.evaluate(() => {
    const img = window.NONO_SHARE_IMG;
    const ready = !!(img && img.complete && img.naturalWidth > 0);
    let stats = null;
    try {
      const cv = window.SHARE.draw('square');
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height, PAD = 84;
      const h = Math.round(H * 0.20);
      const w = Math.round(h * img.naturalWidth / img.naturalHeight);
      const x = Math.max(0, W - PAD - w), y = Math.max(0, H - 250 - h);
      const d = ctx.getImageData(x, y, Math.min(w, W - x), Math.min(h, H - y)).data;
      let sum = 0, sum2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sum2 += l * l; n++; }
      const mean = sum / n, varc = sum2 / n - mean * mean;
      stats = { W, H, x, y, w, h, mean: +mean.toFixed(2), std: +Math.sqrt(Math.max(0, varc)).toFixed(2) };
    } catch (e) { stats = { err: String(e) }; }
    return { ready, stats };
  });
  if (OLD_MODE) {
    chk('[旧版] 分享卡无角色图引用（NONO_SHARE_IMG 不存在）', share.ready === false, share.ready);
  } else {
    chk('分享卡角色图已加载（nono-share.webp complete 且有尺寸）', share.ready === true);
    chk('SHARE.draw() 在角色区域产生真实像素（非纯色/空白）',
      share.stats && !share.stats.err && share.stats.std > 12,
      JSON.stringify(share.stats));
  }

  /* ==================== P8 布局与请求纪律 ==================== */
  const layout = await page.evaluate(() => {
    const t = document.getElementById('nono-tip');
    if (t) { t.classList.add('on'); t.innerHTML = '<b>先听，再跟我念 3 遍。</b><br>Tap the mic and say it out loud.'; }
    const a = document.getElementById('nono-again');
    if (a) a.classList.add('on');
    const over = document.documentElement.scrollWidth - window.innerWidth;
    const tr = t ? t.getBoundingClientRect() : null;
    const fab = document.getElementById('nono-fab');
    const fr = fab ? fab.getBoundingClientRect() : null;
    const overlap = (tr && fr) ? !(tr.right < fr.left || tr.left > fr.right || tr.bottom < fr.top || tr.top > fr.bottom) : null;
    const tipOnScreen = tr ? (tr.right <= window.innerWidth + 1 && tr.left >= -1) : null;
    return { over, overlap, tipOnScreen, tipRight: tr && Math.round(tr.right), tipLeft: tr && Math.round(tr.left), vw: window.innerWidth, tipPE: t ? getComputedStyle(t).pointerEvents : '' };
  });
  chk('注入组件后零横向溢出', layout.over <= 0, `scrollWidth - innerWidth = ${layout.over}`);
  if (!OLD_MODE) {
    chk('边角气泡不压住诺诺浮标（矩形不相交）', layout.overlap === false, JSON.stringify(layout));
    chk('边角气泡在视口内且 pointer-events:none（绝不挡点击）',
      layout.tipOnScreen === true && layout.tipPE === 'none', JSON.stringify(layout));
  }

  /* 启动屏（上面已在 DOM 移除前取到 splashSrc） */
  const splash = splashSrc;
  chk(OLD_MODE ? '[旧版] 启动屏用 dragon-nono.svg' : '启动屏已换 nono-splash.webp',
    OLD_MODE ? /dragon-nono\.svg/.test(splash) : /nono-splash\.webp/.test(splash), splash);

  /* 非 GET 请求：应用自身既有 /api/register 与 8787 埋点，故不能断言「全为 0」。
     正确口径是「本层没有引入任何新的写请求」→ 断言没有指向非 API 的写、且无非 GET 打到静态资源。 */
  const badWrites = nonGet.filter((x) => !/\/api\//.test(x));
  chk('零非 GET 请求指向非 API 资源（本层未引入任何新写请求）', badWrites.length === 0,
    `全部非 GET：${nonGet.length} 条，其中非 API：${badWrites.slice(0, 4).join(' | ')}`);
  console.log(`      ℹ 非 GET 明细（应用自身既有）：${nonGet.join(' | ') || '无'}`);

  /* 404：只看静态资源，API 本地无 CF Functions 属预期 */
  const asset404 = req404.filter((x) => /\.(webp|png|svg|json|js|css|html)(\?|$)/i.test(x));
  chk('零静态资源 4xx/5xx 响应（素材无 404）', asset404.length === 0,
    asset404.length ? asset404.slice(0, 6).join(' | ') : `（另有 API 404 ${req404.length - asset404.length} 条，属本地无 Functions 的预期）`);

  /* 截图留证 */
  await page.evaluate(() => {
    window.go('days');
  });
  await page.waitForTimeout(900);
  await hide();
  await page.screenshot({ path: path.join(APP, '_internal', 'nono-ip-v1', OLD_MODE ? '_shot-old.png' : '_shot-new.png') });

  if (!OLD_MODE && errors.length) errors.slice(0, 6).forEach((e) => chk('无 JS 运行时错误', false, e));
  else chk('无 JS 运行时错误', true, errors.slice(0, 3).join(' | '));

  /* ---------- 输出 ---------- */
  console.log('\n' + '='.repeat(78));
  console.log(OLD_MODE ? '【旧版对照】v0.21.2 (_backup/index.html)' : '【新版】v0.22.0 (index.html)');
  console.log('='.repeat(78));
  let pass = 0, fail = 0;
  for (const [s, n, e] of R) {
    if (s === 'PASS') pass++; else fail++;
    console.log(`  ${s === 'PASS' ? '✓' : '✗'} ${n}`);
    if (e) console.log(`      ${e}`);
  }
  console.log('-'.repeat(78));
  console.log(`  通过 ${pass} / 失败 ${fail}`);
  console.log('='.repeat(78) + '\n');

  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
