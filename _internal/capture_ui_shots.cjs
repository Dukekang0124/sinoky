/* 采集产品「真机界面截图」——供推广物料嵌入使用（G-G 组：界面实据组）
 *
 * 为什么要有这个脚本：此前推广图里的「手机界面」是**用 HTML/CSS 重画**的模拟界面，
 * 好处是零二维码有结构性保证，坏处是**与产品真实界面会有出入**（排版、文案、间距全靠手工对齐）。
 * 本轮物料需要在图里嵌入**产品真实界面截图** ⇒ 必须有确定性的采集链路。
 *
 * 设计要点：
 *  ① 服务的是 `www/`（= 线上部署的确切内容，已由 verify_www_vs_live 证明与线上逐字节一致），
 *     既能截图到「用户真看到的东西」，又**完全不走网络**（更快、更稳、零生产影响）。
 *  ② 三层遮挡必须逐层点掉：`#lang-gate` → 开屏 intro「跳过」→ `#v-onboard`。
 *     ⚠️ 只设 display:none 不够（主内容还藏着，截出来全黑）。
 *  ③ 零生产写入：`page.route` abort 全部 `/api/*`（本地 server 无后端，但双保险）。
 *  ④ 每个视图截完立刻断言：可见文本非空 + 目标视图确实带 `.on` + 无遮挡残留。
 *     空截图/遮挡截图**比没有截图更危险**（会被人当成"界面就是这样"采信）。
 *
 * 用法：
 *   NODE_PATH=<ws>/node_modules node _internal/capture_ui_shots.cjs --dry         # 只探测
 *   NODE_PATH=<ws>/node_modules node _internal/capture_ui_shots.cjs --out=<dir>   # 采集
 *   APP_LANG=中文 node ... （默认 English，面向海外受众）
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.APP_BASE || 'http://127.0.0.1:8788/';
const LANG = process.env.APP_LANG || 'English';
const DRY = process.argv.includes('--dry');
const outArg = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
const OUT = outArg || path.join(__dirname, '_shots_app');

/* 视图清单。每条 = 一个**要采集的画面**（同一视图可有多个状态，用 `file` 区分文件名）。
   `prep` 是进入该状态前必须执行的浏览器内代码 —— 产品的多数内容视图默认空着，
   直接 go() 只会截到占位态（一张"看着正常但没有内容"的图，最危险的那种失败）。 */
const VIEWS = [
  { id: 'home',        label: '首页',           prep: null },
  /* 场景句卡：产品默认把汉字蒙住（先听后揭）。推广图要展示"揭开后"的完整形态，
     用产品自己的 `toggleZh(i)`（不是直接改 DOM），这样截到的确实是产品可达状态。 */
  { id: 'scene',       label: '场景·点餐',      prep: "openScene('food',0,'home'); revealAllZh()" },
  { id: 'scene',       label: '场景·你来答',    prep: "openScene('express',0,'home'); revealAllZh()", file: 'scene-express' },
  /* 🔴 「整屏」与「局部放大」是两种素材，服务两种排版：
     整屏 = 证明"这是个完整的 app"；局部放大 = 让细节真的看得清。
     实测教训：1170×2532 的整屏缩到推广图里 352px 宽时，16px 的字只剩 ~5px，
     **等于没拍**。所以关键交互必须额外采一张元素级截图。 */
  { id: 'scene',       label: '局部·同卡一问一答', prep: "openScene('express',0,'home'); revealAllZh()", shot: '#sc-list .phrase:nth-child(1)', file: 'zoom-phrase' },
  { id: 'scene',       label: '局部·点餐前三句', prep: "openScene('food',0,'home'); revealAllZh()", shot: '#sc-list', shotH: 875, file: 'zoom-food3' },
  { id: 'scene',       label: '局部·点餐全 6 句', prep: "openScene('food',0,'home'); revealAllZh()", shot: '#sc-list', file: 'zoom-food' },
  { id: 'dialog',      label: '对话卡列表',     prep: null },
  { id: 'dialog',      label: '对话·点餐详情',  prep: "openDialog('d-food')", file: 'dialog-food' },
  { id: 'tone',        label: '声调训练',       prep: 'startTone()' },
  { id: 'cards',       label: '字卡',           prep: null },
  { id: 'sentences',   label: '必说句',         prep: null },
  { id: 'cities',      label: '城市列表',       prep: null },
  { id: 'cityguide',   label: '城市攻略·上海',  prep: "openCityGuide('shanghai')" },
  { id: 'days',        label: '每日路径',       prep: null },
  { id: 'review',      label: '复习',           prep: null },
  { id: 'prog',        label: '进度',           prep: null },
  { id: 'scenes-read', label: '场景朗读',       prep: null },
  { id: 'explore',     label: '探索',           prep: null },
  { id: 'me',          label: '我的',           prep: null },
  { id: 'settings',    label: '设置',           prep: null },
];

/* 滚一遍再回顶，触发 `loading="lazy"` 的图片加载。
   不预热会在截图里留下**空白框**，且报告里只会显示"图没加载"——
   人眼看到的是"设计就这样"，这是最容易被采信的错误。 */
async function warmLazy(p) {
  await p.evaluate(async () => {
    const step = 500;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 25));
    }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(200);
}

/* 拍照前的净化：清掉诺诺的**临时引导气泡**。
   🔴 这里踩过一次：以为气泡是 `#nono-msg`（`nonoClearTip()` 清的那个），
   结果清了两次都不生效 —— 真正浮在上面的是 **`#nono-tip.on`**（z-index 59）。
   ⇒ 教训：**"看不到效果"时先去 DOM 里确认元素是谁**，别反复调同一个函数。
   它浮在内容之上，会挡住 Role reversal 正文与任务区条目 —— 拍进物料里既像 UI 故障、
   又把最有说服力的文字盖掉。气泡是一次性引导层，不属于界面结构；
   `#nono-dock` 的熊猫头像本身**保留**（那是产品真实的一等公民）。
   ⚠️ 只清气泡，不动任何内容区、不改任何样式令牌。 */
async function clearTransientTips(p) {
  return p.evaluate(() => {
    const out = [];
    try { if (typeof nonoClearTip === 'function') nonoClearTip(); } catch (e) { /* 忽略 */ }
    const m = document.getElementById('nono-msg');
    if (m && getComputedStyle(m).display !== 'none') { m.innerHTML = ''; m.style.display = 'none'; out.push('nono-msg'); }
    const tip = document.getElementById('nono-tip');
    if (tip && tip.classList.contains('on')) { tip.classList.remove('on'); out.push('nono-tip'); }
    /* 诺诺主动弹出的面板（"Nono / Not now"）—— 由主动引擎在切视图时触发，
       会盖住下半屏内容（实测盖掉了 Tone changes 卡片）。隐藏它回到干净界面。
       注意：这是**引导层**，不是内容；`#nono-dock` 熊猫头像仍然保留。 */
    const panel = document.getElementById('nono-panel');
    if (panel && getComputedStyle(panel).display !== 'none') {
      try { if (typeof nonoMin === 'function') nonoMin(); } catch (e) { /* 忽略 */ }
      panel.style.display = 'none';
      /* mask（如果有）也要收，否则整屏点不了且截图发暗 */
      const mask = document.getElementById('nono-mask') || document.querySelector('.nono-mask');
      if (mask) mask.style.display = 'none';
      out.push('nono-panel');
    }
    return out;
  });
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,           // 390×844 @3x = 1170×2532，嵌进推广图后仍然锐利
    isMobile: true, hasTouch: true,
  });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.route('**/api/**', (r) => r.abort());   // 零生产写入

  await p.goto(BASE + '?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  /* 等产品主模块就绪（S 是顶层状态；LM/PATH 是命名空间模块） */
  await p.waitForFunction(() => typeof S === 'object' && typeof APP_VERSION === 'string', { timeout: 45000 });
  const ver = await p.evaluate(() => APP_VERSION);
  /* 语言门出现前的自动判定值（来自 navigator.language）——只作记录，
     真正的界面语言要在点完门之后再取，否则报告会自相矛盾（曾因此误判"点击失败"） */
  const langAuto = await p.evaluate(() => (S && S.lang) || '(none)');

  /* —— 第一层：语言门 ——
     按钮是 `<button class="lg-opt">`，内含 `<span class="lg-name">English</span>`；
     点它才会真的 `setLang()`（写 S.lang + 加载语言包 + applyI18n）。 */
  const gate = await p.evaluate(() => !!document.getElementById('lang-gate'));
  let gateClicked = '(no gate)';
  if (gate) {
    try {
      await p.locator('#lang-gate .lg-opt', { hasText: LANG }).first().click({ timeout: 8000 });
      gateClicked = LANG;
    } catch (e) {
      try {
        const r = await p.evaluate((l) => {
          const bs = [...document.querySelectorAll('#lang-gate .lg-opt')];
          const t = bs.find((x) => x.textContent.trim().indexOf(l) >= 0) || bs[0];
          if (t) { t.click(); return t.textContent.trim(); }
          return '(none)';
        }, LANG);
        gateClicked = 'js:' + r;
      } catch (e2) { gateClicked = 'FAILED: ' + (e && e.message); }
    }
  }
  await p.waitForTimeout(1500);
  const appLang = await p.evaluate(() => (S && S.lang) || '(none)');

  /* —— 第二层：开屏 intro（「跳过」）+ 第三层 #v-onboard —— */
  const layers = [];
  for (let i = 0; i < 8; i++) {
    let clicked = '';
    try {
      const skip = p.locator('text=/^\s*(先跳过|跳过|Skip)\s*$/i').first();
      if (await skip.count() > 0 && await skip.isVisible()) { await skip.click({ timeout: 2500 }); clicked = 'skip'; }
    } catch (e) { /* 没有就继续 */ }
    const snap = await p.evaluate(() => {
      const o = {};
      ['lang-gate', 'splash', 'onboard', 'intro', 'v-onboard'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { o[id] = getComputedStyle(el).display; el.style.display = 'none'; }
      });
      return o;
    });
    const top = await p.evaluate(() => {
      const el = document.elementFromPoint(195, 420);
      if (!el) return '(null)';
      const chain = []; let n = el;
      while (n && chain.length < 4) { chain.push(n.id ? '#' + n.id : (n.className ? '.' + String(n.className).split(' ')[0] : n.tagName)); n = n.parentElement; }
      return chain.join(' < ');
    });
    layers.push({ round: i, clicked, snap: Object.keys(snap).length ? snap : null, top });
    if (/v-home|home-/.test(top)) break;
    await p.waitForTimeout(600);
  }

  const report = { version: ver, langAuto, langInApp: appLang, gate, gateClicked, layers: layers.slice(-2), views: [] };

  /* 内容 id 清单：SCENES 是**数组**（不是对象，坑过一次 —— `Object.keys(SCENES)` 拿到的是
     '0','1','2' 这些下标，传给 openScene 匹配不到 → 视图渲染成空壳却仍带 `.on`，
     截出来是一张"看起来正常但没有内容"的图，最危险的那种失败）。 */
  const ids = await p.evaluate(() => ({
    scenes: (typeof SCENES !== 'undefined' ? SCENES.map((s) => ({ id: s.id, title: s.title, n: (s.phrases || []).length })) : []),
    guides: (typeof CITY_GUIDES !== 'undefined' ? Object.keys(CITY_GUIDES) : []),
  }));

  /* 注入采集辅助：把当前场景的汉字**全部揭开**（走产品自己的 `toggleZh`，
     不是直接删 class —— 保证截到的是产品可达状态，而不是我手改出来的假状态）。 */
  await p.evaluate(() => {
    window.revealAllZh = function () {
      const n = (typeof curScene !== 'undefined' && curScene && curScene.phrases) ? curScene.phrases.length : 0;
      let c = 0;
      for (let i = 0; i < n; i++) {
        const el = document.getElementById('zh-' + i);
        if (el && el.classList.contains('hidden')) { try { toggleZh(i); c++; } catch (e) { /* 忽略 */ } }
      }
      return c + '/' + n + ' revealed';
    };
  });

  for (const v of VIEWS) {
    const fname = v.file || v.id;

    /* ① 先切视图。
       ⚠️ 顺序是关键：`go()` 内部会调 `renderXxx()` 重置内容 ——
       例如 `go('dialog')` 会执行 `renderDialogList()`，**覆盖掉** prep 渲染的对话详情。
       所以必须「先 go，再 prep」；反过来 prep 会被冲掉，而报告里仍显示 prep 成功（假阳性）。 */
    const st = await p.evaluate((vid) => {
      const el = document.getElementById('v-' + vid);
      if (!el) return { missing: true };
      try { go(vid); } catch (e) { return { goErr: String(e && e.message || e) }; }
      return { on: el.classList.contains('on') };
    }, v.id);
    if (st.missing || st.goErr) { report.views.push(Object.assign({ id: v.id, label: v.label }, st)); continue; }

    /* ② 再 prep：在浏览器里执行「进入目标状态」的代码。失败必须在报告里点名，
       不能静默 —— 静默失败会截到占位态而没人知道。 */
    let prepInfo = '';
    if (v.prep) {
      try {
        prepInfo = await p.evaluate((code) => {
          const r = eval(code);
          return (r === undefined) ? 'ok' : String(r).slice(0, 80);
        }, v.prep);
      } catch (e) { prepInfo = 'ERR: ' + (e && e.message); }
      await p.waitForTimeout(300);
    }

    /* ③ 滚一遍预热懒加载图片，再回顶 */
    await warmLazy(p);

    /* ④ 清临时引导气泡（会挡住内容，拍进去像 UI 故障） */
    const tipsCleared = await clearTransientTips(p);

    const shape = await p.evaluate((vid) => {
      const el = document.getElementById('v-' + vid);
      const r = el.getBoundingClientRect();
      const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        on: el.classList.contains('on'),
        h: Math.round(r.height), w: Math.round(r.width),
        txtLen: txt.length,
        head: txt.slice(0, 160),
        imgs: el.querySelectorAll('img').length,
        imgsDone: [...el.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth > 0).length,
      };
    }, v.id);

    /* 等图片与字体落定（等条件不等时间） */
    await p.waitForFunction(() => {
      const bad = [...document.images].filter((i) => i.offsetParent !== null && !(i.complete && i.naturalWidth > 0));
      return bad.length === 0 && document.fonts.status === 'loaded';
    }, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(300);

    /* 截图前再清一次：滚动预热本身会触发新的引导气泡 */
    const tips2 = await clearTransientTips(p);

    /* 🔴 断言浮层真的都不在了。清不掉的话物料里就留着一块"像 UI 故障"的黑框，
       而且它**恰好**盖住最想展示的那句话 —— 属于"拍坏了但看不出来"的典型。
       断言位置紧贴 screenshot，中间不插任何等待（避免定时器把浮层又拉起来）。 */
    const layerLeak = await p.evaluate(() => {
      const bad = [];
      const vis = (el) => el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
      const tip = document.getElementById('nono-tip');
      if (vis(tip) && tip.classList.contains('on')) bad.push('nono-tip');
      const panel = document.getElementById('nono-panel');
      if (vis(panel)) bad.push('nono-panel');
      const mask = document.getElementById('nono-mask') || document.querySelector('.nono-mask');
      if (vis(mask) && parseFloat(getComputedStyle(mask).opacity) > 0.05) bad.push('nono-mask');
      return bad;
    });

    /* 🔴 破图检查：`complete && naturalWidth>0` 为假的可见图，截出来是一个空白框。
       必须点名到具体 src，否则"图没加载"会被当成"设计就是这样"。 */
    const broken = await p.evaluate((vid) => {
      const el = document.getElementById('v-' + vid);
      if (!el) return [];
      return [...el.querySelectorAll('img')]
        .filter((i) => i.offsetParent !== null && !(i.complete && i.naturalWidth > 0))
        .map((i) => (i.currentSrc || i.src || '').split('/').slice(-2).join('/'))
        .slice(0, 6);
    }, v.id);

    /* ⑤ 出图：`shot` 给了选择器就截**元素**（局部放大，供排版放大细节），
       否则截 viewport（用户真正看到的一屏）。 */
    let shotErr = '';
    if (!DRY) {
      const target = path.join(OUT, 'UI-' + fname + '.png');
      if (v.shot) {
        try {
          const loc = p.locator(v.shot).first();
          await loc.scrollIntoViewIfNeeded({ timeout: 4000 });
          await clearTransientTips(p);
          if (v.shotH) {
            /* 元素比目标高时，从**元素顶部**截固定高（页面坐标 + fullPage clip，
               这样不受视口高度限制）。用于"只要前 N 句"这类选取。 */
            const r = await p.evaluate((sel) => {
              const e = document.querySelector(sel);
              const q = e.getBoundingClientRect();
              return { x: q.left + window.scrollX, y: q.top + window.scrollY, w: q.width, h: q.height };
            }, v.shot);
            await p.screenshot({
              fullPage: true,
              clip: { x: r.x, y: r.y, width: r.w, height: Math.min(v.shotH, r.h) },
              path: target,
            });
          } else {
            await loc.screenshot({ path: target });
          }
        } catch (e) { shotErr = 'SHOT-ERR: ' + (e && e.message); }
      } else {
        await p.screenshot({ path: target });
      }
    }
    report.views.push(Object.assign({
      id: fname, viewId: v.id, label: v.label,
      prep: prepInfo || undefined,
      shot: v.shot || undefined,
      shotErr: shotErr || undefined,
      tipsCleared: [...tipsCleared, ...tips2].join(',') || undefined,
      layerLeak: layerLeak.length ? layerLeak : undefined,
      broken: broken.length ? broken : undefined,
    }, st, shape));
  }

  report.contentIds = { sceneCount: ids.scenes.length, guideKeys: ids.guides, scenes: ids.scenes.slice(0, 30) };

  report.errors = errs.slice(0, 8);
  console.log(JSON.stringify(report, null, 1));
  if (!DRY) console.error('输出目录：' + OUT);   /* stderr —— stdout 保持纯 JSON 可直连 JSON.parse */
  await b.close();
})().catch((e) => { console.error('✗ 采集脚本自身异常：' + (e && e.stack || e)); process.exit(2); });
