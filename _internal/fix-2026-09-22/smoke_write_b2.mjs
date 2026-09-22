/**
 * smoke_write_b2.mjs — v0.23.20 B2「语法/写作教练」内置浏览器真跑自测
 *
 * 只做静态检查/单测不算验收（康哥铁律）⇒ 用本机 Chrome 真渲染首页，
 * 走一遍：写作卡出现 → 输入中文 → 点"检查我的中文" → 渲染改正句 → 点"读出来" → 诺诺面板接住。
 * 另验：切西班牙语后卡面文案为西语（零英文 fallback）。
 *
 * 坑位（沿用 probe-splash-live 的教训）：
 *   · page.route 不拦 SW 请求 ⇒ serviceWorkers:'block'
 *   · route 后注册优先 ⇒ 通用 abort 先注册，具体 /api/chat 后注册
 *   · 本地 http 下 API_BASE='' ⇒ 请求落在同源 /api/chat，mock 即可
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../');           // sinoky-app
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' ) p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { res.writeHead(500); res.end('err'); }
});

let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log('  \u2705 %s %s', id, m); };
const no = (id, m) => { fail++; console.log('  \u274c %s %s', id, m); };

const CORRECTED = '我每天喝茶。';
const FEEDBACK = '把「喝」放对了，很自然。再加个时间词更地道。';

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = 'http://127.0.0.1:' + PORT;
console.log('server on', BASE);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 900 } });

// 通用：拦截一切外部请求，避免真的打网络
await context.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  return route.abort();
});
// 具体：mock /api/chat（后注册优先）
let chatHits = [];
await context.route('**/api/chat', (route) => {
  let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
  chatHits.push(body);
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reply: CORRECTED + '\n' + FEEDBACK, model: 'glm-4-flash', degraded: false }) });
});

const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.addInitScript(() => { try { localStorage.setItem('sinoky_tour', '1'); } catch (e) {} });

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
// 造进度：让 writeEligible()=true，再重渲染首页
await page.evaluate(() => {
  try {
    S.phrases = { s1: [1, 2], s2: [1] };
    S.dayDone = { 1: true };
    S.lang = 'en';
    if (typeof go === 'function') go('home'); else renderHome();
    renderHome();
  } catch (e) { return 'ERR:' + e.message; }
});
await page.waitForTimeout(300);

console.log('--- B2-B1 写作卡出现在首页 ---');
const hasInput = await page.locator('#wcx-input').count();
hasInput ? ok('B1', 'textarea#wcx-input 存在') : no('B1', 'textarea#wcx-input 缺失');
const hasBtn = await page.locator('#wcx-btn').count();
hasBtn ? ok('B2', '检查按钮存在') : no('B2', '检查按钮缺失');
const cardTitle = await page.locator('#wcx-input').evaluate((el) => el.closest('.card').querySelector('h2').textContent).catch(() => '');
cardTitle && cardTitle.includes('Write a sentence') ? ok('B3', '卡标题=Write a sentence（英文态）') : no('B3', '卡标题异常: ' + cardTitle);
await page.screenshot({ path: path.join(SHOTS, 'b2-card.png'), fullPage: false });

console.log('--- B2-B2 提交批改 → 渲染改正句 ---');
await page.fill('#wcx-input', '我喝茶');
await page.click('#wcx-btn');
await page.waitForSelector('#wcx-result .wcx-hz', { timeout: 5000 }).catch(() => {});
const corrected = await page.locator('#wcx-result .wcx-hz').textContent().catch(() => '');
corrected === CORRECTED ? ok('B4', '改正句渲染正确: ' + corrected) : no('B4', '改正句异常: ' + JSON.stringify(corrected));
const feedback = await page.locator('#wcx-result .wcx-fb').textContent().catch(() => '');
/时间词/.test(feedback) ? ok('B5', '说明渲染正确') : no('B5', '说明异常: ' + JSON.stringify(feedback));
// ⚠️ 首页渲染还会触发 daily / plan 的 /api/chat 调用 ⇒ 必须按 mode 过滤，不能取 chatHits[0]
const correctHits = chatHits.filter((h) => h.mode === 'correct');
console.log('    /api/chat modes seen:', JSON.stringify(chatHits.map((h) => h.mode)));
correctHits.length === 1 ? ok('B6', '恰有 1 次 mode=correct') : no('B6', 'correct 次数异常: ' + correctHits.length);
correctHits[0] && /我的中文：我喝茶/.test(correctHits[0].text) ? ok('B7', '正文含用户输入') : no('B7', '正文缺用户输入: ' + JSON.stringify(correctHits[0] && correctHits[0].text));
await page.screenshot({ path: path.join(SHOTS, 'b2-result.png'), fullPage: false });

console.log('--- B2-B3 读出来 → 诺诺跟读闭环 ---');
await page.click('#wcx-read');
await page.waitForTimeout(500);
const practice = await page.locator('#nono-practice').textContent().catch(() => '');
const panelShown = await page.locator('#nono-panel').evaluate((el) => getComputedStyle(el).display).catch(() => '');
practice.includes(CORRECTED) ? ok('B8', '诺诺练习区接住改正句') : no('B8', '练习区异常: ' + JSON.stringify(practice.slice(0, 60)));
panelShown !== 'none' ? ok('B9', '诺诺面板已打开 (display=' + panelShown + ')') : no('B9', '面板未打开');
await page.screenshot({ path: path.join(SHOTS, 'b2-readout.png'), fullPage: false });

console.log('--- B2-B4 切西班牙语：卡面为西语（零英文 fallback）---');
await page.evaluate(() => { try { if (typeof setLang === 'function') setLang('es'); else { S.lang = 'es'; } } catch (e) {} });
await page.waitForTimeout(900);
await page.evaluate(() => { try { if (typeof go === 'function') go('home'); renderHome(); } catch (e) {} });
await page.waitForTimeout(300);
const esTitle = await page.locator('#wcx-input').evaluate((el) => el.closest('.card').querySelector('h2').textContent).catch(() => '');
esTitle.includes('Escribe una frase') ? ok('B10', '西语卡标题正确: ' + esTitle) : no('B10', '西语标题异常: ' + JSON.stringify(esTitle));
const esBtn = await page.locator('#wcx-btn').textContent().catch(() => '');
esBtn.includes('Revisar mi chino') ? ok('B11', '西语按钮正确: ' + esBtn) : no('B11', '西语按钮异常: ' + JSON.stringify(esBtn));
await page.screenshot({ path: path.join(SHOTS, 'b2-es.png'), fullPage: false });

console.log('--- 页面错误 ---');
errs.length === 0 ? ok('B12', '无 pageerror') : no('B12', 'pageerror: ' + errs.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
