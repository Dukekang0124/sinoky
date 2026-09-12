/* ============================================================================
   v0.23.0 —— 品牌图标 / 功能导览 / 视图覆盖：浏览器真跑验收
   ----------------------------------------------------------------------------
   为什么必须真跑（康哥铁律）：语法校验 / grep / diff 只证明「看起来对」。
   本脚本验证的是**行为**：
     · header 品牌图标真的换成「朱砂红底 + 熊猫」且红色真的占了可辨识比例
     · favicon 真的指向新图（浏览器标签上看到的才是用户看到的）
     · 导览入口真的在面板里（第三个 chip）且真的能逐站推进
     · 每站真的绑了汉字 + 拼音 + 英文释义（Edify Gate 的落点）
     · 「带我去」真的切到对应视图并收起面板
     · 3 个新视图真的出边角气泡且文案正确
     · 浮动邀请真的在 home 出现、真的可点开导览、真的可关
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
  /* 双保险：即使 state 没生效，也把引导层摘掉并落到 home */
  await page.evaluate(() => {
    const o = document.getElementById('v-onboard');
    if (o) o.classList.remove('on');
    if (typeof window.go === 'function') window.go('home');
  });
  await page.waitForTimeout(400);

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
      return new Promise((r) => {
        const im = new Image();
        im.onload = () => {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          const g = c.getContext('2d');
          g.drawImage(im, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let red = 0, solid = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] <= 25) continue;
            solid++;
            if (d[i] > 120 && d[i] - d[i + 1] > 45 && d[i] - d[i + 2] > 40) red++;
          }
          r({ w: im.naturalWidth, h: im.naturalHeight, ratio: solid ? red / solid : 0 });
        };
        im.onerror = () => r({ err: 1 });
        im.src = src + '?cb=' + Date.now();
      });
    }
    Promise.all([probe('icons/logo-header.png'), probe('icons/favicon-32.png')]).then(([a, b]) => {
      const link = document.querySelector('link[rel="icon"]');
      res({ logo: a, fav: b, iconHref: link ? link.getAttribute('href') : null });
    });
  }));
  chk('header 品牌图标可加载且尺寸 192×192', !iconStat.logo.err && iconStat.logo.w === 192 && iconStat.logo.h === 192, JSON.stringify(iconStat.logo));
  chk('header 品牌图标朱砂红占比 ≥ 30%（品牌色真的可见了）', !iconStat.logo.err && iconStat.logo.ratio >= 0.30, `实测 ${(iconStat.logo.ratio * 100 || 0).toFixed(1)}%（改前 2.05%）`);
  chk('favicon 可加载且尺寸 32×32', !iconStat.fav.err && iconStat.fav.w === 32 && iconStat.fav.h === 32, JSON.stringify(iconStat.fav));
  chk('favicon 朱砂红占比 ≥ 30%（浅色标签栏上不再隐形）', !iconStat.fav.err && iconStat.fav.ratio >= 0.30, `实测 ${(iconStat.fav.ratio * 100 || 0).toFixed(1)}%（改前 0.00%）`);
  chk('<link rel="icon"> 指向 icons/favicon-32.png', /icons\/favicon-32\.png/.test(iconStat.iconHref || ''), iconStat.iconHref);

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
  await page.evaluate(() => document.querySelector('#nono-modes .nm-chip.nm-tour').click());
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
    ['sinoky_nono_tour', 'sinoky_nono_invite'].forEach((k) => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const o = document.getElementById('v-onboard');
    if (o) o.classList.remove('on');
    if (typeof window.go === 'function') window.go('home');
  });
  await page.waitForTimeout(9000);                 /* 邀请在页面加载后 8s 出现，这里补足余量 */
  const inv = await page.evaluate(() => {
    const el = document.getElementById('nono-invite');
    return { exists: !!el, on: !!(el && el.classList.contains('on')), txt: el ? el.textContent.trim() : '', pe: el ? getComputedStyle(el).pointerEvents : '' };
  });
  chk('浮动邀请在 home 出现（8s 后）', inv.exists && inv.on, inv.txt.slice(0, 60));
  chk('邀请含可点文案', /Show me around/.test(inv.txt), inv.txt.replace(/\s+/g, ' ').slice(0, 70));
  chk('邀请可点击（pointer-events 非 none）', inv.pe !== 'none', inv.pe);
  await page.evaluate(() => document.getElementById('nono-invite').click());
  await page.waitForTimeout(450);
  const invOpen = await page.evaluate(() => {
    const m = document.getElementById('nono-msg');
    return {
      top: m.querySelector('.nt-top') ? m.querySelector('.nt-top').textContent.trim() : '',
      invOff: !document.getElementById('nono-invite').classList.contains('on'),
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
