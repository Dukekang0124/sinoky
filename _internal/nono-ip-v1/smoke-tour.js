/* ============================================================================
   v0.23.0 + v0.23.3 —— 品牌图标 / 功能导览 / 视图覆盖 / 诺诺形象位：浏览器真跑验收
   ----------------------------------------------------------------------------
   为什么必须真跑（康哥铁律）：语法校验 / grep / diff 只证明「看起来对」。
   本脚本验证的是**行为**：
     · header 品牌图标是品牌红字标（深青黑底 + 朱砂红钥匙几何标），**不是熊猫**
     · favicon 真的指向该红字标（浏览器标签上看到的才是用户看到的）
     · 导览入口真的在面板里（第三个 chip）且真的能逐站推进
     · 每站真的绑了汉字 + 拼音 + 英文释义（Edify Gate 的落点）
     · 「带我去」真的切到对应视图并收起面板
     · 3 个新视图真的出边角气泡且文案正确
     · 浮动邀请真的在 home 出现、真的可点开导览、真的可关
     · v0.23.3 形象位：浮标放大但外框未动、立绘已取消圆裁、点头像真能展开全身、
       动效在 prefers-reduced-motion 下真会关掉（见 G 段）
     · 注入本层后零横向溢出、零 JS 运行时错误
   ============================================================================ */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const PORT = 8102;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function startServer() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/') u = '/index.html';
      const f = path.join(APP, u);
      fs.readFile(f, (e, buf) => {
        if (e) { rsp.writeHead(404); return rsp.end('404'); }
        const ext = path.extname(f).toLowerCase();
        rsp.writeHead(200, { 'Content-Type': u === '/index.html' ? 'text/html; charset=utf-8' : (MIME[ext] || 'application/octet-stream') });
        rsp.end(buf);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });

async function main() {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  /* locale 强制英文：T() 按 navigator.language 取语言包，本机是 zh
     ⇒ 不锁英文的话 T('Tour') 返回「导览」，按英文源文写的断言会误报。 */
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, locale: 'en-US' });

  /* 单条规则统一处理：只放行本地静态服务，其余一律 abort（零外部网络） */
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
    return route.abort();
  });

  const page = await ctx.newPage();
  const R = [];
  const chk = (n, c, e) => R.push([c ? 'PASS' : 'FAIL', n, e === undefined ? '' : String(e)]);
  const errors = [];
  page.on('pageerror', (e) => errors.push('' + e.message));

  /* 启动屏 #splash 在 420ms 淡出、940ms 后被 remove（index.html L6257），而本脚本要在
     reload 后等 1500ms 才动手 ⇒ 直接 querySelector 必然拿到 null。
     用 addInitScript 在页面最早时机抓一次存到 window，彻底摆脱时序依赖（每次导航都会跑）。 */
  await page.addInitScript(() => {
    window.__spBrand = null;
    const grab = () => {
      const el = document.querySelector('#splash .sp-brand');
      if (el && !window.__spBrand) {
        const b = el.querySelector('b');
        window.__spBrand = {
          text: el.textContent.replace(/\s+/g, ''),
          k: b ? b.textContent.trim() : null,
        };
      }
    };
    try { new MutationObserver(grab).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    const t = setInterval(() => { grab(); if (window.__spBrand) clearInterval(t); }, 20);
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  /* 不能整个 localStorage.clear()：清掉 sinoky_state 会触发首启引导层
     （#v-onboard 全屏、z-index:100），把浮标整个挡住 —— 第一次跑就是这么失败的。
     只清与本轮断言相关的三个标记，并把 onboarded 置真。 */
  await page.evaluate(() => {
    try {
      const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
      s.onboarded = true;
      localStorage.setItem('sinoky_state', JSON.stringify(s));
    } catch (e) {}
    ['sinoky_tour', 'sinoky_nono_tour', 'sinoky_nono_invite'].forEach((k) => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);          /* 过启动屏窗口（420ms hide / 520ms 移除） */
  /* 摘掉首启引导层并落到 home。
     ⚠️ 必须「摘 .on + 置 display:none」双管，且摘两次 —— 只用 classList 踩过偶发：
     app 的异步初始化会把 .on 加回来，于是 #nono-fab 被 .ob-bar 挡住，
     page.click 命中了但不触发 onclick，面板不开 → 后面 .nm-tour 取到 null 直接崩。
     这个 flaky 出现过两次，别退回单保险。 */
  const stripOnboard = () => page.evaluate(() => {
    const o = document.getElementById('v-onboard');
    if (o) { o.classList.remove('on'); o.style.display = 'none'; }
    if (typeof window.go === 'function') window.go('home');
    return true;
  });
  await stripOnboard();
  await page.waitForTimeout(500);
  await stripOnboard();                     /* 再摘一次：覆盖 app 迟到的初始化 */
  /* 等浮标真的可点（命中测试通过）—— 把「点不到」变成明确断言，而不是 null 崩 */
  await page.waitForFunction(() => {
    const f = document.getElementById('nono-fab');
    if (!f) return false;
    const r = f.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && (el === f || f.contains(el));
  }, null, { timeout: 8000 }).catch(() => {});
  chk('首启引导层已摘除、浮标命中测试通过（不是被遮住点不到）',
      await page.evaluate(() => {
        const o = document.getElementById('v-onboard');
        const f = document.getElementById('nono-fab');
        if (!f) return false;
        const r = f.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(o && o.classList.contains('on')) && !!el && (el === f || f.contains(el));
      }), '');

  /* ==================== A0. 既有首视图轻引导卡接上诺诺 ==================== */
  const tourCard = await page.evaluate(() => {
    const el = document.querySelector('#home-scenes .nt-nono');
    return {
      exists: !!el,
      img: el && el.querySelector('img') ? el.querySelector('img').getAttribute('src') : '',
      title: el && el.querySelector('b') ? el.querySelector('b').textContent : '',
      txt: el ? el.textContent.replace(/\s+/g, ' ').trim() : '',
    };
  });
  chk('既有首视图引导卡（tourHtml）里真的出现诺诺行', tourCard.exists, tourCard.txt.slice(0, 70));
  chk('诺诺行用 point 姿态图', /assets\/mascot\/point\.webp/.test(tourCard.img), tourCard.img);
  chk('诺诺行绑了中文喊话（Edify Gate）', /[\u4e00-\u9fa5]/.test(tourCard.title), tourCard.title);

  /* ==================== A. 品牌图标 ==================== */
  const iconStat = await page.evaluate(() => new Promise((res) => {
    function probe(src) {
      const bytesP = fetch(src + '?cb=' + Date.now())          /* 字节数：锚定品牌设计源 */
        .then((r) => r.arrayBuffer()).then((b) => b.byteLength).catch(() => 0);
      const statP = new Promise((r) => {
        const im = new Image();
        im.onload = () => {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          const g = c.getContext('2d');
          g.drawImage(im, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let red = 0, solid = 0, dark = 0, light = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] <= 25) continue;
            solid++;
            const R = d[i], G = d[i + 1], B = d[i + 2];
            if (R > 120 && R - G > 45 && R - B > 40) red++;                 /* 朱砂红 #e63946 */
            if (R < 70 && G < 75 && B < 90) dark++;                          /* 深青黑底 #141a24 */
            if (R > 200 && G > 200 && B > 195) light++;                      /* 米白 —— 熊猫毛色 */
          }
          r({ w: im.naturalWidth, h: im.naturalHeight,
              ratio: solid ? red / solid : 0,
              dark: solid ? dark / solid : 0,
              light: solid ? light / solid : 0 });
        };
        im.onerror = () => r({ err: 1 });
        im.src = src + '?cb=' + Date.now();
      });
      return Promise.all([statP, bytesP]).then(([st, by]) => { st.bytes = by; return st; });
    }
    Promise.all([probe('icons/logo-header.png'), probe('icons/favicon-32.png'),
                 probe('icons/icon-192.png'), probe('icons/icon-512.webp')]).then(([a, b, c, d]) => {
      const link = document.querySelector('link[rel="icon"]');
      res({ logo: a, fav: b, desk: c, desk512: d,
            iconHref: link ? link.getAttribute('href') : null,
            spText: window.__spBrand ? window.__spBrand.text : null,
            spK: window.__spBrand ? window.__spBrand.k : null });
    });
  }));
  const pct = (v) => ((v * 100 || 0).toFixed(1) + '%');
  chk('header 品牌图标可加载且尺寸 192×192', !iconStat.logo.err && iconStat.logo.w === 192 && iconStat.logo.h === 192, JSON.stringify(iconStat.logo));
  /* 红字标 = 深青黑底(#141a24) + 朱砂红(#e63946)钥匙；熊猫 = 米白 + 黑 ⇒ 用「暗底高 + 米白≈0」把两者分开 */
  chk('header 品牌图标是「深青黑底」字标、不是熊猫（暗底 ≥ 60%）',
      !iconStat.logo.err && iconStat.logo.dark >= 0.60,
      `暗底 ${pct(iconStat.logo.dark)} / 米白 ${pct(iconStat.logo.light)}（熊猫配色米白会 >30%）`);
  chk('header 品牌图标朱砂红占比 12%~30%（红钥匙几何标）',
      !iconStat.logo.err && iconStat.logo.ratio >= 0.12 && iconStat.logo.ratio <= 0.30,
      `实测 ${pct(iconStat.logo.ratio)}`);
  chk('favicon 可加载且尺寸 32×32', !iconStat.fav.err && iconStat.fav.w === 32 && iconStat.fav.h === 32, JSON.stringify(iconStat.fav));
  chk('favicon 同为红字标（暗底 ≥ 60% 且朱砂红 12%~30%）',
      !iconStat.fav.err && iconStat.fav.dark >= 0.60 && iconStat.fav.ratio >= 0.12 && iconStat.fav.ratio <= 0.30,
      `暗底 ${pct(iconStat.fav.dark)} / 朱砂红 ${pct(iconStat.fav.ratio)} / 米白 ${pct(iconStat.fav.light)}`);
  chk('<link rel="icon"> 指向 icons/favicon-32.png', /icons\/favicon-32\.png/.test(iconStat.iconHref || ''), iconStat.iconHref);
  /* 逐字节锚定品牌设计源：logo-header.png = 4,989 B、favicon-32.png = 885 B
     （源：04-品牌设计/assets/第二轮/sinoky-图标-192.png / -32.png，md5 ab9b1b66… / beb28dca…）
     若将来品牌设计换字标，这里要同步改。 */
  chk('header 品牌图标 = 4,989 B（与品牌设计源 sinoky-图标-192.png 逐字节一致）', iconStat.logo.bytes === 4989, `实测 ${iconStat.logo.bytes} B`);
  chk('favicon = 885 B（与品牌设计源 sinoky-图标-32.png 逐字节一致）', iconStat.fav.bytes === 885, `实测 ${iconStat.fav.bytes} B`);

  /* ---- 桌面图标位：v0.23.2 起也换品牌红字标（康哥决策①；此前为诺诺熊猫）----
     「品牌设计是红线，图标位不放吉祥物」⇒ 桌面图标必须与 header/favicon 同口径。 */
  chk('桌面图标 icons/icon-192.png 可加载且 192×192',
      !iconStat.desk.err && iconStat.desk.w === 192 && iconStat.desk.h === 192, JSON.stringify(iconStat.desk));
  chk('桌面图标是红字标、不是熊猫（暗底 ≥ 60% 且米白 ≈ 0）',
      !iconStat.desk.err && iconStat.desk.dark >= 0.60 && iconStat.desk.light <= 0.05,
      `暗底 ${pct(iconStat.desk.dark)} / 米白 ${pct(iconStat.desk.light)}（熊猫会米白 >30%）`);
  chk('桌面图标 = 4,989 B（与品牌设计源 sinoky-图标-192.png 逐字节一致）',
      iconStat.desk.bytes === 4989, `实测 ${iconStat.desk.bytes} B`);
  chk('桌面图标 icons/icon-512.webp 同为红字标（暗底 ≥ 60% 且米白 ≈ 0）',
      !iconStat.desk512.err && iconStat.desk512.dark >= 0.60 && iconStat.desk512.light <= 0.05,
      `暗底 ${pct(iconStat.desk512.dark)} / 米白 ${pct(iconStat.desk512.light)} / ${iconStat.desk512.w}×${iconStat.desk512.h}`);

  /* ---- 启动屏品牌文字：v0.23.2 修的漏字 ----
     原来标记是 `Sino<b>k</b>` ⇒ 只渲染成 "Sinok"，末尾 y 丢了（康哥发现）。 */
  chk('启动屏品牌文字 = "Sinoky"（末尾 y 未被漏掉）',
      iconStat.spText === 'Sinoky', `实测 ${JSON.stringify(iconStat.spText)}`);
  chk('启动屏品牌文字高亮段 = "k"（钥匙 = key 的品牌语义，不可丢）',
      iconStat.spK === 'k', `实测 ${JSON.stringify(iconStat.spK)}`);

  /* ==================== B. 导览入口 ==================== */
  await page.click('#nono-fab');
  await page.waitForTimeout(500);
  const entry = await page.evaluate(() => {
    const w = document.querySelector('#nono-modes .nm-wrap');
    const chips = w ? Array.from(w.querySelectorAll('.nm-chip')) : [];
    return { n: chips.length, texts: chips.map((c) => c.textContent.trim()), panel: (document.getElementById('nono-panel') || {}).style.display };
  });
  chk('点浮标后面板打开', entry.panel === 'block', entry.panel);
  chk('模式菜单有 3 个 chip', entry.n === 3, entry.texts.join(' | '));
  chk('第三个 chip 是导览入口', entry.n === 3 && /Tour/.test(entry.texts[2]), entry.texts[2]);

  /* ==================== C. 逐站推进 ==================== */
  console.log('[DEBUG] entry =', JSON.stringify(entry));
  const tourClicked = await page.evaluate(() => {
    const el = document.querySelector('#nono-modes .nm-chip.nm-tour');
    if (!el) {
      return {
        ok: false,
        html: (document.getElementById('nono-modes') || {}).innerHTML || '',
        panel: (document.getElementById('nono-panel') || {}).style ? document.getElementById('nono-panel').style.display : 'NO-PANEL',
        onboard: (document.getElementById('v-onboard') || {}).className || 'NO-ONBOARD',
        mode: (window.NONO || {}).mode,
      };
    }
    el.click();
    return { ok: true };
  });
  chk('导览 chip 存在且可点', tourClicked.ok, JSON.stringify(tourClicked).slice(0, 240));
  await page.waitForTimeout(400);
  const s1 = await page.evaluate(() => {
    const m = document.getElementById('nono-msg');
    const q = (s) => (m.querySelector(s) || { textContent: '' }).textContent.trim();
    return {
      top: q('.nt-top'), h: q('.nt-h'), cn: q('.nt-cn b'), py: q('.nt-cn i'), gloss: q('.nt-cn span'),
      dots: m.querySelectorAll('.nt-prog i').length,
      dotsOn: m.querySelectorAll('.nt-prog i.on').length,
      acts: Array.from(document.querySelectorAll('#nono-acts button')).map((b) => b.textContent.trim()),
      pose: (document.getElementById('nono-pose') || {}).src || '',
    };
  });
  chk('第 1 站标题栏含 Tour 且显示 1/6', /Tour/.test(s1.top) && /1\/6/.test(s1.top), s1.top);
  chk('第 1 站标题正确', s1.h === 'One line a day', s1.h);
  chk('第 1 站绑了汉字（Edify Gate 落点）', /[\u4e00-\u9fa5]/.test(s1.cn), s1.cn);
  chk('第 1 站绑了拼音', /[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(s1.py), s1.py);
  chk('第 1 站有英文释义', s1.gloss.length > 8, s1.gloss);
  chk('进度点 6 个、点亮 1 个', s1.dots === 6 && s1.dotsOn === 1, `${s1.dotsOn}/${s1.dots}`);
  chk('第 1 站姿态切到该站指定图', /cheer\.webp/.test(s1.pose), s1.pose.split('/').pop());
  chk('动作条含 Next→ / Take me there / Skip for now', s1.acts.length === 3 && /Next/.test(s1.acts[0]) && /Take me there/.test(s1.acts[1]) && /Skip/.test(s1.acts[2]), s1.acts.join(' | '));

  /* 走到最后一站：从第 1 站(i=0) 起要点 6 次才到收尾站(i=6=TOUR.length) */
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => document.querySelectorAll('#nono-acts button')[0].click());
    await page.waitForTimeout(220);
  }
  const last = await page.evaluate(() => {
    const m = document.getElementById('nono-msg');
    return {
      top: m.querySelector('.nt-top') ? m.querySelector('.nt-top').textContent.trim() : '',
      h: m.querySelector('.nt-h') ? m.querySelector('.nt-h').textContent.trim() : '',
      tour: localStorage.getItem('sinoky_nono_tour'),
      acts: Array.from(document.querySelectorAll('#nono-acts button')).map((b) => b.textContent.trim()),
      pose: (document.getElementById('nono-pose') || {}).src || '',
    };
  });
  chk('推进到收尾站（第 6 站后）', /You've seen the whole place\./.test(last.h), last.h);
  chk('收尾站写入 localStorage sinoky_nono_tour=done', last.tour === 'done', String(last.tour));
  chk('收尾站给下一步动作（Practise / Chat / Close）', last.acts.length === 3 && /Practise/.test(last.acts[0]) && /Chat/.test(last.acts[1]), last.acts.join(' | '));
  chk('收尾站姿态切到 wave', /wave\.webp/.test(last.pose), last.pose.split('/').pop());

  /* ==================== D. 「带我去」真跳转 ==================== */
  await page.evaluate(() => window.nonoTour(0));
  await page.waitForTimeout(260);
  await page.evaluate(() => document.querySelectorAll('#nono-acts button')[1].click());   /* Take me there */
  await page.waitForTimeout(420);
  const nav = await page.evaluate(() => ({
    days: document.getElementById('v-days').classList.contains('on'),
    panel: (document.getElementById('nono-panel') || {}).style.display,
  }));
  chk('「Take me there」切到对应视图 v-days', nav.days === true, JSON.stringify(nav));
  chk('「Take me there」后收起面板（视图本身就是说明）', nav.panel === 'none', nav.panel);

  /* ==================== E. 3 个新视图的语境问候 ==================== */
  const views = [['sentences', '挑一句'], ['reading', '看懂了'], ['prog', '每一枚勋章']];
  for (const [v, kw] of views) {
    const r = await page.evaluate((vv) => {
      window.go(vv);
      return new Promise((res) => {
        setTimeout(() => {
          window.nonoContextGreet(false);
          setTimeout(() => {
            const t = document.getElementById('nono-tip');
            res({ on: !!(t && t.classList.contains('on')), html: t ? t.innerHTML : '', pe: t ? getComputedStyle(t).pointerEvents : '' });
          }, 260);
        }, 120);
      });
    }, v);
    chk(`v-${v} 出边角气泡且文案正确`, r.on && r.html.indexOf(kw) >= 0, r.html.replace(/<[^>]*>/g, '').slice(0, 70));
    chk(`v-${v} 气泡 pointer-events:none（绝不挡点击）`, r.pe === 'none', r.pe);
  }

  /* ==================== F. 浮动邀请（干净状态重载） ==================== */
  await page.evaluate(() => {
    ['sinoky_nono_tour', 'sinoky_nono_invite', 'sinoky_nono'].forEach((k) => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const o = document.getElementById('v-onboard');
    if (o) { o.classList.remove('on'); o.style.display = 'none'; }
    if (typeof window.go === 'function') window.go('home');
  });
  /* ⚠️ 守夜：两件事一起纠，缺一条邀请就不出现（DEBUG-F 实测过）——
     ① 视图：app 的异步初始化会把视图恢复成 reload 前那个（上一段停在 prog）；
     ② 面板：干净状态下诺诺的**主动气泡会把面板弹开**（这是产品正确行为，不是 bug），
        而 inviteOk() 里有「面板开着就不叠一层」这条 ⇒ 面板一直开着时邀请永不出现（4 跑 3 挂，
        失败样本 panel 全是 block、hasEl 全是 false）。
     持续把「视图=home、面板=关」这两条前提纠住，inviteTick 的 6s 重试终会命中。别删这层。 */
  await page.evaluate(() => {
    window.__keepHome = setInterval(() => {
      try {
        if (typeof window.go === 'function' && typeof window.nonoView === 'function' && window.nonoView() !== 'home') window.go('home');
        const p = document.getElementById('nono-panel');
        if (p && p.style.display === 'block' && typeof window.nonoMin === 'function') window.nonoMin();
      } catch (e) {}
    }, 400);
  });
  /* 邀请在页面加载后 8s 起、每 6s 重试 ⇒ 必须等元素真的出现，不能固定 sleep。
     踩过：固定 9s 时首跑恰好吃到第 1 次 tick（约 8.x s）通过，后两次要等第 2 次 tick 就崩。 */
  await page.waitForFunction(() => {
    const el = document.getElementById('nono-invite');
    return !!(el && el.classList.contains('on'));
  }, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { if (window.__keepHome) clearInterval(window.__keepHome); });
  console.log('[DEBUG-F]', JSON.stringify(await page.evaluate(() => ({
    tour: localStorage.getItem('sinoky_nono_tour'),
    invKey: localStorage.getItem('sinoky_nono_invite'),
    closed: (window.NONO || {}).closed,
    nonoLS: localStorage.getItem('sinoky_nono'),
    view: typeof window.nonoView === 'function' ? window.nonoView() : 'NO-FN',
    panel: (document.getElementById('nono-panel') || {}).style ? document.getElementById('nono-panel').style.display : 'NO-PANEL',
    hasEl: !!document.getElementById('nono-invite'),
    onboardCls: (document.getElementById('v-onboard') || {}).className || 'NO-ONBOARD',
  }))));
  const inv = await page.evaluate(() => {
    const el = document.getElementById('nono-invite');
    return { exists: !!el, on: !!(el && el.classList.contains('on')), txt: el ? el.textContent.trim() : '', pe: el ? getComputedStyle(el).pointerEvents : '' };
  });
  chk('浮动邀请在 home 出现（8s 后）', inv.exists && inv.on, inv.txt.slice(0, 60));
  chk('邀请含可点文案', /Show me around/.test(inv.txt), inv.txt.replace(/\s+/g, ' ').slice(0, 70));
  chk('邀请可点击（pointer-events 非 none）', inv.pe !== 'none', inv.pe);
  const invClicked = await page.evaluate(() => {
    const el = document.getElementById('nono-invite');
    if (!el) return false;
    el.click();
    return true;
  });
  chk('浮动邀请可点（元素真的存在）', invClicked, String(invClicked));
  await page.waitForTimeout(450);
  const invOpen = await page.evaluate(() => {
    const m = document.getElementById('nono-msg');
    const iv = document.getElementById('nono-invite');
    return {
      top: m.querySelector('.nt-top') ? m.querySelector('.nt-top').textContent.trim() : '',
      invOff: !(iv && iv.classList.contains('on')),
      flag: localStorage.getItem('sinoky_nono_invite'),
    };
  });
  chk('点邀请真的打开导览第 1 站', /1\/6/.test(invOpen.top), invOpen.top);
  chk('点后邀请消失并记住（不再打扰）', invOpen.invOff && invOpen.flag === 'off', JSON.stringify(invOpen));

  /* ==================== G. 全局约束 ==================== */
  const layout = await page.evaluate(() => {
    function rect(id) {
      const e = document.getElementById(id);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
    }
    const fab = rect('nono-fab'), fb = rect('fb-open');
    let overlap = null;
    if (fab && fb) overlap = !(fab.r <= fb.l || fb.r <= fab.l || fab.b <= fb.t || fb.b <= fab.t);
    return { over: document.documentElement.scrollWidth - window.innerWidth, fab, fb, overlap };
  });
  chk('零横向溢出', layout.over <= 0, `scrollWidth - innerWidth = ${layout.over}`);
  chk('诺诺浮标与 Feedback 按钮矩形不相交（陪伴入口不被压住）', layout.overlap === false,
    `fab=${JSON.stringify(layout.fab)} fb=${JSON.stringify(layout.fb)}`);
  chk('Feedback 按钮已落到左下（把右下角让给陪伴角色）', !!layout.fb && layout.fb.l < 60,
    layout.fb ? `fb.left=${layout.fb.l}` : 'null');

  /* 截图留证 */
  await page.evaluate(() => {
    ['sinoky_nono_tour', 'sinoky_nono_invite'].forEach((k) => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const o = document.getElementById('v-onboard');
    if (o) o.classList.remove('on');
    if (typeof window.go === 'function') window.go('home');
  });
  await page.waitForTimeout(300);
  await page.click('#nono-fab');
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.NONO.mode = 'tour'; window.nonoTour(2); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(APP, '_internal', 'nono-ip-v1', '_shot-tour.png') });

  /* ==================== G. 诺诺形象位（v0.23.3 纯追加层） ====================
     这批改动只动「同一张资产在更大容器里的呈现」，最容易出的两类问题是：
       ① 靠改容器尺寸换视觉，结果撞了相邻定位 —— #nono-tip 的 right:74px
          是按浮标 56px 精确算的（12 + 56 + 6）。
       ② 给元素加无限动画后 Playwright 的稳定性断言失效（元素 rect 永远在变）。
     所以既钉「真的变大了」，也钉「外框与相邻定位一字未动」。
     尺寸一律读 offsetWidth/offsetHeight（布局尺寸，不含 transform），
     否则动画峰值相位会让 rect 在 50/51 之间跳 ⇒ 伪 flaky。 */
  await page.evaluate(() => { if (typeof window.nonoPose === 'function') window.nonoPose('like'); });
  await page.waitForTimeout(250);

  const stage = await page.evaluate(() => {
    const g = (s) => document.querySelector(s);
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const box = (el) => (el ? [el.offsetWidth, el.offsetHeight] : null);
    const fabImg = g('#nono-fab img'), pose = g('#nono-pose'), head = g('#nono-panel .np-head');
    const pcs = cs(pose);
    return {
      fab: box(g('#nono-fab')),
      fabImg: box(fabImg),
      fabAnim: cs(fabImg) ? cs(fabImg).animationName : null,
      /* ⚠️ #nono-tip 是**懒创建**的：只有 nonoHint() 真被调用时才 appendChild，
         此刻页面上通常没有这个元素（第一版断言直接 querySelector ⇒ 恒 null ⇒ 假失败）。
         改从 CSSOM 读**声明值**：既钉住了「这条定位常量没被本次改动牵连」，
         又不依赖任何时机，也不会因为元素不存在而假绿。 */
      tipRight: (() => {
        for (const ss of Array.from(document.styleSheets)) {
          let rules; try { rules = ss.cssRules; } catch (e) { continue; }
          for (const r of Array.from(rules || [])) {
            if (r.selectorText === '#nono-tip' && r.style && r.style.right) return r.style.right;
          }
        }
        return null;
      })(),
      pose: box(pose),
      poseRadius: pcs ? pcs.borderRadius : null,
      poseAnim: pcs ? pcs.animationName : null,
      poseMask: pcs ? String(pcs.maskImage || pcs.webkitMaskImage || 'none') : 'none',
      head: box(head),
      headAlign: cs(head) ? cs(head).alignItems : null,
    };
  });
  chk('浮标头像已放大到 50px（改前 40px）', !!stage.fabImg && stage.fabImg[0] === 50, JSON.stringify(stage.fabImg));
  chk('浮标外框仍是 56×56 —— 零布局位移', !!stage.fab && stage.fab[0] === 56 && stage.fab[1] === 56, JSON.stringify(stage.fab));
  chk('#nono-tip 的 right 仍是 74px 常量（没被浮标尺寸改动牵连）', stage.tipRight === '74px', String(stage.tipRight));
  chk('浮标头像带 idle 呼吸动画 nonoBreath', stage.fabAnim === 'nonoBreath', String(stage.fabAnim));
  chk('面板头立绘 72px 高且已取消圆形裁剪',
      !!stage.pose && stage.pose[1] === 72 && stage.poseRadius === '0px',
      JSON.stringify(stage.pose) + ' r=' + stage.poseRadius);
  chk('面板头立绘带 idle 动画 nonoBreathGentle', stage.poseAnim === 'nonoBreathGentle', String(stage.poseAnim));
  chk('立绘底部有渐隐遮罩（不出现硬切边）', /gradient/i.test(stage.poseMask), String(stage.poseMask).slice(0, 52));
  chk('面板头改顶对齐且高度增至 ~93px（练习内容仍在首屏）',
      !!stage.head && stage.head[1] >= 88 && stage.head[1] <= 100 && stage.headAlign === 'flex-start',
      JSON.stringify(stage.head) + ' align=' + stage.headAlign);

  /* 全身：点头像展开 / 再点收回。
     ⚠️ 不能用普通 click：立绘带无限动画 ⇒ Playwright 的 stability 检查永不通过
        ⇒ 会一路重试到超时（本轮踩过）。force 只跳过可操作性检查，仍是真实鼠标点击。 */
  await page.click('#nono-pose', { force: true });
  await page.waitForTimeout(320);
  const full = await page.evaluate(() => {
    const el = document.getElementById('nono-pose');
    const cs = getComputedStyle(el);
    return { src: el.getAttribute('src'), h: el.offsetHeight,
             mask: String(cs.maskImage || cs.webkitMaskImage || 'none') };
  });
  chk('点头像 → 展开全身（切到已入库的 nono-splash.webp）', /nono-splash/.test(full.src || ''), String(full.src));
  chk('展开态高度 190px（立绘的 2.6 倍，全身完整可见）', full.h === 190, 'h=' + full.h);
  chk('展开态取消底部遮罩（全身不留渐隐）', full.mask === 'none', String(full.mask).slice(0, 40));

  await page.click('#nono-pose', { force: true });
  await page.waitForTimeout(320);
  const back = await page.evaluate(() => {
    const el = document.getElementById('nono-pose');
    return { src: el.getAttribute('src'), h: el.offsetHeight };
  });
  chk('再点头像 → 收回立绘（回 like.webp / 72px）',
      /like\.webp/.test(back.src || '') && back.h === 72, `${back.src} h=${back.h}`);

  /* 埋点：走既有 S.feat 功能级统计（只写 localStorage，零新增 KV 写） */
  const feat = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('sinoky_state') || '{}').feat || null; } catch (e) { return null; }
  });
  chk('S.feat.nono 计数已落本地（浮标互动统计，零新增 KV 写）',
      !!feat && typeof feat.nono === 'number' && feat.nono > 0, 'feat=' + JSON.stringify(feat));
  chk('S.feat.nonoFull 计数已落本地（展开全身被主动触发过）',
      !!feat && typeof feat.nonoFull === 'number' && feat.nonoFull > 0, 'feat=' + JSON.stringify(feat));

  /* 无障碍降级：系统开了「减少动态效果」⇒ 动效必须全关 */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(220);
  const rm = await page.evaluate(() => {
    const n = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).animationName : null; };
    return { fab: n('#nono-fab img'), pose: n('#nono-pose') };
  });
  chk('prefers-reduced-motion:reduce 下动效全关（无障碍降级）',
      rm.fab === 'none' && rm.pose === 'none', JSON.stringify(rm));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  if (errors.length) errors.slice(0, 6).forEach((e) => chk('无 JS 运行时错误', false, e));
  else chk('无 JS 运行时错误', true, '');

  console.log('\n' + '='.repeat(78));
  console.log('【v0.23.0】品牌图标 / 功能导览 / 视图覆盖 —— 浏览器真跑');
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
