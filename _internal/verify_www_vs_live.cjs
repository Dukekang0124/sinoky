/* www/ 构建产物 vs 线上部署 —— 只读，不写任何文件。
 *
 * 为什么需要它：应急部署（token 直连 `wrangler pages deploy www`）绕过 CI，
 * 万一本地 www 落后于线上（实测过 version.json 的 apk 段还停在 md5:"" size:0），
 * 一部署就把线上正确的元数据抹掉 ⇒ 所有 App 用户收不到更新，且线上表面毫无异常。
 * 所以「先比对、再部署」必须是动作，不是记性。
 *
 * 判据（默认「快速模式」，两个维度）：
 *   ① 键集合：CF API 取最新 production deployment 的 files 清单（1228 键），
 *      与本地 www 逐路径比「多 / 少」——抓漏文件与残余文件；
 *   ② 内容：~20 个「体积小但致命」的文本文件逐个 GET 比 md5
 *      —— 抓 version.json / sw.js / langs 这类会静默咬人的差异。
 *
 * 用法：
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node _internal/verify_www_vs_live.cjs
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node _internal/verify_www_vs_live.cjs --full   # 全量 GET（慢，且可能被 CF 限流）
 * 退出码：0 = 一致（可安全部署）；1 = 有差异（禁止部署）；2 = 无法判定（网络/权限）
 *
 * 🔴 踩过的两个坑（别重犯）：
 *   1. 对 1230 个文件做 6 并发 GET，会触发 CF 高频限流，返回**统一 52 字节错误页**，
 *      于是 212 个文件被误报「线上只有 52 字节」——纯假阳性。默认模式因此不再全量 GET。
 *   2. 跟随重定向时**必须解析 Location**（`new URL(loc, url)`）。CF Pages 对 /x.html
 *      返回 **308 → /x**（相对路径）；直接用原 URL 重试会拿到 308 的空 body（0 字节），
 *      又被误报成「线上为空」。
 *   另：CF manifest 的 hash 是内部算法（非 md5 / sha256 / blake3 原文或 gzip/brotli 体），
 *      实测无法离线复现 ⇒ 不要幻想「本地算 hash 就能全量比对」。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.BASE || 'https://sinoky.pages.dev';
const OUT = path.join(__dirname, '..', 'www');
const TOKEN_FILE = 'C:/Users/Admin/.sinoky-secrets/CLOUDFLARE_API_TOKEN.txt';
const FULL = process.argv.includes('--full');

// 不走「静态清单」的三类特殊文件（均已实测确认，不是差异）：
//   _worker.js                     → Pages Functions 通道
//   _headers / _redirects          → Pages 部署配置（被 CF 读取执行，不作为资源对外）
const SPECIAL = new Set(['_worker.js', '_headers', '_redirects']);
// 「体积小但致命」的文本文件（漏一个就可能让用户收不到更新 / 页面静默挂掉）
const CRITICAL = [
  'index.html', 'sw.js', 'version.json', 'manifest.webmanifest', 'APK_VERSION.txt',
  'langs/zh.json', 'langs/es.json', 'langs/ru.json', 'langs/vi.json', 'langs/id.json', 'langs/th.json',
  'download.html', 'privacy.html', 'stats.html', 'credits.html',
  'robots.txt', 'sitemap.xml',
];

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const clip = (s, n = 160) => (s.length > n ? s.slice(0, n) + '…' : s);

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
    else out.push(r);
  }
  return out;
}

function req(url, opts = {}, tries = 3) {
  return new Promise((resolve, reject) => {
    const goWithUrl = (n, u) => {
      const r = https.get(u || url, { headers: Object.assign({ 'User-Agent': 'node', 'Cache-Control': 'no-cache' }, opts.headers || {}) }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n > 0) {
          res.resume();
          return goWithUrl(n - 1, new URL(res.headers.location, u || url).href);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          // 高频限流会返回统一短页（实测 52 bytes）；不当作内容，直接重试
          if (n > 0 && res.statusCode !== 200) { setTimeout(() => goWithUrl(n - 1, u || url), 900); return; }
          if (n > 0 && Buffer.concat(chunks).length === 52 && opts.guardShort) { setTimeout(() => goWithUrl(n - 1, u || url), 900); return; }
          resolve({ s: res.statusCode, buf: Buffer.concat(chunks), u: u || url });
        });
      });
      r.setTimeout(25000, () => r.destroy(new Error('timeout')));
      r.on('error', (e) => (n > 0 ? setTimeout(() => goWithUrl(n - 1, u || url), 900) : reject(e)));
    };
    goWithUrl(tries, url);
  });
}

function api(p) {
  const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  return req('https://api.cloudflare.com/client/v4' + p, { headers: { Authorization: 'Bearer ' + t } })
    .then((r) => { if (r.s !== 200) throw new Error('CF API ' + r.s + ': ' + clip(r.buf.toString('utf8'))); return JSON.parse(r.buf.toString('utf8')); });
}

(async () => {
  const local = walk(OUT);
  let fails = 0;

  /* ── ① 键集合比对（CF API，零下载）────────────────────────────── */
  console.log('=== ① 键集合比对（CF API 权威清单）===');
  try {
    const acc = await api('/accounts');
    const A = acc.result[0].id;
    const list = await api('/accounts/' + A + '/pages/projects/sinoky/deployments?per_page=1');
    const dep = list.result[0];
    const detail = await api('/accounts/' + A + '/pages/projects/sinoky/deployments/' + dep.id);
    const remote = new Set(Object.keys(detail.result.files || {}));
    console.log('线上最新部署：' + dep.id + '（' + dep.environment + '，' + dep.created_on + '）');
    console.log('清单键 ' + remote.size + ' 个 / 本地文件 ' + local.length + ' 个');

    const localSet = new Set(local.filter((f) => !SPECIAL.has(f)).map((f) => '/' + f));
    const onlyLocal = [...localSet].filter((f) => !remote.has(f));
    const onlyRemote = [...remote].filter((f) => !localSet.has(f));
    // 本地没有、线上也没有的配置类文件属正常（Functions/配置上传通道不同）
    if (onlyLocal.length) { console.log('❗ 只在本地有（部署会新增 ' + onlyLocal.length + ' 个）：'); onlyLocal.slice(0, 20).forEach((f) => console.log('   + ' + f)); fails += onlyLocal.length; }
    if (onlyRemote.length) {
      console.log('❗ 只在线上有（部署会**删除** ' + onlyRemote.length + ' 个，注意是否误删生产资源）：');
      onlyRemote.slice(0, 20).forEach((f) => console.log('   - ' + f));
      if (onlyRemote.some((f) => /^\/apk\/.*\.apk$/.test(f))) {
        console.log('   🔴 线上 APK 实体会被删掉 ⇒ App 用户点「更新」直接 404。先跑：node _internal/fetch_apk.cjs');
      }
      fails += onlyRemote.length;
    }
    if (!onlyLocal.length && !onlyRemote.length) console.log('✅ 键集合完全一致（不多不少）');
    console.log('   注：' + [...SPECIAL].join('/') + ' 走 Functions 通道，不在静态清单内，已排除。');
  } catch (e) {
    console.log('⚠️ 键集合比对无法完成：' + e.message);
    console.log('   （无 token / 权限不足 / 网络问题时会走到这里，不算失败，但结论不完整）');
  }

  /* ── ② 关键文本文件内容比对 ──────────────────────────────────── */
  console.log('\n=== ② 关键文件内容比对（逐字节 md5）===');
  for (const f of CRITICAL) {
    const lp = path.join(OUT, f);
    if (!fs.existsSync(lp)) { console.log('❌ ' + f + '：本地不存在'); fails++; continue; }
    const lb = fs.readFileSync(lp);
    const url = BASE + '/' + (f === 'index.html' ? '' : f);
    try {
      const r = await req(url, { guardShort: true });
      if (r.s !== 200) { console.log('❌ ' + f + '：线上 HTTP ' + r.s + ' ' + clip(r.buf.toString('utf8'), 80)); fails++; continue; }
      const same = md5(r.buf) === md5(lb);
      if (!same) { console.log('❌ ' + f + '：md5 ' + md5(lb).slice(0, 10) + ' vs 线上 ' + md5(r.buf).slice(0, 10) + '（' + lb.length + ' vs ' + r.buf.length + ' bytes）'); fails++; }
      else console.log('✅ ' + f);
    } catch (e) { console.log('⚠️ ' + f + '：取回失败 ' + e.message); fails++; }
  }

  /* ── ③ 边缘收口断言（内部文件不得公网直下）────────────────────── */
  console.log('\n=== ③ 边缘收口断言（内部文件应被 302 到首页）===');
  for (const f of ['badge-backend.mjs', '_internal/wait_apk.py', 'package.json']) {
    try {
      const r = await req(BASE + '/' + f, { guardShort: true });
      const head = r.buf.toString('utf8').slice(0, 60);
      const isHome = /<!DOCTYPE html>/i.test(head);
      if (r.s === 200 && !isHome) { console.log('❌ ' + f + ' 公网可直下原始内容（HTTP ' + r.s + '，' + r.buf.length + ' bytes）'); fails++; }
      else console.log('✅ ' + f + ' 已收口（HTTP ' + r.s + (isHome ? ' → 首页兜底' : '') + '）');
    } catch (e) { console.log('⚠️ ' + f + '：取回失败 ' + e.message); }
  }

  /* ── ④ 可选全量 ─────────────────────────────────────────────── */
  if (FULL) {
    console.log('\n=== ④ 全量 GET（低并发 2，可能慢）===');
    const rest = local.filter((f) => !SPECIAL.has(f) && !CRITICAL.includes(f));
    let done = 0;
    const worker = async (list) => {
      for (const f of list) {
        const lb = fs.readFileSync(path.join(OUT, f));
        try {
          const r = await req(BASE + '/' + f, { guardShort: true });
          if (r.s !== 200 || (md5(r.buf) !== md5(lb) && !/^apk\//.test(f))) { console.log('❌ ' + f + '（' + r.s + '，' + lb.length + ' vs ' + r.buf.length + '）'); fails++; }
        } catch (e) { console.log('⚠️ ' + f + '：' + e.message); fails++; }
        if (++done % 100 === 0) console.log('  …' + done + '/' + rest.length);
      }
    };
    const buckets = [[], []];
    rest.forEach((f, i) => buckets[i % 2].push(f));
    await Promise.all(buckets.map(worker));
  }

  console.log('\n' + (fails === 0
    ? '✅ 结论：本地 www 与线上一致 ⇒ 此时 `pages deploy www` 是幂等的（零变化）'
    : '❌ 结论：发现 ' + fails + ' 处不一致 ⇒ 禁止部署，先查明（尤其看 version.json / 键集合差集）'));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('无法判定：' + e.message); process.exit(2); });
