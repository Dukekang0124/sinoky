// test_selfsrc.mjs —— v0.23.8 组 1 前端验收：自测设备标记（?src=test 持久化）
//
// A/B 对比：同一套断言跑「新版 index.html」与「基线版 index.html」（BASE_REF）。
//   新版必须全绿；旧版必须「压根没有 SELF_SRC」—— 这才证明是新改动引入的行为，
//   而不是本来就有的东西（否则断言等于没测）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// ESM 不认 NODE_PATH，playwright 装在托管工作区 ⇒ 从那里解析
const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \u2705 ' + name); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
};
/* 基线必须钉死到「修复前的那个提交」，不能取 git HEAD：
   修复一旦提交 HEAD 就变成新版，A/B 前提当场失效 ——
   脚本会以「旧版竟然已修复」的形式报假缺陷。
   （实测：提交 v0.23.8 后三套测试的 B 组集体变红，而产品侧毫无问题。）
   307764a = v0.23.7 = 这几件修复落地前的最后一个提交，永久在历史里。
   基线过期时跳过而不是失败。 */
const BASE_REF = process.env.SINOKY_BASE_REF || '307764a';
let skip = 0;
const skp = (name) => { skip++; console.log('  ' + String.fromCharCode(0x23ed) + '  ' + name); };

// 取基线版（不经 git checkout，避免动工作区）
const OLD = path.join(HERE, '_old_index.html');
try {
  const buf = execFileSync('git', ['show', BASE_REF + ':index.html'], { cwd: APP, maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(OLD, buf);
} catch (e) { console.error('取基线版失败：' + e.message); process.exit(1); }

function serve(filePath, port) {
  const s = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(filePath));
    } else { res.writeHead(404); res.end(''); }
  });
  return new Promise((r) => s.listen(port, '127.0.0.1', () => r(s)));
}

const P_NEW = 8110, P_OLD = 8111;
const sNew = await serve(path.join(APP, 'index.html'), P_NEW);
const sOld = await serve(OLD, P_OLD);

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function probe(port, urlPath, ctx) {
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:' + port + urlPath, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    has: typeof window.SELF_SRC !== 'undefined',
    src: window.SELF_SRC,
    ls: (function () { try { return localStorage.getItem('sinoky_self'); } catch (e) { return '__err__'; } })(),
    bs: (typeof window.buildStat === 'function') ? window.buildStat().src : '__no_buildStat__',
  }));
  await page.close();
  return r;
}

console.log('\n=== A. \u65b0\u7248\uff08\u5e26 SELF_SRC\uff09 ===');
{
  const ctx = await browser.newContext();
  const a1 = await probe(P_NEW, '/?src=test', ctx);
  ok('A1 ?src=test \u2192 SELF_SRC=test', a1.src === 'test', JSON.stringify(a1));
  ok('A2 ?src=test \u2192 \u672c\u5730\u6253\u6807 sinoky_self=1', a1.ls === '1', String(a1.ls));
  ok('A3 ?src=test \u2192 buildStat().src=test', a1.bs === 'test', String(a1.bs));

  const a2 = await probe(P_NEW, '/', ctx);            // 同 context：共享 localStorage
  ok('A4 \u53bb\u6389\u53c2\u6570\u540e\u4ecd\u4e3a test\uff08\u6301\u4e45\u751f\u6548\uff09', a2.src === 'test', JSON.stringify(a2));
  ok('A5 \u53bb\u6389\u53c2\u6570\u540e buildStat().src \u4ecd\u4e3a test', a2.bs === 'test', String(a2.bs));

  const a3 = await probe(P_NEW, '/?src=real', ctx);
  ok('A6 ?src=real \u53ef\u6e05\u9664\uff08\u6062\u590d real\uff09', a3.src === 'real', JSON.stringify(a3));
  ok('A7 ?src=real \u6e05\u6389\u672c\u5730\u6253\u6807', a3.ls === '', JSON.stringify(a3.ls));

  const ctx2 = await browser.newContext();            // \u5168\u65b0\u6d4f\u89c8\u5668\uff08\u65e0 localStorage\uff09
  const a4 = await probe(P_NEW, '/', ctx2);
  ok('A8 \u65b0\u8bbe\u5907\u9ed8\u8ba4 real', a4.src === 'real' && a4.bs === 'real', JSON.stringify(a4));
  await ctx.close(); await ctx2.close();
}

const BASE_STALE = fs.readFileSync(OLD, 'utf8').includes('SELF_SRC');
console.log('=== B. 基线版（' + BASE_REF + '）- 应根本没有这个机制 ===');
if (!BASE_STALE) {
  const ctx = await browser.newContext();
  const b1 = await probe(P_OLD, '/?src=test', ctx);
  ok('B1 \u65e7\u7248\u65e0 SELF_SRC\uff08\u8bc1\u660e\u662f\u65b0\u589e\u884c\u4e3a\uff09', b1.has === false, JSON.stringify(b1));
  ok('B2 \u65e7\u7248 buildStat() \u4e0d\u5e26 src', b1.bs === undefined, String(b1.bs));
  await ctx.close();
} else {
  skp('B1/B2 基线 ' + BASE_REF + ' 已含 SELF_SRC（基线过期）⇒ 跳过 A/B；修复：把 BASE_REF 改成更早的提交');
}

await browser.close();
sNew.close(); sOld.close();

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log('\u7ed3\u679c\uff1a' + pass + ' \u901a\u8fc7 / ' + fail + ' \u5931\u8d25' + (skip ? ' / ' + skip + ' \u8df3\u8fc7\uff08A/B \u57fa\u7ebf\u8fc7\u671f\uff09' : ''));
console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
process.exit(fail ? 1 : 0);
