/**
 * probe-splash-live.mjs —— v0.23.11 开屏换图「线上真站」验收
 *
 * 为什么还要一个线上探针：本地 probe-splash.mjs 证明的是「仓库里的代码 + 素材渲染正确」，
 * 但康哥要看的是**线上用户打开时看到的画面**。两者之间隔着 CF 部署、SW、缓存三道 ——
 * v0.23.11 首轮「本地全绿、线上还是旧内容」就是这么发生的。⇒ 线上探针咬「用户此刻真的看到新开屏」。
 *
 * 验什么（每条都咬「用户能不能看到对的画面」）：
 *   L1 开屏元素在，且图源 = assets/splash/a8_9x16.webp
 *   L2 开屏底色 = rgb(14,55,57)（图内实测色，补色处与图边缘无缝）
 *   L3 .sp-brand 正常态不显示（图自带 LOGO ⇒ 不能出现两套字标）
 *   L4 图盒不超出视口（不裁切、不溢出）
 *   L5 图真的加载成功（naturalWidth>0，不是坏图）
 *   L6 开屏最终隐藏（不黏屏）
 *   L6b 隐藏时刻晚于图就绪时刻（是「等图」而不是定时盲淡出）
 *
 * ⚠️ 本脚本自己踩过的三个坑（都留在这里当反面教材）：
 *   ① **不能把采样挂在 DOMContentLoaded 上** —— 它是竞态。实测有两次 DOMContentLoaded 在
 *      1908ms 才触发，而开屏在 ~420ms 就淡出并移除了 ⇒ 采不到，报出「页面结构变了」的假红。
 *      正解：`addInitScript`（document-start 执行）+ 30ms 轮询采样，与任何事件都不耦合。
 *   ② **不能只靠 MutationObserver 判隐藏** —— `#splash.hide` 只是加 class，淡出是
 *      `transition:opacity .45s`，CSS 过渡**不产生 attribute 变更** ⇒ 观察器只在加 class 那一瞬触发，
 *      那时 computed opacity 还是 1。正解：判**过渡结束后的最终计算值**，并接受「节点已移除」。
 *   ③ **「图就绪」基准别取错** —— 资源计时的 responseEnd 是真实就绪；`img` 的 load 事件走任务队列，
 *      实测晚 1ms。拿 load 当基准会判出「淡出早于图就绪 1ms」的假红。取两者更早者 + 40ms 容差。
 *   另：`page.route` 不拦 SW 发起的请求 ⇒ serviceWorkers:'block'；route 后注册优先 ⇒ 通用 abort 先注册。
 *
 * 用法：node _internal/fix-2026-09-13/probe-splash-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
const SITE = 'https://sinoky.pages.dev';
const IMG_REL = 'assets/splash/a8_9x16.webp';
const BG = 'rgb(14, 55, 57)';

let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log('  \u2705 %s %s', id, m); };
const no = (id, m) => { fail++; console.log('  \u274c %s %s', id, m); };

/** document-start 安装：与任何事件解耦的 30ms 采样器 */
const INIT = () => {
  window.__sl = { t0: performance.now(), samples: [], img: [], err: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name.indexOf('a8_9x16') >= 0) {
          window.__sl.img.push({ t: Math.round(performance.now() - window.__sl.t0), f: e.name.split('/').pop(), ms: Math.round(e.duration), size: e.transferSize || e.decodedBodySize });
        }
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (e) { /* noop */ }
  const T = () => Math.round(performance.now() - window.__sl.t0);
  const S = () => {
    const sp = document.getElementById('splash');
    const img = sp ? sp.querySelector('img') : null;
    const brand = sp ? sp.querySelector('.sp-brand') : null;
    const cs = sp ? getComputedStyle(sp) : null;
    const r = img ? img.getBoundingClientRect() : null;
    const de = document.documentElement;      // 🔴 见下：document-start 时它可能是 null
    window.__sl.samples.push({
      t: T(), has: !!sp,
      cls: sp ? sp.className : null,
      display: cs ? cs.display : null,
      opacity: cs ? cs.opacity : null,
      visibility: cs ? cs.visibility : null,
      bg: cs ? cs.backgroundColor : null,
      brandDisplay: brand ? getComputedStyle(brand).display : null,
      imgSrc: img ? img.getAttribute('src') : null,
      imgNW: img ? img.naturalWidth : null,
      box: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      vw: de ? de.clientWidth : null, vh: de ? de.clientHeight : null,
    });
  };
  // 🔴🔴 本脚本栽过的第 4 个坑（也是最隐蔽的一个）：**`document-start` 阶段 `document.documentElement` 是 null。**
  //    采样器里原本写 `vw: document.documentElement.clientWidth` ⇒ 首次调用抛 TypeError
  //    ⇒ 异常冒出 INIT、**`setInterval` 那行根本没执行到** ⇒ 采样器静默死亡、samples 永远为 0。
  //    症状极具误导性：`window.__sl` 存在、`img` 有数据（PerformanceObserver 在抛错前已装好），
  //    于是看起来「页面没渲染开屏」，实际是**观测工具自己死了**。
  //    两条纪律：① document-start 里一切 DOM 访问都要存在性判断；
  //              ② 观测器必须**永不静默死亡** —— 所有采样都过 SAFE()，异常记进 __sl.err 并由上层打印。
  const SAFE = () => { try { S(); } catch (e) { if (window.__sl.err.length < 5) window.__sl.err.push(String((e && e.message) || e)); } };
  SAFE();                                // 立刻采一次（此时通常还没有 body）
  const iv = setInterval(SAFE, 30);
  setTimeout(() => clearInterval(iv), 120000);
};

/** 从采样序列里提炼出结论（判定逻辑放 Node 侧，不改动页面状态） */
const analyze = (tl) => {
  const ss = (tl && tl.samples) || [];
  const withSplash = ss.filter(s => s.has);
  const first = withSplash[0] || null;
  const loaded = withSplash.find(s => s.imgNW > 0) || null;
  // 🔴 结构断言必须取「**图真正铺上来的那一刻**」，不能取最早那一帧：
  //    采样从 document-start 开始，107ms 那帧的样式表还没解析完（`.sp-brand{display:none}` 还没生效 ⇒ 读到 block）、
  //    图也没加载（`width:auto` 拿不到固有宽 ⇒ box.w=0）。拿它当快照会把「渐进解析的中间态」误判成缺陷。
  //    「用户看到什么」的判据时点 = 图已经在屏幕上的那一刻。
  const settled = withSplash.find(s => s.imgNW > 0 && s.box && s.box.w > 0) || loaded || first;
  // 更强的不变量：**图已就绪时字标绝不能同时可见**（那才是真正的「两套字标」）
  const doubleMark = withSplash.filter(s => s.imgNW > 0 && s.brandDisplay && s.brandDisplay !== 'none');
  const brandPreImg = withSplash.filter(s => !(s.imgNW > 0) && s.brandDisplay && s.brandDisplay !== 'none');
  const visible = withSplash.filter(s => s.display !== 'none' && s.opacity !== '0' && s.visibility !== 'hidden');
  const lastVisible = visible[visible.length - 1] || null;
  // 隐藏 = 节点消失，或变成 none/透明/hidden
  const hidden = ss.filter(s => !s.has || s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden');
  const firstHiddenAfterVisible = lastVisible ? hidden.find(s => s.t > lastVisible.t) : null;
  const resReady = tl && tl.img && tl.img.length ? tl.img[0].t : null;
  return { n: ss.length, first, loaded, settled, doubleMark, brandPreImg, lastVisible, firstHiddenAfterVisible, resReady, last: ss[ss.length - 1] || null };
};

/** 只跑一次；「网络抖动」的重试逻辑在外层 run() */
async function runOnce(browser, { vp, label, shot, freeze = false, attempt = 1 }) {
  const ctx = await browser.newContext({
    serviceWorkers: 'block',
    viewport: vp,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  // 通用先注册：只放行本站，其余一律掐断（真站会引外网资源，不拦会等超时）
  await page.route('**/*', (r) => {
    const u = r.request().url();
    return (u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort();
  });
  // 网络诊断：开屏图的请求到底发生了什么（HTTP 状态 / 传输层失败）
  // 没有它就无法区分「产品错（404 / 路径写错）」与「网络抖动（请求压根没回来）」——
  // 实测就遇到过后者的假红（同一脚本桌面视口正常、手机视口图请求零响应）。
  const net = [];
  page.on('requestfailed', (req) => { if (req.url().includes('a8_9x16')) net.push({ k: 'failed', err: ((req.failure() || {}).errorText) || 'unknown' }); });
  page.on('response', (res) => { if (res.url().includes('a8_9x16')) net.push({ k: 'response', status: res.status() }); });

  await page.addInitScript(INIT);
  if (freeze) {
    // 仅截图用（**不参与任何断言**）：把开屏**钉在屏幕上**。
    // 🔴 为什么只拉长 transition 不行：实测隐藏是**两步** —— ① 加 `.hide`（淡出 450ms）② 随后把 `#splash` **从 DOM 移除**。
    //    只改过渡会被第②步绕过：第一次尝试拍到的就是「开屏已消失、露出 onboarding 页」。
    //    所以三件事一起做：① 阻止移除该节点 ② 去掉过渡 ③ 每帧把 opacity 钉回 1（压过 `#splash.hide{opacity:0}`）。
    await page.addInitScript(() => {
      const isSplash = (el) => !!(el && el.id === 'splash');
      const rm = Element.prototype.remove;
      Element.prototype.remove = function () { if (isSplash(this)) return; return rm.apply(this, arguments); };
      const rc = Node.prototype.removeChild;
      Node.prototype.removeChild = function (c) { if (isSplash(c)) return c; return rc.apply(this, arguments); };
      setInterval(() => {
        const sp = document.getElementById('splash');
        if (sp) { sp.style.transition = 'none'; sp.style.opacity = '1'; }
      }, 20);
    });
  }

  await page.goto(SITE + '/', { waitUntil: 'commit', timeout: 90000 });   // 坑①：不用 domcontentloaded 当锚点

  // 装填自检：采样器必须在**页面脚本之前**就位。若这里就为 null，说明 addInitScript 没生效，
  // 后面所有「采不到」都不是产品的问题 —— 先证明观测工具活着，再谈结论。
  const armed = await page.evaluate(() => (window.__sl
    ? { keys: Object.keys(window.__sl), n: (window.__sl.samples || []).length, err: (window.__sl.err || []).slice(0, 3) }
    : null)).catch(e => 'evaluate-failed: ' + e.message);
  console.log('     [装填自检] %s', JSON.stringify(armed));

  const sawSplash = await page.waitForFunction(() => !!(window.__sl && window.__sl.samples.some(s => s.has)), { timeout: 40000 })
    .then(() => true).catch(() => false);
  let shotState = null;
  if (sawSplash) {
    await page.waitForFunction(() => !!(window.__sl && window.__sl.samples.some(s => s.has && s.imgNW > 0)), { timeout: 25000 }).catch(() => {});
    // 🔴 坑：`naturalWidth > 0` 只说明**元数据**到了，位图可能还没解码上屏 ⇒ 此刻截图拍到的是纯底色
    //    （实测：不加这一步，截出来的 PNG 只有 7KB 的平色）。必须显式 `img.decode()` 等解码完成。
    await page.evaluate(async () => {
      const i = document.querySelector('#splash img');
      if (i && i.decode) { try { await i.decode(); } catch (e) { /* 解码失败留给断言判 */ } }
    }).catch(() => {});
    if (freeze) await page.waitForTimeout(600);   // 冻结态多等一拍，确保合成上屏
    shotState = await page.evaluate(() => {
      const sp = document.getElementById('splash');
      if (!sp) return { gone: true };
      const cs = getComputedStyle(sp);
      return { gone: false, display: cs.display, opacity: cs.opacity };
    });
    await page.screenshot({ path: shot });
  }
  await page.waitForTimeout(2500);
  const tl = await page.evaluate(() => (window.__sl ? { samples: window.__sl.samples, img: window.__sl.img, err: window.__sl.err } : null));
  await ctx.close();
  return { tl, shotState, sawSplash, net, attempt, a: analyze(tl) };
}

/**
 * 带归因的重试：开屏在、但图没上来时，先分清「产品错」还是「网络抖动」再决定要不要重试。
 *   · 图请求拿到 4xx/5xx        → 产品/配置错 ⇒ **不重试**，让断言去红（重试只会掩盖真问题）
 *   · 图请求零响应 或 传输层失败 → 网络抖动   ⇒ 重试（否则观测工具在给出假结论）
 * 这条纪律来自实测：首轮手机视口零响应，而同一脚本桌面视口完全正常 —— 纯网络问题。
 */
async function run(browser, opts) {
  const maxTry = opts.maxTry || 3;
  let last = null;
  for (let attempt = 1; attempt <= maxTry; attempt++) {
    last = await runOnce(browser, Object.assign({}, opts, { attempt }));
    const a = last.a;
    const imgNet = last.net || [];
    const transportFail = imgNet.length === 0 || imgNet.some(n => n.k === 'failed');
    const httpBad = imgNet.some(n => n.k === 'response' && n.status >= 400);
    if (a.loaded || httpBad || !last.sawSplash || attempt === maxTry) return last;
    if (transportFail) {
      console.log('     \u26a0\ufe0f  第 %d 次：开屏在、但开屏图**没拿到响应**（%s）⇒ 判为网络抖动，重试', attempt, JSON.stringify(imgNet));
      await new Promise(res => setTimeout(res, 1500));
      continue;
    }
    return last;
  }
  return last;
}

const main = async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });

  console.log('\n\u2500\u2500 手机视口 390x844（主验）\u2500\u2500');
  const phone = await run(browser, { vp: { width: 390, height: 844 }, label: '手机', shot: path.join(SHOTS, 'live-splash-phone-mid.png') });
  const a = phone.a;
  console.log('     采样 %d 条 | 有开屏的采样 %d 条 | 截图时 = %s', a.n, (phone.tl.samples || []).filter(s => s.has).length, JSON.stringify(phone.shotState));
  console.log('     网络（开屏图请求）：%s', JSON.stringify(phone.net));
  if (a.settled) console.log('     结构快照 @%dms〔图已就绪〕 bg=%s brand=%s img=%s box=%s 视口=%dx%d', a.settled.t, a.settled.bg, a.settled.brandDisplay, a.settled.imgSrc, JSON.stringify(a.settled.box), a.settled.vw, a.settled.vh);
  if (a.brandPreImg && a.brandPreImg.length) console.log('     信息性：图就绪前有 %d 帧读到 .sp-brand 可见（渐进解析的中间态，非「两套字标」，仅记录）', a.brandPreImg.length);
  if (a.loaded) console.log('     图就绪    @%dms  naturalWidth=%d', a.loaded.t, a.loaded.imgNW);
  if (a.lastVisible) console.log('     最后可见  @%dms  display=%s opacity=%s', a.lastVisible.t, a.lastVisible.display, a.lastVisible.opacity);
  if (a.firstHiddenAfterVisible) console.log('     首次隐藏  @%dms  %s', a.firstHiddenAfterVisible.t, a.firstHiddenAfterVisible.has ? `display=${a.firstHiddenAfterVisible.display} opacity=${a.firstHiddenAfterVisible.opacity}` : '节点已移除');
  (phone.tl.img || []).forEach(e => console.log('     资源 %s %sms %sB', e.f, e.ms, e.size));

  if (!a.first) {
    no('L0', `40s 内没采到开屏（采样 ${a.n} 条，末条=${JSON.stringify(a.last)}）⇒ 开屏没渲染或结构变了`);
  } else {
    const st = a.settled;   // 判据时点 = 图已铺上来的那一刻（see analyze 注释）
    (st.imgSrc && st.imgSrc.indexOf(IMG_REL) >= 0)
      ? ok('L1', `开屏图源 = ${st.imgSrc}`)
      : no('L1', `开屏图源不是 ${IMG_REL}，实际 ${st.imgSrc}`);

    st.bg === BG
      ? ok('L2', `开屏底色 = ${st.bg}（与图内实测色一致）`)
      : no('L2', `开屏底色 ${st.bg} ≠ 期望 ${BG}`);

    st.brandDisplay === 'none'
      ? ok('L3', `.sp-brand 在图就绪时 display:none（图自带 LOGO，不出现两套字标）`)
      : no('L3', `.sp-brand 在图就绪时 display=${st.brandDisplay}，期望 none`);

    // L3b 更强的不变量：整个时间线里，「图已就绪」与「字标可见」不得同时成立
    a.doubleMark && a.doubleMark.length === 0
      ? ok('L3b', '全时间线内不存在「图已就绪 且 字标可见」的帧 ⇒ 不会出现两套字标')
      : no('L3b', `有 ${a.doubleMark && a.doubleMark.length} 帧同时满足「图已就绪 + 字标可见」⇒ 真的会出现两套字标`);

    const b = st.box;
    (b && b.w > 0 && b.h > 0 && b.w <= st.vw + 1 && b.h <= st.vh + 1)
      ? ok('L4', `图盒 ${b.w}x${b.h} 在视口 ${st.vw}x${st.vh} 内，未溢出`)
      : no('L4', `图盒 ${JSON.stringify(b)} 溢出或为零，视口 ${st.vw}x${st.vh}`);

    a.loaded
      ? ok('L5', `开屏图真的加载成功（naturalWidth=${a.loaded.imgNW} @${a.loaded.t}ms）`)
      : no('L5', '采样里从未出现 naturalWidth>0 ⇒ 图没铺上来');

    // L6 不黏屏：判最终态（接受「节点已移除」）
    const hid = a.firstHiddenAfterVisible;
    hid
      ? ok('L6', `开屏最终隐藏 @${hid.t}ms（${hid.has ? `display=${hid.display} opacity=${hid.opacity}` : '节点已从 DOM 移除'}）`)
      : no('L6', `开屏到最后仍未隐藏（末条 t=${a.last && a.last.t}ms display=${a.last && a.last.display} opacity=${a.last && a.last.opacity}）⇒ 黏屏`);

    // L6b 时序：隐藏晚于图就绪（坑③：基准取「资源 responseEnd」与「load 事件」的更早者）
    const cands = [a.resReady, a.loaded ? a.loaded.t : null].filter(x => x !== null && x !== undefined);
    const imgReady = cands.length ? Math.min(...cands) : null;
    if (hid && imgReady !== null && hid.t + 40 >= imgReady) {
      ok('L6b', `隐藏晚于图就绪（图就绪 @${imgReady}ms〔资源 ${a.resReady}ms〕→ 隐藏 @${hid.t}ms，是「等图」不是定时盲淡出）`);
    } else if (!hid) {
      no('L6b', `找不到隐藏时刻（图就绪 @${imgReady}ms）`);
    } else {
      no('L6b', `隐藏 @${hid.t}ms 早于图就绪 @${imgReady}ms（差 ${imgReady - hid.t}ms）⇒ 仍是定时盲淡出`);
    }
  }

  console.log('\n\u2500\u2500 桌面视口 1440x900（验收截图）\u2500\u2500');
  const desk = await run(browser, { vp: { width: 1440, height: 900 }, label: '桌面', shot: path.join(SHOTS, 'live-splash-desktop-mid.png') });
  const d = desk.a.settled;
  if (d) {
    console.log('     结构快照 @%dms〔图已就绪〕 bg=%s brand=%s img=%s box=%s 视口=%dx%d', d.t, d.bg, d.brandDisplay, d.imgSrc, JSON.stringify(d.box), d.vw, d.vh);
    (d.bg === BG && d.imgSrc && d.imgSrc.indexOf(IMG_REL) >= 0 && d.brandDisplay === 'none' && d.box && d.box.w > 0 && d.box.w <= d.vw + 1 && d.box.h <= d.vh + 1)
      ? ok('L7', '桌面视口：图源 / 底色 / 无两套字标 / 图盒不溢出 —— 同样正确')
      : no('L7', `桌面视口异常 bg=${d.bg} brand=${d.brandDisplay} img=${d.imgSrc} box=${JSON.stringify(d.box)}`);
  } else {
    no('L7', '桌面视口采不到开屏');
  }

  console.log('\n\u2500\u2500 冻结态截图（仅出图，不参与断言）\u2500\u2500');
  await run(browser, { vp: { width: 390, height: 844 }, label: '手机·冻结', shot: path.join(SHOTS, 'live-splash-phone.png'), freeze: true });
  await run(browser, { vp: { width: 1440, height: 900 }, label: '桌面·冻结', shot: path.join(SHOTS, 'live-splash-desktop.png'), freeze: true });

  await browser.close();
  console.log('\n  \u2500\u2500 线上开屏验收：通过 %d / 失败 %d \u2500\u2500', pass, fail);
  console.log('  截图目录：%s', SHOTS);
  process.exit(fail ? 1 : 0);
};

main().catch(e => { console.error('脚本自身异常：', e); process.exit(2); });
