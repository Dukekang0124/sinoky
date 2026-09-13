/* ============================================================================
   诺诺「形象位」A/B 截图 —— 同一脚本跑改前/改后两个版本，产出可比对的证据图。

   为什么必须 A/B（康哥铁律 ⑤）：单版截图只能证明「现在长这样」，
   跑两版才能证明「我的改动造成了这个差异」。

   用法：
     node stage-ab.js <label>
     例：node stage-ab.js before   → D:/wbtmp/stage/before-fab.png / before-panel.png
         node stage-ab.js after    → D:/wbtmp/stage/after-fab.png  / after-panel.png

   要点：
     · 用 channel:'chrome' 驱动本机 Chrome（playwright 自带浏览器常未下载）
     · page.route 后注册优先 ⇒ 通用 mock 先注册，具体 mock 后注册
     · 面板是异步渲染的，等可见 + 等图加载完再截
   ============================================================================ */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const APP = 'D:\\写作工具\\知识管理\\01-Projects-项目\\求职与作品集\\03-作品集\\Sinoky\\sinoky-app';
const LABEL = process.argv[2] || 'x';
const OUT = 'D:\\wbtmp\\stage';
const PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function startServer() {
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    const fp = path.join(APP, u);
    fs.readFile(fp, (err, buf) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((r) => srv.listen(PORT, () => r(srv)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    locale: 'en-US',
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  // mock 外部 API（避免真实网络；route 后注册优先 → 通用规则先注册）
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));

  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  /* 不能整个 localStorage.clear()：清掉 sinoky_state 会触发首启引导层
     （#v-onboard 全屏、z-index:100），把浮标整个挡住 ⇒ click 命中 .ob-bar 而不是浮标。
     只把 onboarded 置真 + 清本轮的三个标记。（照搬 smoke-tour.js，那次的失败记录在案） */
  await page.evaluate(() => {
    try {
      const s = JSON.parse(localStorage.getItem('sinoky_state') || '{}');
      s.onboarded = true;
      localStorage.setItem('sinoky_state', JSON.stringify(s));
    } catch (e) {}
    ['sinoky_tour', 'sinoky_nono_tour', 'sinoky_nono_invite'].forEach((k) => localStorage.removeItem(k));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);          // 过启动屏窗口（420ms hide / 940ms 移除）

  /* 摘掉首启引导层并落到 home。
     ⚠️ 必须「摘 .on + 置 display:none」双管，且摘两次 —— app 的异步初始化会把 .on 加回来。 */
  const stripOnboard = () => page.evaluate(() => {
    const o = document.getElementById('v-onboard');
    if (o) { o.classList.remove('on'); o.style.display = 'none'; }
    if (typeof window.go === 'function') window.go('home');
    return true;
  });
  await stripOnboard();
  await page.waitForTimeout(500);
  await stripOnboard();                     // 再摘一次：覆盖 app 迟到的初始化

  // 等浮标真的可点（命中测试通过）
  await page.waitForFunction(() => {
    const f = document.getElementById('nono-fab');
    if (!f) return false;
    const r = f.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && (el === f || f.contains(el));
  }, null, { timeout: 8000 }).catch(() => {});

  // ① 浮标特写（含周围留白，便于看尺寸）
  await page.locator('#nono-fab').screenshot({ path: path.join(OUT, `${LABEL}-fab.png`), animations: 'disabled' });

  // ② 点开面板
  /* ⚠️ 先等浮标的 .bump 弹跳结束：nonoShow / nonoHint 会给 #nono-fab 加 .bump
     （1.1s 的 translateY 弹跳），期间 button 自身的 bounding box 一直在动，
     Playwright 的 stability 检查永远不通过 ⇒ click 会重试到超时（本轮踩过一次）。
     这是既有行为，不是本轮引入的；CI 里的 smoke 脚本同样要留意。 */
  await page.waitForFunction(() => {
    const f = document.getElementById('nono-fab');
    return !!f && !f.classList.contains('bump');
  }, null, { timeout: 10000 }).catch(() => {});
  await page.locator('#nono-fab').click({ timeout: 15000 });
  await page.waitForTimeout(900);
  const panel = page.locator('#nono-panel');
  await panel.waitFor({ state: 'visible', timeout: 5000 });
  // 等面板内所有图加载完
  await page.evaluate(() => Promise.all(
    Array.from(document.querySelectorAll('#nono-panel img')).map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))
  ));
  await page.waitForTimeout(400);
  await panel.screenshot({ path: path.join(OUT, `${LABEL}-panel.png`), animations: 'disabled' });

  // ③ 记下关键 DOM 事实（供断言与报告引用）
  const facts = await page.evaluate(() => {
    const cs = (el) => el ? getComputedStyle(el) : null;
    const fabImg = document.querySelector('#nono-fab img');
    const pose = document.querySelector('#nono-pose');
    const head = document.querySelector('#nono-panel .np-head');
    const R = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    return {
      fabBox: document.querySelector('#nono-fab') ? R(document.querySelector('#nono-fab')) : null,
      fabImgBox: fabImg ? R(fabImg) : null,
      fabImgRadius: cs(fabImg) ? cs(fabImg).borderRadius : null,
      fabImgAnim: cs(fabImg) ? cs(fabImg).animationName : null,
      poseBox: pose ? R(pose) : null,
      poseRadius: cs(pose) ? cs(pose).borderRadius : null,
      poseAnim: cs(pose) ? cs(pose).animationName : null,
      poseSrc: pose ? pose.getAttribute('src') : null,
      headBox: head ? R(head) : null,
      panelBox: document.querySelector('#nono-panel') ? R(document.querySelector('#nono-panel')) : null,
      // 是否有舞台 / 展开态容器
      stage: !!document.querySelector('#nono-stage'),
      stageBox: document.querySelector('#nono-stage') ? R(document.querySelector('#nono-stage')) : null,
      poseMask: cs(pose) ? (cs(pose).maskImage || cs(pose).webkitMaskImage || 'none') : null,
    };
  });

  console.log('=== ' + LABEL + ' ===');
  console.log(JSON.stringify(facts, null, 2));
  if (errs.length) console.log('JS 错误: ' + JSON.stringify(errs, null, 2));
  else console.log('JS 错误: 0');

  /* ④ 尺寸选型扫描：同一渲染环境下把立绘临时改到不同高度各截一张，
        供「为什么定 72px」的选型证据图。
        用内联 style 覆盖（优先级最高、不改任何源文件），扫完立即复原。 */
  const SCAN = [48, 72, 88, 104];
  for (const h of SCAN) {
    await page.evaluate((hh) => {
      const el = document.getElementById('nono-pose');
      if (el) { el.style.height = hh + 'px'; el.style.maxWidth = Math.round(hh * 1.5) + 'px'; }
    }, h);
    await page.waitForTimeout(180);
    await page.locator('#nono-pose').screenshot({ path: path.join(OUT, `${LABEL}-head-${h}.png`), animations: 'disabled' });
  }
  await page.evaluate(() => {
    const el = document.getElementById('nono-pose');
    if (el) { el.style.height = ''; el.style.maxWidth = ''; }
  });
  console.log('尺寸扫描已出图: ' + SCAN.join(' / ') + ' px');

  await browser.close();
  srv.close();
})();
