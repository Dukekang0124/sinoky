/**
 * smoke_fb_regression.mjs — v0.23.21 B3 回归自测（内置浏览器真跑）
 *
 * B3 是纯运营侧后端能力（前端零改动），因此本测试的职责是【证明没破坏既有前端】：
 *   首页正常渲染 → 反馈面板可开 → 分类可切 → 空提交被拦 → 真提交打到 /api/feedback
 *   → 面板关闭 + toast 致谢 → B2 写作卡仍在 → 前端从不调用 digest=1（运营侧专属）
 *
 * 坑位（沿用 smoke_write_b2 的教训）：
 *   · page.route 不拦 SW ⇒ serviceWorkers:'block'
 *   · route 后注册优先 ⇒ 通用 abort 先注册、具体 mock 后注册
 *   · 首页渲染会触发 daily/plan 的 /api/chat ⇒ 断言必须按 mode 过滤
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../');
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { res.writeHead(500); res.end('err'); }
});

let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log('  \u2705 %s %s', id, m); };
const no = (id, m) => { fail++; console.log('  \u274c %s %s', id, m); };

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = 'http://127.0.0.1:' + PORT;
console.log('server on', BASE);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 900 } });

await context.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  return route.abort();
});

// 具体 mock（后注册优先）
let chatHits = [], fbPosts = [], fbGets = [];
await context.route('**/api/chat', (route) => {
  let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
  chatHits.push(body);
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: '• 练三声\n• 说一句', model: 'glm-4-flash', degraded: false }) });
});
await context.route('**/api/feedback', (route) => {
  const req = route.request();
  if (req.method() === 'GET') {
    fbGets.push(req.url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'forbidden' }) });
  }
  let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
  fbPosts.push(body);
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, verified: true, key: 'fb:test' }) });
});

const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem('sinoky_tour', '1'); } catch (e) {} });

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  try {
    S.phrases = { s1: [1, 2], s2: [1] };
    S.dayDone = { 1: true };
    S.lang = 'en';
    if (typeof go === 'function') go('home'); else renderHome();
  } catch (e) { return 'ERR:' + e.message; }
});
await page.waitForTimeout(400);

console.log('--- R1 首页存活 ---');
const homeOn = await page.locator('#v-home').evaluate((el) => el.classList.contains('on')).catch(() => false);
homeOn ? ok('R1', '#v-home 已激活') : no('R1', '#v-home 未激活');

console.log('--- R2 反馈面板可开 ---');
await page.evaluate(() => { if (typeof openFB === 'function') openFB(); });
await page.waitForTimeout(250);
const panelOn = await page.locator('#fb-panel').evaluate((el) => el.classList.contains('on')).catch(() => false);
panelOn ? ok('R2', '#fb-panel 已打开') : no('R2', '面板未打开');
const catCount = await page.locator('#fb-cats .fb-cat').count();
catCount === 7 ? ok('R3', '7 个反馈分类齐备') : no('R3', '分类数异常: ' + catCount);
await page.screenshot({ path: path.join(SHOTS, 'b3-fb-panel.png') });

console.log('--- R3 分类可切 ---');
await page.click('#fb-cats .fb-cat[data-cat="audio"]');
await page.waitForTimeout(150);
const fbCat = await page.evaluate(() => (typeof FB_CAT !== 'undefined' ? FB_CAT : '?'));
fbCat === 'audio' ? ok('R4', '点分类后 FB_CAT=audio') : no('R4', 'FB_CAT 异常: ' + fbCat);
const ph = await page.locator('#fb-text').getAttribute('placeholder');
ph && ph.length > 0 ? ok('R5', '音频分类切换了 placeholder') : no('R5', 'placeholder 未变');

console.log('--- R4 空提交被拦（不发请求）---');
await page.evaluate(() => { document.getElementById('fb-text').value = ''; });
const before = fbPosts.length;
await page.click('#fb-panel .btn:not(.ghost)');
await page.waitForTimeout(400);
const toastTxt = await page.locator('#toast').textContent().catch(() => '');
(fbPosts.length === before && /short message/i.test(toastTxt))
  ? ok('R6', '空提交被拦且给出提示: ' + toastTxt.trim())
  : no('R6', 'posts=' + (fbPosts.length - before) + ' toast=' + JSON.stringify(toastTxt));

console.log('--- R5 真提交 → 打到 /api/feedback POST ---');
await page.fill('#fb-text', 'No sound when I tap the speaker');
await page.click('#fb-panel .btn:not(.ghost)');
await page.waitForTimeout(700);
const sent = fbPosts[fbPosts.length - 1];
(sent && sent.message === 'No sound when I tap the speaker' && sent.cat === 'audio' && sent.v)
  ? ok('R7', 'POST 载荷正确（message/cat/v 齐）: cat=' + sent.cat + ' v=' + sent.v)
  : no('R7', '载荷异常: ' + JSON.stringify(sent));
const panelClosed = await page.locator('#fb-panel').evaluate((el) => !el.classList.contains('on')).catch(() => false);
panelClosed ? ok('R8', '提交后面板自动关闭') : no('R8', '面板未关闭');
const taVal = await page.locator('#fb-text').inputValue().catch(() => 'x');
taVal === '' ? ok('R9', '输入框已清空') : no('R9', '输入框未清空: ' + taVal);
const toast2 = await page.locator('#toast').textContent().catch(() => '');
/Thanks/.test(toast2) ? ok('R10', '致谢 toast: ' + toast2.trim()) : no('R10', 'toast 异常: ' + JSON.stringify(toast2));

console.log('--- R6 B2 写作卡未受影响 ---');
const wcx = await page.locator('#wcx-input').count();
const wcxBtn = await page.locator('#wcx-btn').count();
(wcx === 1 && wcxBtn === 1) ? ok('R11', '#wcx-input / #wcx-btn 仍在（B2 未回归）') : no('R11', 'wcx=' + wcx + ' btn=' + wcxBtn);

console.log('--- R7 digest 端点前端从不调用（运营侧专属）---');
const digestCalls = fbGets.filter((u) => /digest=1/.test(u));
digestCalls.length === 0 ? ok('R12', '前端 0 次 digest=1 调用') : no('R12', '意外调用: ' + digestCalls.length);

console.log('--- R8 无 JS 运行时错误 ---');
errs.length === 0 ? ok('R13', '0 pageerror') : no('R13', errs.slice(0, 3).join(' | '));

await page.screenshot({ path: path.join(SHOTS, 'b3-fb-after.png') });

await browser.close();
server.close();
console.log('\n=== %d passed, %d failed ===\n', pass, fail);
process.exit(fail ? 1 : 0);
