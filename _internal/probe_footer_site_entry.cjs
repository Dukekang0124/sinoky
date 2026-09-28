#!/usr/bin/env node
/* probe_footer_site_entry.cjs —— v0.29.3：产品内新增「官网入口」的真跑验证
 *
 * 为什么需要它（而不是只做静态检查）：
 *   `.foot` 是一行 `text-align:center` 的**小字细排**（font-size:10.5px），
 *   往里加一个链接等于往一条已经接近满行的行盒里再塞字 —— 会不会撑破、会不会挤成三行、
 *   新增的 `<a>` 有没有吃到既有的「24px 可点区」约定（那条约定写在
 *   `a[href="privacy.html"],…,a[onclick^="openShare"]{padding:5px 3px;margin:-5px -3px}` 里，
 *   是我这次必须同步扩的选择器），**只有真跑能确认**。语法校验/看源码都只能证明"我写了"。
 *
 * 判据：
 *   F1 `.foot` 里存在 href="landing/index.html" 的链接（常驻官网入口）
 *   F2 该链接可点区高度 ≥ 24px（与 Privacy / Share 同约定），且颜色与 Privacy 一致
 *      （不一致 = 没吃到选择器 ⇒ 会回落浏览器默认蓝/紫，即历史 B10 缺陷）
 *   F3 三视口下 body 无横向溢出（`scrollWidth ≤ innerWidth + 1`）
 *   F4 三视口下 `.foot` 实际行数 ≤ 3（挤成 4 行以上就是排版事故）
 *   F5 「Install App · Unlimited」按钮的跳转目标 = landing/download.html（下载入口已收敛）
 *   F6 零 pageerror / 零 console error
 * 产出截图：_internal/_shots/footer-entry-{360,390}.png
 *
 * 🔴 安全：page.route 拦掉全部 /api/* ⇒ **零生产写入**（本地起 server，不碰线上）。
 * 用法：NODE_PATH=<workbuddy node workspace>/node_modules node _internal/probe_footer_site_entry.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '_shots');
const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'application/javascript;charset=utf-8',
  '.json': 'application/json;charset=utf-8', '.css': 'text/css;charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json',
};
const VIEWPORTS = [{ w: 360, h: 740 }, { w: 390, h: 844 }, { w: 768, h: 1024 }];

const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log('  ✓ ' + m); };
const ng = (m) => { fail.push(m); console.log('  ✗ ' + m); };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(String(req.url).split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p.replace(/^\//, ''));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
});

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  const errs = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(`[${vp.w}] pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/ERR_FAILED|ERR_ABORTED/.test(m.text())) errs.push(`[${vp.w}] console: ${m.text()}`);
    });
    /* 拦 /api/*：本探针不需要真实后端，且必须零生产写入 */
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.indexOf(BASE) === 0) {
        return new URL(u).pathname.indexOf('/api/') === 0
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"uid":"probe-uid"}' })
          : route.continue();
      }
      return route.abort();
    });
    /* 跳过语言门与首启引导：本探针只量页脚，不需要走完 onboarding */
    await page.addInitScript(() => {
      try { localStorage.setItem('sinoky_lang_chosen', '1'); localStorage.removeItem('sinoky_state'); } catch (e) {}
    });

    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof S === 'object' && typeof go === 'function', null, { timeout: 20000 });
    await page.evaluate(() => {
      ['lang-gate', 'splash', 'intro', 'onboard', 'v-onboard'].forEach((id) => {
        const e = document.getElementById(id); if (e) e.style.display = 'none';
      });
      go('home');
      /* 页脚在首页 section 最底部，滚到底才能确认它在真实滚动位置下的排布 */
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
      const foot = document.querySelector('#v-home .foot');
      if (!foot) return { foot: false };
      const link = foot.querySelector('a[href="landing/index.html"]');
      const priv = foot.querySelector('a[href="privacy.html"]');
      const lr = link && link.getBoundingClientRect();
      const cs = link && getComputedStyle(link);
      const pcs = priv && getComputedStyle(priv);
      const cs2 = getComputedStyle(foot);
      const lh = parseFloat(cs2.lineHeight) || (parseFloat(cs2.fontSize) * 1.4);
      const out = {
        foot: true,
        hasLink: !!link,
        href: link && link.getAttribute('href'),
        linkH: lr ? Math.round(lr.height) : 0,
        linkColor: cs && cs.color,
        privColor: pcs && pcs.color,
        privH: priv ? Math.round(priv.getBoundingClientRect().height) : 0,
        footH: Math.round(foot.getBoundingClientRect().height),
        lines: Math.round(foot.getBoundingClientRect().height / lh),
        footRight: Math.round(foot.getBoundingClientRect().right),
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        installOnclick: null,
      };
      /* 「Install App · Unlimited」按钮**不是静态 DOM** —— 它由 showLimitWall() 现场拼出。
         想断言它的跳转目标就必须真把它渲染出来，不能去静态搜源码（那只是证明我写了什么）。

         🔴 坑：showLimitWall 是**闭包内函数**，全局不存在，只挂在 `window.SK` 上
         （`window.SK = { …, showLimitWall: showLimitWall, … }`）。
         写成 `typeof showLimitWall === 'function'` 恒为 false ⇒ 整段被静默跳过、按钮恒找不到，
         而报错信息只会说「没渲染出来」，把「我没调到」误诊成「产品没渲染」。
         凡是要真调产品内部函数，一律先确认它是 window 上的还是命名空间上的。 */
      try {
        if (typeof window.setLang === 'function') window.setLang('en');   // 文案断言需要确定语言
        out.hasSK = !!(window.SK && typeof window.SK.showLimitWall === 'function');
        out.unlocked = window.SK ? window.SK.isUnlocked() : null;
        if (out.hasSK) window.SK.showLimitWall('chat');
        out.panelRendered = !!document.getElementById('limitWall');
        const btns = Array.prototype.slice.call(document.querySelectorAll('#limitWall button'));
        out.buttons = btns.map((x) => ({
          t: (x.textContent || '').trim().slice(0, 40),
          c: x.className,
          o: x.getAttribute('onclick') || '',
        }));
        /* 识别按钮**不靠文案**（文案随语言/字典变动），靠结构：面板里唯一的 primary 按钮 */
        const b = btns.filter((x) => /\bbtn\b/.test(x.className) && /\bprimary\b/.test(x.className))[0];
        out.installOnclick = b ? (b.getAttribute('onclick') || '') : null;
        out.installText = b ? (b.textContent || '').trim() : null;
        out.panelHasOldApk = /Sinoky-v\d/.test(document.getElementById('limitWall').innerHTML);
        window.closeOvl('limitWall');
      } catch (e) { out.installOnclick = 'ERR: ' + e.message; }
      return out;
    });

    if (!r.foot) { ng(`[${vp.w}] 找不到 #v-home .foot`); await ctx.close(); continue; }

    if (vp.w === 360) {
      if (!r.hasLink) ng('F1 页脚缺 href="landing/index.html" 的官网入口');
      else ok(`F1 页脚官网入口存在（href="${r.href}"）`);
      if (r.linkH < 24) ng(`F2 官网入口可点区高 ${r.linkH}px < 24px（未吃到 padding 约定）`);
      else ok(`F2 官网入口可点区 ${r.linkH}px ≥ 24px（Privacy ${r.privH}px，同一约定）`);
      if (r.linkColor !== r.privColor) ng(`F2 官网入口颜色 ${r.linkColor} ≠ Privacy ${r.privColor}（没吃到选择器 ⇒ 会回落浏览器默认色）`);
      else ok(`F2 官网入口颜色与 Privacy 一致（${r.linkColor}）`);
      if (!r.hasSK) ng('F5 window.SK.showLimitWall 不可用（限额墙无法被真调出来验证）');
      else if (!r.panelRendered) ng('F5 SK.showLimitWall("chat") 没渲染出 #limitWall 面板' + (r.unlocked ? '（当前为已解锁态 ⇒ 函数开头 if(isUnlocked()) return 直接返回）' : ''));
      else if (!r.installOnclick) ng('F5 限额墙里找不到 primary 按钮；面板内按钮 = ' + JSON.stringify(r.buttons));
      else if (r.installOnclick.indexOf('landing/download.html') < 0) ng(`F5 安装按钮跳转目标未收敛："${r.installOnclick}"（文案「${r.installText}」）`);
      else ok(`F5 安装按钮跳转目标 = landing/download.html（现场渲染，文案「${r.installText}」）`);
      if (r.panelRendered && r.panelHasOldApk) ng('F5 限额墙里仍残留 Sinoky-vX.Y.Z-release.apk 硬编码直链');
      else if (r.panelRendered) ok('F5 限额墙内零 Sinoky-vX.Y.Z-release.apk 硬编码直链');
    }
    if (r.sw > r.iw + 1) ng(`F3 [${vp.w}] 横向溢出 scrollWidth=${r.sw} > ${r.iw}（页脚 right=${r.footRight}）`);
    else ok(`F3 [${vp.w}] 无横向溢出（scrollWidth=${r.sw}）`);
    if (r.lines > 3) ng(`F4 [${vp.w}] 页脚排成 ${r.lines} 行（>3 = 排版事故，高 ${r.footH}px）`);
    else ok(`F4 [${vp.w}] 页脚 ${r.lines} 行（高 ${r.footH}px）`);

    if (vp.w !== 768) {
      const foot = await page.$('#v-home .foot');
      if (foot) await foot.screenshot({ path: path.join(OUT, `footer-entry-${vp.w}.png`) });
    }
    await ctx.close();
  }

  if (errs.length) ng('F6 JS 错误：\n      ' + [...new Set(errs)].slice(0, 6).join('\n      '));
  else ok('F6 零 pageerror / 零 console error（三视口）');

  await browser.close(); srv.close();
  console.log('\n──── 页脚官网入口真跑 ────');
  console.log(`通过 ${pass.length} 项，失败 ${fail.length} 项`);
  console.log('截图：_internal/_shots/footer-entry-*.png');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(2); });
