// test_stats_board.mjs —— v0.23.8 组 1 看板验收：stats.html 是否正确消费新的 real / MAU 字段
//
// 为什么必须真跑：stats.html 是「字段名写错也不报错、只是显示 —」的页面。
// 静态检查看不出 rusers/rmau30 有没有接对，只有渲染出来看文本才知道。
// 做法：起本地 server 服务 stats.html，用 route mock 掉 /api/stats（返回固定数字），
//       然后逐卡读 textContent 比对期望值。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');
const PORT = 8112;

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (a === b) { pass++; console.log('  \u2705 ' + name); }
  else { fail++; console.log('  \u274c ' + name + '   \u671f\u671b ' + JSON.stringify(b) + ' \u5b9e\u5f97 ' + JSON.stringify(a)); }
};

const MOCK = {
  ok: true, asOf: '2026-09-13T03:00:00.000Z',
  users: 10, dau: 3, phraseSum: 50, mau7: 4, mau30: 7,
  real: { users: 8, test: 2, dau: 2, mau7: 3, mau30: 6, phrasesPerUser: 6.3, day1DoneRate: 25, toneUsageRate: 12.5, note: 'x' },
  retention: { d1: 50, d3: 33.3, d7: 15, eligible: { d1: 4, d3: 3, d7: 2 }, note: 'x' },
  northStar: { phrasesPerUser: 5, target: 10 },
  toneUsageRate: 40, firstDayCompletionRate: 60, day1DoneRate: 30,
  sceneDist: { arrival: 3 }, featDist: { tone: 2 },
  gate: {
    d7: { target: 15, actual: 15, pass: true, enough: true },
    northStar: { target: 10, actual: 5, pass: false, enough: true },
    firstDay: { target: 60, actual: 60, pass: true, enough: true },
    tone: { target: 40, actual: 40, pass: true, enough: true },
  },
};

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/stats.html' || u === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(APP, 'stats.html')));
  } else { res.writeHead(404); res.end(''); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route('**/api/stats*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK) }));

await page.goto('http://127.0.0.1:' + PORT + '/stats.html?token=t', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

const txt = (id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return el ? el.textContent.trim() : '__missing__';
}, id);

console.log('\n=== A. \u65b0\u589e\u5361\u7247\uff08\u771f\u5b9e vs \u81ea\u6d4b + MAU\uff09 ===');
eq('A1 Real users', await txt('rusers'), '8');
eq('A2 Self-test devices', await txt('tusers'), '2');
eq('A3 MAU 30d (real)', await txt('rmau30'), '6');
eq('A4 MAU 7d (real)', await txt('rmau7'), '3');
eq('A5 MAU 30d (all)', await txt('mau30'), '7');
eq('A6 MAU 7d (all)', await txt('mau7'), '4');
eq('A7 Phrases / real user', await txt('rppu'), '6.3');
eq('A8 Finished Day 1 (real)', await txt('rday1'), '25%');

console.log('\n=== B. \u65e7\u5361\u7247\u672a\u88ab\u7834\u574f ===');
eq('B1 Total users', await txt('users'), '10');
eq('B2 Active today', await txt('dau'), '3');
eq('B3 Phrases per user', await txt('ppu'), '5');
eq('B4 Finished Day 1', await txt('day1'), '30%');
eq('B5 Day 7 retention', await txt('d7'), '15%');

console.log('\n=== C. \u964d\u7ea7\u5b89\u5168\uff1a\u540e\u7aef\u8fd4\u56de\u65e7\u683c\u5f0f\uff08\u65e0 real/mau\uff09\u4e0d\u5d29 ===');
await page.unroute('**/api/stats*');
await page.route('**/api/stats*', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ ok: true, asOf: MOCK.asOf, users: 1, dau: 1, phraseSum: 0, retention: MOCK.retention, northStar: MOCK.northStar, gate: MOCK.gate, sceneDist: {}, featDist: {} }),
}));
await page.goto('http://127.0.0.1:' + PORT + '/stats.html?token=t', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
eq('C1 \u65e7\u683c\u5f0f\u4e0b Real users \u663e\u793a\u4e3a\u2014', await txt('rusers'), '\u2014');
eq('C2 \u65e7\u683c\u5f0f\u4e0b\u9875\u9762\u4ecd\u6e32\u67d3\uff08Total users \u6b63\u5e38\uff09', await txt('users'), '1');

await browser.close();
server.close();
console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log('\u7ed3\u679c\uff1a' + pass + ' \u901a\u8fc7 / ' + fail + ' \u5931\u8d25');
console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
process.exit(fail ? 1 : 0);
