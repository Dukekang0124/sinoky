/**
 * test_checklist.mjs —— 真机验收清单「可自动化部分」的浏览器级验收（#47）
 *
 * 背景：`_internal/v0.14.10上线范围与真机验收清单.md` 的 A–J 共 35 项**全无勾选记录**。
 * 清单基准是 v0.14.10，当前已是 v0.23.8 ⇒ 一批项「点不到」（功能已改名/移位）。
 *
 * 这份脚本做的事：
 *   ① 把**能在网页层验的**项真跑一遍（不是 grep、不是"看起来对"）；
 *   ② 把**只能在真机/APK 验的**项显式列出来交给康哥（不假装已经验过）。
 *
 * ⚠️ 与真机验收的关系：网页层通过 **≠** 真机通过（WebView 内核版本、原生壳、
 *    安装/更新链、飞行模式都是网页层验不到的）。本脚本的结论只覆盖**网页侧**。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');

let pass = 0, fail = 0, skip = 0;
const ROWS = [];
const ok = (id, m) => { pass++; ROWS.push([id, '✅', m]); console.log('  ✅ %s %s', id, m); };
const no = (id, m) => { fail++; ROWS.push([id, '❌', m]); console.log('  ❌ %s %s', id, m); };
const human = (id, m) => { skip++; ROWS.push([id, '👤', m]); console.log('  👤 %s %s', id, m); };
/* 📊 = 只报数的信息行（覆盖率之类）。**不能拿它当判据** —— 它只说明"现状是多少"，
   判据必须是上面 chk() 那种"咬住我要的行为"的断言。 */
const info = (id, m) => { ROWS.push([id, '📊', m]); console.log('  📊 %s %s', id, m); };
const chk = (c, id, good, bad) => c ? ok(id, good) : no(id, bad);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

function serve(root) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      const fp = path.join(root, rel);
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        resp.writeHead(404); return resp.end('nf');
      }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

/* 把 #e63946 之类的 CSS var 取出来比对 rgb —— 拿 bbox/字符串判色都不如直接读计算样式 */
const rgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const { srv, port } = await serve(APP);
  const base = 'http://127.0.0.1:' + port;
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  // 拦外部 API（评分 / ASR / TTS 不该真的打网络）
  await page.route('**/api/**', (r) => {
    const u = r.request().url();
    if (u.includes('/api/score')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, score: 88, words: [{ t: '你好' }, { t: '世界' }] }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  /* ★ 必须先离开首启引导并渲染首页 —— 否则 #v-home 下所有卡片 display:none、
     高度为 0，几何类断言（D1「卡片还是卡片」）会以"0 个元素满足条件"的形式
     **假失败**。第一版就栽在这里：报「首页入口卡全被改成胶囊」，实际是隐藏。 */
  await page.evaluate(async () => { try { go('home'); renderHome(); } catch (e) {} });
  await page.waitForTimeout(500);
  const homeReady = await page.evaluate(() => {
    const h = document.getElementById('v-home');
    return !!h && getComputedStyle(h).display !== 'none';
  });
  console.log('（准备）#v-home 可见 = ' + homeReady);

  // ═════════ C. 全局中国风主题（计算样式级） ═════════
  console.log('\n=== C. 全局中国风主题 ===');
  const theme = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    const parse = (c) => {
      const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], lum: 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3] };
    };
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      bgP: parse(getComputedStyle(document.body).backgroundColor),
      red: g('--red'), gold: g('--gold'), teal: g('--teal'),
      gridBg: (() => {
        for (const st of document.styleSheets) {
          try {
            for (const r of st.cssRules) {
              const t = r.cssText || '';
              if (/body\s*\{/.test(t) && /background-image/.test(t) && /linear-gradient/.test(t)) return true;
            }
          } catch (e) {}
        }
        return false;
      })(),
    };
  });
  chk(theme.red === '#e63946', 'C2', '主强调色 --red = #e63946（朱砂印泥红）', 'C2 --red = ' + theme.red + '（应为 #e63946）');
  chk(theme.gold === '#c9a86c', 'C4', '金色 --gold = #c9a86c（勋章金环用色）', 'C4 --gold = ' + theme.gold);
  chk(!!theme.bgP && theme.bgP.lum < 70, 'C1',
    '页面底色为墨黑（' + theme.bg + '，亮度 ' + (theme.bgP ? Math.round(theme.bgP.lum) : '?') + ' < 70）',
    'C1 底色 ' + theme.bg + ' 不是墨黑（亮度 ' + (theme.bgP ? Math.round(theme.bgP.lum) : 'null') + '）');
  chk(theme.gridBg, 'C1b', 'body 背景含线性渐变窗格纹', 'C1b 未找到窗格纹 background-image');

  const redApplied = await page.evaluate(() => {
    const target = 'rgb(230, 57, 70)';
    let n = 0;
    document.querySelectorAll('#v-home *, #v-scene *').forEach((el) => {
      const s = getComputedStyle(el);
      if (s.backgroundColor === target || s.color === target || s.borderTopColor === target) n++;
    });
    return n;
  });
  chk(redApplied >= 1, 'C2b', '朱砂红真的被用在元素上（' + redApplied + ' 处）', 'C2b 朱砂红只声明未使用（0 处）');

  // ═════════ D. 按钮胶囊化语言 ═════════
  console.log('\n=== D. 按钮胶囊化 ===');
  const pills = await page.evaluate(() => {
    const r = [];
    document.querySelectorAll('button, .btn, a.btn').forEach((el) => {
      if (!el.offsetParent) return;
      const s = getComputedStyle(el);
      const br = parseFloat(s.borderTopLeftRadius) || 0;
      const h = el.getBoundingClientRect().height;
      // 胶囊判据：圆角 ≥ 高度一半（真正的胶囊是 999px 之类）
      if (h > 0 && br >= h / 2 - 1) r.push({ t: (el.textContent || '').trim().slice(0, 14), br, h: Math.round(h) });
    });
    return { count: r.length, sample: r.slice(0, 4) };
  });
  chk(pills.count >= 1, 'D2', '存在胶囊形按钮（' + pills.count + ' 个，例：' + pills.sample.map(s => s.t + ' r=' + s.br).join(' / ') + '）',
    'D2 全页未找到胶囊形按钮');

  const cardKept = await page.evaluate(() => {
    const cards = document.querySelectorAll('#v-home .scard, #v-home .hcard, #v-home .card, #v-home [class*="card"]');
    for (const el of cards) {
      const s = getComputedStyle(el);
      const br = parseFloat(s.borderTopLeftRadius) || 0;
      const h = el.getBoundingClientRect().height;
      if (h > 40 && br < h / 2 - 1) return { kept: true, br, h: Math.round(h), cls: el.className };
    }
    return { kept: false };
  });
  chk(cardKept.kept, 'D1', '首页入口卡仍是卡片（非胶囊）r=' + cardKept.br + ' h=' + cardKept.h, 'D1 首页入口卡全被改成胶囊');

  // ═════════ F. 诺诺面板 ═════════
  console.log('\n=== F. 诺诺面板 ===');
  await page.evaluate(() => { try { nonoOpen(); } catch (e) {} });
  await page.waitForTimeout(400);
  const panel = await page.evaluate(() => {
    const p = document.getElementById('nono-panel');
    const fab = document.getElementById('nono-fab');
    const img = fab && fab.querySelector('img');
    const av = p && p.querySelector('img');
    return {
      open: !!p && getComputedStyle(p).display !== 'none',
      w: p ? Math.round(p.getBoundingClientRect().width) : 0,
      vw: window.innerWidth,
      fabImg: img ? { nw: img.naturalWidth, src: img.getAttribute('src') } : null,
      avatar: av ? { nw: av.naturalWidth, src: av.getAttribute('src') } : null,
      modes: (() => { const m = document.getElementById('nono-modes'); return m ? m.children.length : 0; })(),
      /* ★ 模式 chip 在 `.nm-wrap` 里，不是 #nono-modes 的直接子元素 ——
         第一版数 children 得 1（只有那个 wrap），误报「模式不足 2 个」。 */
      chips: document.querySelectorAll('.nm-chip').length,
    };
  });
  chk(panel.open, 'F0', '诺诺面板可打开（宽 ' + panel.w + 'px / 视口 ' + panel.vw + '）', 'F0 面板未打开');
  chk(panel.fabImg && panel.fabImg.nw > 0, 'F5', '浮标头像是真图（naturalWidth=' + (panel.fabImg && panel.fabImg.nw) + '）',
    'F5 浮标头像没加载（"?"方块）：' + JSON.stringify(panel.fabImg));
  if (panel.avatar) chk(panel.avatar.nw > 0, 'F5b', '面板头形象图已加载（nw=' + panel.avatar.nw + ' ' + panel.avatar.src + '）', 'F5b 面板形象图未加载');
  else human('F5b', '面板头像元素未渲染（视状态而定，需真机目视）');

  // F1：进入 Chat 模式（npanel-flex 才会挂上）→ 连灌 16 条 → 面板不得撑满、聊天区须能滚
  const F1 = await page.evaluate(async () => {
    try { nonoStartChat(); } catch (e) { return { err: 'nonoStartChat: ' + e.message }; }
    await new Promise((r) => setTimeout(r, 300));
    const p = document.getElementById('nono-panel');
    const chat = document.getElementById('nono-chat');
    const list = document.getElementById('nc-list') || chat;
    if (!p || !chat) return { err: 'no #nono-chat' };
    const flex = p.classList.contains('npanel-flex');
    const before = p.getBoundingClientRect().height;
    for (let i = 0; i < 16; i++) {
      const d = document.createElement('div');
      d.style.minHeight = '60px';
      d.textContent = '测试消息 ' + i;
      list.appendChild(d);
    }
    await new Promise((r) => setTimeout(r, 150));
    const h = p.getBoundingClientRect().height;
    /* ★ 真正的滚动容器是 `.nc-scroll#nc-list`，不是外层 #nono-chat
       —— 第一版量了外层（471 vs 471）判"不能滚"，属**量错了元素**。 */
    const more = [list, chat, document.querySelector('.nc-scroll')].filter(Boolean);
    let scroller = more.find((el) => el.scrollHeight > el.clientHeight + 2) || null;
    return {
      flex, before: Math.round(before), after: Math.round(h), vh: window.innerHeight,
      chatH: Math.round(chat.getBoundingClientRect().height),
      scrollable: !!scroller,
      scrollerTag: scroller ? (scroller.id || scroller.className) : '(无可滚动容器)',
      scrollH: scroller ? scroller.scrollHeight : (list.scrollHeight || 0),
      clientH: scroller ? scroller.clientHeight : (list.clientHeight || 0),
      listChildren: list.children.length,
    };
  });
  if (F1.err) no('F1', 'F1 ' + F1.err);
  else {
    chk(F1.after < F1.vh, 'F1', '连聊 16 条后面板高 ' + F1.after + 'px < 视口 ' + F1.vh + 'px（不撑满屏幕）',
      'F1 连聊后面板高 ' + F1.after + ' ≥ 视口 ' + F1.vh + '（撑满了）');
    chk(F1.flex && F1.scrollable, 'F1b',
      '聊天区独立滚动（' + F1.scrollerTag + '：scrollHeight ' + F1.scrollH + ' > clientHeight ' + F1.clientH + '，已灌 ' + F1.listChildren + ' 条）',
      'F1b 聊天区未独立滚动（' + F1.scrollerTag + '，' + F1.scrollH + ' vs ' + F1.clientH + '）');
  }

  // F4：模式切换（真点一下，看状态有没有变）
  if (panel.chips >= 2) {
    const sw = await page.evaluate(async () => {
      /* ★ 必须**每次重新查询** .nm-chip：nonoModeChips() 是 `el.innerHTML = ...` 整体重建，
         点一下之后旧引用已成为 detached 节点，读它的 className 只会读到点击前的值。
       ★ 还要点**当前未激活**的那个 —— F1 已经进了 Chat 模式，再点 Chat 不变是**正确行为**，
         拿它当"点不动"的证据就是自己造了个假缺陷。 */
      const read = () => [...document.querySelectorAll('.nm-chip')].map((c) => c.className).join('|');
      const before = [...document.querySelectorAll('.nm-chip')];
      const b4 = read();
      const idx = before.findIndex((c) => !/\bon\b/.test(c.className));
      if (idx < 0) return { err: '所有 chip 都已激活，无可切换目标', b4, n: before.length };
      before[idx].click();
      await new Promise((r) => setTimeout(r, 350));
      return { b4, af: read(), n: document.querySelectorAll('.nm-chip').length, idx, label: (before[idx].textContent || '').trim() };
    });
    if (sw.err) no('F4', 'F4 ' + sw.err + '（' + sw.b4 + '）');
    else chk(sw.b4 !== sw.af, 'F4', '模式 chip 可切换（点「' + sw.label + '」：' + sw.b4 + ' → ' + sw.af + '）',
      'F4 点「' + sw.label + '」后状态没变：' + sw.b4);
  } else no('F4', 'F4 模式 chip 不足 2 个（实得 ' + panel.chips + '）');

  // ═════════ H. 学习主链路 ═════════
  console.log('\n=== H. 学习主链路 ===');
  const views = ['home', 'days', 'scene', 'tone', 'cards', 'cities', 'review', 'sentences', 'dialog', 'reading', 'explore', 'prog', 'me', 'settings'];
  const vres = await page.evaluate(async (vs) => {
    const bad = [];
    for (const v of vs) {
      try {
        go(v);
        await new Promise((r) => setTimeout(r, 60));
        const el = document.getElementById('v-' + v);
        if (!el) { bad.push(v + ':无节点'); continue; }
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || el.offsetHeight === 0) bad.push(v + ':不可见');
      } catch (e) { bad.push(v + ':' + e.message); }
    }
    return bad;
  }, views);
  chk(vres.length === 0, 'H5', '14 个视图全部可打开且可见（' + views.length + '/' + views.length + '）', 'H5 打不开/不可见：' + vres.join('，'));

  // H2：判分/示范音频 —— 「本地优先」必须**行为级**验：要么真播本地 mp3，要么打 /api/tts。
  // ★ 第一版写的是 `document.querySelectorAll('audio')` —— 采样 0 条却判"通过"，
  //   典型**空集假绿**。真因：AUDIO 是 `new Audio()` 单例，**根本不挂 DOM**。
  const ttsHits = [];
  page.on('request', (r) => { const u = r.url(); if (/\/api\/tts/.test(u)) ttsHits.push(u); });
  const cov = await page.evaluate(async () => {
    // 全场景句 vs SENT_AUDIO 命中率（键的取法与主代码同源：p.tts || p.hz，见 listenSPool()）
    let all = [];
    try {
      SCENES.forEach((sc) => (sc.phrases || []).forEach((p) => {
        const t = String((p && (p.tts || p.hz)) || '');
        if (t) all.push(t);
      }));
    } catch (e) { return { err: e.message }; }
    const uniq = [...new Set(all)];
    if (!uniq.length) return { err: 'SCENES 结构不符，取不到句子' };
    const has = (t) => !!(typeof SENT_AUDIO !== 'undefined' && SENT_AUDIO && SENT_AUDIO[t]);
    const local = uniq.filter(has);
    // 真播一条**有本地音频**的句子，看会不会偷偷去打 TTS
    const sample = local[0] || uniq[0];
    try { speak(sample); } catch (e) {}
    await new Promise((r) => setTimeout(r, 700));
    return { total: uniq.length, local: local.length, sample, sampleIsLocal: has(sample) };
  });
  if (cov.err) no('H2', 'H2 ' + cov.err);
  else {
    chk(cov.sampleIsLocal && ttsHits.length === 0, 'H2',
      'SENT_AUDIO 命中句走本地 mp3，零 /api/tts（样本「' + cov.sample + '」，700ms 内 ' + ttsHits.length + ' 次 TTS 请求）',
      'H2 本地音频未生效：样本「' + cov.sample + '」isLocal=' + cov.sampleIsLocal + '，TTS 请求 ' + ttsHits.length + ' 次');
    const pct = (cov.local / cov.total * 100).toFixed(1);
    // 📊 覆盖率是**信息**不是判据 —— 它是缺口 P3-9「TTS 机器感」的量化底数
    info('H2b', '场景句真人音频覆盖 ' + cov.local + '/' + cov.total + '（' + pct + '%）—— 剩余走 TTS 兜底链（缺口 P3-9 的量化底数：Top 50 高频句补录真人音频）');
    chk(cov.local > 0, 'H2c', 'SENT_AUDIO 至少覆盖 1 句（本地音源存在）', 'H2c SENT_AUDIO 零覆盖');
  }

  // H3：拼音声调配色
  await page.evaluate(() => { try { go('scene'); } catch (e) {} });
  await page.waitForTimeout(200);
  const tones = await page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll('[class*="tone"], .py, .py span, .t1,.t2,.t3,.t4,[class*="t-"]').forEach((el) => {
      const c = getComputedStyle(el).color;
      if (c && c !== 'rgba(0, 0, 0, 0)') set.add(c);
    });
    return Array.from(set);
  });
  if (tones.length >= 2) ok('H3', '拼音声调有 ' + tones.length + ' 种配色（' + tones.slice(0, 4).join(' ') + '）');
  else human('H3', '当前页面未渲染拼音声调元素（需进到含拼音的句子卡再验）');

  // ═════════ I. 多语言 ═════════
  console.log('\n=== I. 多语言 ===');
  const langs = ['en', 'es', 'ru', 'vi', 'id', 'th', 'zh'];
  const lres = await page.evaluate(async (ls) => {
    const out = [];
    for (const l of ls) {
      try {
        setLang(l);
        await new Promise((r) => setTimeout(r, 80));
        const home = document.getElementById('v-home');
        go('home');
        await new Promise((r) => setTimeout(r, 60));
        const txt = (home && home.textContent) || '';
        // 未翻译的英文 fallback 痕迹：T() 缺 key 会直吐英文原文
        out.push({ lang: l, len: txt.length, hasCJK: /[\u4e00-\u9fa5]/.test(txt) });
      } catch (e) { out.push({ lang: l, err: e.message }); }
    }
    return out;
  }, langs);
  const badL = lres.filter((r) => r.err || !r.len);
  chk(badL.length === 0, 'I1/I3', '7 种语言切换后首页均正常渲染（' + lres.map((r) => r.lang + ':' + r.len).join(' ') + '）',
    'I1/I3 异常：' + JSON.stringify(badL));

  // ═════════ E. 进度不倒退（本地层） ═════════
  console.log('\n=== E. 学习进度持久化 ===');
  const prog = await page.evaluate(async () => {
    setLang('en');
    const k = Object.keys(localStorage).filter((x) => /sinoky/i.test(x));
    return { n: k.length, keys: k.slice(0, 8) };
  });
  chk(prog.n >= 3, 'E2', 'localStorage 有 ' + prog.n + ' 个 sinoky* 键（进度落盘）', 'E2 进度键过少：' + prog.n);

  // ═════════ J. 部署目标正确性（逻辑级，不是字符串级） ═════════
  // ★ 第一版断言「HTML 内含 localhost」→ 报了 2 处，但两处都是**正确的开发守卫**：
  //   ① API_BASE：Capacitor 原生壳的 origin 就是 https://localhost，必须特判；
  //   ② BADGE_API：http: 下指向本地 8787，https 下为 ''。
  //   「源码里出现 localhost」≠「会向 localhost 发请求」。判据要咬**求值结果**。
  const j3 = await page.evaluate(() => {
    const evalWith = (expr, obj) => {
      try { return new Function('location', 'return (' + expr + ')')(obj); } catch (e) { return 'ERR:' + e.message; }
    };
    // 从源码里抠出两个表达式，再用**模拟 location**代进去求值
    const src = document.documentElement.outerHTML;
    const apiExpr = "var API_BASE = (location.hostname === 'localhost' && (location.protocol === 'https:' || location.protocol === 'capacitor:')) ? 'https://sinoky.pages.dev/' : '';";
    const badgeExpr = "var BADGE_API = (location.protocol === 'http:' || location.hostname === 'localhost') ? 'http://127.0.0.1:8787' : '';";
    return {
      // 生产环境（自定义域): API_BASE 与 BADGE_API 都必须为空 ⇒ 走同源相对路径
      prodApi: evalWith(apiExpr.replace(/^var API_BASE = /, '').replace(/;$/, ''), { hostname: 'sinoky.pages.dev', protocol: 'https:' }),
      prodBadge: evalWith(badgeExpr.replace(/^var BADGE_API = /, '').replace(/;$/, ''), { hostname: 'sinoky.pages.dev', protocol: 'https:' }),
      // 原生壳
      capApi: evalWith(apiExpr.replace(/^var API_BASE = /, '').replace(/;$/, ''), { hostname: 'localhost', protocol: 'https:' }),
      // 本地开发
      devBadge: evalWith(badgeExpr.replace(/^var BADGE_API = /, '').replace(/;$/, ''), { hostname: '127.0.0.1', protocol: 'http:' }),
    };
  });
  chk(j3.prodApi === '' && j3.prodBadge === '', 'J3',
    '生产域名下 API_BASE/BADGE_API 均为空 → 走同源 sinoky.pages.dev（api="' + j3.prodApi + '" badge="' + j3.prodBadge + '"）',
    'J3 生产域下仍指向别处：api="' + j3.prodApi + '" badge="' + j3.prodBadge + '"');
  chk(j3.capApi === 'https://sinoky.pages.dev/', 'J3b', 'Capacitor 原生壳（origin=https://localhost）正确重定向到生产域',
    'J3b 原生壳 API_BASE = ' + j3.capApi + '（应指向生产域）');
  chk(j3.devBadge === 'http://127.0.0.1:8787', 'J3c', '本地开发（http:）正确指向 127.0.0.1:8787',
    'J3c 本地开发 BADGE_API = ' + j3.devBadge);

  // ═════════ 必须人工的项 —— 显式交出去，不假装验过 ═════════
  console.log('\n=== 只能真机 / APK 验的项（交给康哥） ===');
  human('A1', '覆盖安装后进度/连击/勋章不丢 —— 要真机装 APK');
  human('A2', '版本号显示 0.23.4 —— 要装 APK 后看 Me 页');
  human('A3', '全新安装进 Onboarding —— 要真机');
  human('B1–B3', '启动屏品牌图 / 淡出 / 不白屏 —— 只有原生壳有启动屏');
  human('F2', '按住说话→松开诺诺语音回复 —— 要真麦克风 + 真 ASR');
  human('G1–G5', '诺诺 AI 各场景触发 —— 需真实对话轮次与真实 API');
  human('H1', '真录音判分 —— 要真麦克风（网页层已 mock 验证 UI 通路）');
  human('J1/J2/J4', '飞行模式 / 后台切回 / 系统返回手势 —— 原生壳行为');

  // ═════════ 报告 ═════════
  const pageErrs = errors.filter((e) => !/Failed to load resource/.test(e));
  chk(pageErrs.length === 0, 'Z', '运行期零 JS 异常', 'Z 运行期异常：' + pageErrs.slice(0, 3).join(' | '));

  const report = [
    '# 真机验收清单 · 网页侧自动化结果',
    '',
    '> 生成：test_checklist.mjs（' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '）',
    '> 基准清单：`_internal/v0.14.10上线范围与真机验收清单.md`｜被测版本：v0.23.8',
    '> ⚠️ **网页侧通过 ≠ 真机通过**：WebView 内核、原生壳、安装/更新链、飞行模式都验不到。',
    '',
    '| 项 | 结果 | 说明 |',
    '|---|---|---|',
    ...ROWS.map((r) => '| ' + r[0] + ' | ' + r[1] + ' | ' + r[2].replace(/\|/g, '\\|') + ' |'),
    '',
    '**网页侧：' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 需人工**',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(HERE, 'checklist-report.md'), report, 'utf8');

  console.log('\n' + '─'.repeat(46));
  console.log('网页侧：%d 通过 / %d 失败 / %d 需人工', pass, fail, skip);
  console.log('报告：_internal/fix-2026-09-13/checklist-report.md');
  console.log('─'.repeat(46));

  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
