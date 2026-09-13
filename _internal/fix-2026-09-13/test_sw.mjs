/**
 * test_sw.mjs —— Service Worker 修复的**行为层**验收（v0.23.8 FIX · 组 3）
 *
 * 为什么必须有这个测试：
 *   修 sw.js 的引号，语法闸门只能证明「文件能被解析」。
 *   但这件事真正的用户价值是「**SW 真的注册成功、离线能力真的可用**」——
 *   而 install 阶段是 `caches.addAll(ASSETS)`，**all-or-nothing**：
 *   33 条里只要有一条 404，install 就 reject，SW 依旧装不上。
 *   ⇒ 光静态检查 = 假绿。必须真起浏览器、真注册、真等 ready 返回。
 *
 * A/B 设计（证明「这是本轮修好的」而不是「本来就好」）：
 *   A 组 = 当前工作区（sw.js 已修）
 *   B 组 = sw.js 换成基线版（307764a = v0.23.7，15 条裸路径）—— 同一个 HTTP 服务只覆盖 /sw.js
 *   同一套断言跑两遍，B 组必须**在超时内拿不到 ready**。
 *
 * 本机环境（见长期记忆）：
 *   · Playwright 自带浏览器常未下载 ⇒ 必须 channel:'chrome' 驱动本机 Chrome
 *   · ESM 不认 NODE_PATH ⇒ createRequire 指定 workspace 解析 playwright
 *   · file:// 下 SW / fetch 不工作 ⇒ 必须起 http server
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/Admin/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..', '..');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  \u2705 ' + m); };
const no = (m) => { fail++; console.log('  \u274c ' + m); };
/* 基线必须钉死到「修复前的那个提交」，不能取 git HEAD：
   修复一旦提交，HEAD 就变成新版，A/B 前提当场失效 ——
   脚本会以「旧版竟然已修复」的形式报假缺陷。
   （本项目实测过一次：提交 v0.23.8 后 test_sw / test_tone_src / test_selfsrc
     的 B 组集体变红，而产品侧毫无问题。）
   307764a = v0.23.7，是这几件修复落地前的最后一个提交，永久存在于历史里。
   基线过期时跳过而不是失败 —— 不让它伪装成产品缺陷。 */
const BASE_REF = process.env.SINOKY_BASE_REF || '307764a';
let skip = 0;
const skp = (m) => { skip++; console.log('  ' + String.fromCharCode(0x23ed) + '  ' + m); };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};

/** 起一个只读静态服务器；swOverride 非空时用它替换 /sw.js 的响应体（A/B 用） */
function serve(swOverride) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/sw.js' && swOverride !== null) {
        resp.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
        return resp.end(swOverride);
      }
      const rel = u === '/' ? 'index.html' : u.replace(/^\/+/, '');
      const fp = path.join(APP, rel);
      if (!fp.startsWith(APP) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        resp.writeHead(404); return resp.end('nf');
      }
      resp.writeHead(200, {
        'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      resp.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

/** 在 page 上注册并等 ready；返回 {ready, cacheKeys, swScope, err} */
async function probe(page, port, waitMs) {
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
  return await page.evaluate(async (waitMs) => {
    const out = { ready: false, cacheKeys: [], scope: null, err: null };
    if (!('serviceWorker' in navigator)) { out.err = 'no serviceWorker'; return out; }
    // index.html 自己已经 register 过一次；再取一次句柄只是为了拿 registration 对象
    let reg = null;
    try { reg = await navigator.serviceWorker.getRegistration(); } catch (e) { out.err = String(e); }
    if (!reg) {
      try { reg = await navigator.serviceWorker.register('sw.js'); }
      catch (e) { out.err = 'register: ' + (e && e.message); }
    }
    const t = new Promise((r) => setTimeout(r, waitMs));
    try {
      await Promise.race([
        navigator.serviceWorker.ready.then((r) => { out.ready = true; out.scope = r.scope; }),
        t,
      ]);
    } catch (e) { out.err = 'ready: ' + (e && e.message); }
    try { out.cacheKeys = await caches.keys(); } catch (e) {}
    return out;
  }, waitMs);
}

const BASE_SW = (() => {
  const r = spawnSync('git', ['show', BASE_REF + ':sw.js'], { cwd: APP, encoding: 'utf8' });
  return (r.status === 0 && r.stdout) ? r.stdout : '';
})();
/* 基线是否过期：基线里必须还有裸路径（即仍是语法错误），否则说明基线取晚了 */
const BASE_STALE = !BASE_SW || !/(^|\n)\s*\.\/[^\s',\"]+,?\s*$/m.test(BASE_SW);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    // ─────────────── A. 当前工作区（已修） ───────────────
    console.log('\n=== A. 当前工作区 —— SW 应注册成功 ===');
    {
      const { srv, port } = await serve(null);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const r = await probe(page, port, 12000);
      r.ready ? ok('A1 navigator.serviceWorker.ready 在 12s 内返回 ⇒ 注册 + install 成功')
              : no('A1 ready 超时/失败：' + r.err);
      r.scope && r.scope.indexOf('127.0.0.1') > -1 ? ok('A1b scope = ' + r.scope) : no('A1b scope 异常: ' + r.scope);
      const want = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8').match(/var CACHE = '([^']+)'/)[1];
      r.cacheKeys.includes(want) ? ok('A2 Cache Storage 已建立 ' + want)
                                 : no('A2 未找到 cache ' + want + '，实得 ' + JSON.stringify(r.cacheKeys));

      // A3：install 是 addAll(33 条) —— 逐条确认真的进缓存了（all-or-nothing 的兑现）
      const n = await page.evaluate(async (c) => {
        const c1 = await caches.open(c);
        const ks = await c1.keys();
        return ks.length;
      }, want);
      n >= 30 ? ok('A3 预缓存条目 ' + n + ' 条（ASSETS 33 条，含 ./ 与 index.html 归一）')
              : no('A3 预缓存条目只有 ' + n + ' 条，install 可能未跑完');

      // A4：断网后仍能拿到 index.html（真正的离线能力）
      await ctx.setOffline(true);
      const off = await page.evaluate(async () => {
        try { const r = await fetch('index.html', { cache: 'no-store' }); return { s: r.status, t: (await r.text()).length }; }
        catch (e) { return { s: 0, err: String(e) }; }
      });
      await ctx.setOffline(false);
      off.s === 200 && off.t > 10000 ? ok('A4 断网后 index.html 仍可达（' + off.t + ' B）⇒ 离线可用')
                                     : no('A4 断网回落失败：' + JSON.stringify(off));

      // A5：数据/脚本请求断网时**不能**拿到 HTML（M13 修的另一半）
      await ctx.setOffline(true);
      const dj = await page.evaluate(async () => {
        try {
          const r = await fetch('data/flashcards-levels.json', { cache: 'no-store' });
          const t = await r.text();
          return { s: r.status, looksHtml: /^\s*</.test(t) };
        } catch (e) { return { s: 0, err: String(e) }; }
      });
      await ctx.setOffline(false);
      dj.looksHtml ? no('A5 断网取 json 拿到了 HTML（M13 未修好）：' + JSON.stringify(dj))
                   : ok('A5 断网取 json 未返回 HTML（M13 语义正确）：' + JSON.stringify(dj));

      await ctx.close(); srv.close();
    }

    // ─────────────── B. 基线版 sw.js（坏，按 BASE_REF 取） ───────────────
    console.log('\n=== B. 基线版 sw.js（' + BASE_REF + '）—— 应根本无法注册（证明是本次修好的）===');
    if (!BASE_STALE) {
      const { srv, port } = await serve(BASE_SW);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const r = await probe(page, port, 6000);
      !r.ready ? ok('B1 ready 在 6s 内拿不到 ⇒ 基线版 SW 确实装不上（潜伏 bug 复核）')
               : no('B1 基线版竟然 ready 了 —— A/B 前提不成立');
      (r.cacheKeys || []).length === 0 ? ok('B2 基线版 Cache Storage 为空（install 从未成功）')
                                       : no('B2 基线版却有 cache：' + JSON.stringify(r.cacheKeys));
      await ctx.close(); srv.close();
    } else {
      skp('B1/B2 基线 ' + BASE_REF + ' 已不含裸路径（基线过期）⇒ 跳过 A/B；修复：把 BASE_REF 改成更早的提交');
    }
  } finally {
    await browser.close();
  }
  console.log('\n──────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败' + (skip ? ' / ' + skip + ' 跳过（A/B 基线过期）' : ''));
  console.log('──────────────────────────────');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
