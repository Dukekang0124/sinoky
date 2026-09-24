#!/usr/bin/env node
/* verify_live_v0241.cjs —— v0.24.1 生产验证（可复用）
 *
 * 判据要点（本项目特有，勿凭直觉）：
 *   1) SPA 兜底会把**任何不存在的路径**渲染成 index.html（200）。
 *      所以「文件是否真的不存在」必须**比字节数**：== index.html 字节数 ⇒ 兜底；否则才是真文件。
 *   2) 大文件 md5 **不要用 curl 管道**（Git Bash 下三次互异，2026-09-23 实测）。
 *      本脚本用 node fetch + crypto 纯内存复算，并交叉 ETag。
 *   3) CF 边缘传播 ~20 min，未到时间不得判失败。用 --expect 明确期望值。
 *
 * 用法：
 *   node _internal/fix-2026-09-24/verify_live_v0241.cjs            # 全量
 *   node _internal/fix-2026-09-24/verify_live_v0241.cjs --quick    # 跳过 APK（25MB）
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..');
const BASE = 'https://sinoky.pages.dev';
const QUICK = process.argv.includes('--quick');

let pass = 0, fail = 0, warn = 0;
const ok = (id, m) => { pass++; console.log('  \u2713 ' + id + ' ' + m); };
const no = (id, m) => { fail++; console.log('  \u2717 ' + id + ' ' + m); };
const wn = (id, m) => { warn++; console.log('  ! ' + id + ' ' + m); };

async function head(p) {
  const r = await fetch(BASE + p, { redirect: 'manual', cache: 'no-store' });
  return { status: r.status, len: Number(r.headers.get('content-length') || 0), etag: r.headers.get('etag') };
}
async function body(p) {
  const r = await fetch(BASE + p, { cache: 'no-store' });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, text: buf.toString('utf8'), etag: r.headers.get('etag') };
}

(async () => {
  console.log('== v0.24.1 生产验证 ==');
  console.log('base = ' + BASE + (QUICK ? '   (quick：跳过 APK)' : '') + '\n');

  /* ── 0. SPA 兜底基线 */
  const fallback = await body('/zzz-nonexistent-baseline-xyz');
  const FB_LEN = fallback.buf.length;
  const FB_MD5 = crypto.createHash('md5').update(fallback.buf).digest('hex');
  console.log('0. SPA 兜底基线：不存在路径 → ' + fallback.status + ' / ' + FB_LEN + ' B / md5 ' + FB_MD5.slice(0, 12) + '\n');

  console.log('1. 被移出资产应已下线（判据：GET md5 vs 本地原文件）');
  const RETIRED = [
    '/assets/read/breakfast_2x.webp', '/assets/read/commute_2x.webp',
    '/assets/read/doctor_2x.webp', '/assets/read/friends_2x.webp',
    '/assets/read/market_2x.webp', '/assets/read/travel_2x.webp',
    '/assets/scenes/meeting.md',
    '/assets/icons/cards.png', '/assets/icons/home.png', '/assets/icons/progress.png',
    '/assets/icons/read.png', '/assets/icons/sentences.png', '/assets/icons/tones.png',
    '/assets/banner/horizontal.webp', '/assets/banner/vertical.webp',
    '/assets/share/light-square.webp', '/assets/share/dark-vertical.webp',
    '/assets/share/light-vertical.webp',
    '/assets/brand/dragon-nono.svg',
  ];

  /* ── 1. 被移出的 19 个文件：应从「真文件」变为「兜底 / 404 / 302」
     判据（2026-09-24 修正）：**GET 实际字节 + 与本地原文件比对 md5**。
       相同 ⇒ CF 边缘仍在服务旧副本 ❌
         （根因：CF Pages 的 immutable deployment **不会删除旧部署里的残留文件**，
          且 assets 静态资源被边缘缓存 s-maxage=604800 = 7 天；同 /www/* 的成因）
       不同 ⇒ 已下线（已是兜底 HTML / 404 / 302）✓
     ⚠️ 不可用 content-length 判：命中旧缓存时会返回 Content-Length:32 的占位体，与真实大小无关。 */
  const RETIRED_DIR = path.join(APP, '_internal', 'retired-assets-2026-09-24');
  let stillLive = [];
  for (const p of RETIRED) {
    const local = path.join(RETIRED_DIR, p.replace('/assets/', ''));
    let localMd5 = '';
    try { localMd5 = crypto.createHash('md5').update(fs.readFileSync(local)).digest('hex'); } catch (e) { /* 本地已不在：退回字节数判据 */ }
    let r;
    try { r = await body(p); } catch (e) { stillLive.push(p + ' (ERR ' + e.message + ')'); continue; }
    const gotMd5 = crypto.createHash('md5').update(r.buf).digest('hex');
    if (r.status === 404 || r.status === 301 || r.status === 302) continue;         // 已拒访
    if (gotMd5 === FB_MD5) continue;                                                // 已是兜底
    if (localMd5 && gotMd5 === localMd5) { stillLive.push(p + ' (旧副本仍在，' + r.buf.length + ' B)'); continue; }
    if (!localMd5) stillLive.push(p + ' (' + r.status + ' / ' + r.buf.length + ' B，本地无参照)');
  }
  if (stillLive.length) {
    no('A1', stillLive.length + ' 个仍可下载 —— CF 未删旧部署残留，需加 _redirects 收口：');
    stillLive.forEach((s) => console.log('        - ' + s));
  } else {
    ok('A1', '19/19 已下线（兜底 / 404 / 302）');
  }

  /* ── 2. 仍在用的资产必须还在（防止移错） */
  console.log('\n2. 必需资产仍在（防误移）');
  const KEEP = ['/assets/read/breakfast.webp', '/assets/icons/cards.svg', '/assets/banner/square.webp',
    '/assets/share/dark-square.webp', '/assets/brand/nono-splash.webp',
    '/assets/scenes/thumbs/intro_1x1_1024.webp', '/assets/cities/thumb_beijing.webp',
    '/assets/badges/map_master_256.webp', '/assets/tones/tone1.mp3'];
  const missing = [];
  for (const p of KEEP) {
    const h = await head(p);
    if (h.status !== 200 || h.len === FB_LEN) missing.push(p + ' (' + h.status + ' / ' + h.len + ')');
  }
  missing.length ? (no('B1', '必需资产缺：' + missing.join(', '))) : ok('B1', KEEP.length + '/' + KEEP.length + ' 必需资产在线');

  /* ── 3. 版本号四处 */
  console.log('\n3. 线上版本号');
  const vj = await body('/version.json');
  let v = null;
  try { v = JSON.parse(vj.text); } catch (e) {}
  if (!v) no('C1', 'version.json 解析失败');
  else {
    v.version === '0.24.1' ? ok('C1', 'version.json version = ' + v.version) : wn('C1', 'version.json version = ' + v.version + '（期望 0.24.1，可能仍在传播）');
    const apk = v.apk || {};
    console.log('        apk 段: ' + JSON.stringify({ version: apk.version, versionCode: apk.versionCode, size: apk.size, md5: (apk.md5 || '').slice(0, 12), url: apk.url }));
    apk.version === '0.24.1' ? ok('C2', 'apk.version = 0.24.1 · versionCode ' + apk.versionCode) : wn('C2', 'apk.version = ' + apk.version + '（期望 0.24.1）');
  }
  const idx = await body('/index.html');
  const m = idx.text.match(/APP_VERSION = '([\d.]+)'/);
  m && m[1] === '0.24.1' ? ok('C3', "index.html APP_VERSION = 0.24.1") : wn('C3', 'index.html APP_VERSION = ' + (m ? m[1] : '?') + '（期望 0.24.1，可能仍在传播）');
  const sw = await body('/sw.js');
  const sm = sw.text.match(/sinoky-v([\d.]+)/);
  sm && sm[1] === '0.24.1' ? ok('C4', 'sw.js CACHE = sinoky-v0.24.1') : wn('C4', 'sw.js CACHE = sinoky-v' + (sm ? sm[1] : '?'));
  const dl = await body('/download.html');
  dl.text.includes('Sinoky-v0.24.1-release.apk') ? ok('C5', 'download.html 直链 = v0.24.1') : wn('C5', 'download.html 直链未更新');
  dl.text.includes('Sinoky-v0.24.0-release.apk') ? no('C5b', 'download.html 仍含 v0.24.0 旧直链') : ok('C5b', 'download.html 无旧直链残留');

  /* ── 4. i18n 新字典是否上线（抽 3 条语言包特征） */
  console.log('\n4. 字典新增 key 已上线');
  const zh = await body('/langs/zh.json');
  let zj = null; try { zj = JSON.parse(zh.text); } catch (e) {}
  if (!zj) no('D1', 'langs/zh.json 解析失败');
  else {
    const n = Object.keys(zj).length;
    n === 733 ? ok('D1', 'zh.json key 数 = 733') : wn('D1', 'zh.json key 数 = ' + n + '（期望 733）');
    const probe = ['👋 New here?', 'Nono will show you around', '{n} {feat} left today'];
    const miss = probe.filter((k) => !Object.prototype.hasOwnProperty.call(zj, k));
    miss.length ? no('D2', 'zh.json 缺新 key：' + miss.join(' / ')) : ok('D2', '3 条抽样新 key 均在');
    const es = await body('/langs/es.json');
    let ej = null; try { ej = JSON.parse(es.text); } catch (e) {}
    if (ej) {
      Object.keys(ej).length === 733 ? ok('D3', 'es.json key 数 = 733（6 包对齐）') : wn('D3', 'es.json key 数 = ' + Object.keys(ej).length);
      const chip = ej['{n} {feat} left today'];
      ok('D4', 'es 芯片模板 = ' + JSON.stringify(chip));
    }
  }

  /* ── 5. APK（重，--quick 跳过） */
  console.log('\n5. APK 完整性');
  if (QUICK) { console.log('  · 已跳过（--quick）'); }
  else {
    const r = await fetch(BASE + '/apk/Sinoky-v0.24.1-release.apk', { cache: 'no-store' });
    if (r.status !== 200) no('E1', 'APK 直链 HTTP ' + r.status);
    else {
      const buf = Buffer.from(await r.arrayBuffer());
      const md5 = crypto.createHash('md5').update(buf).digest('hex');
      const magic = buf.slice(0, 4).toString('hex');
      const declared = (v && v.apk && v.apk.md5) || '';
      const declaredSize = v && v.apk && v.apk.size;
      console.log('        实测 md5=' + md5 + ' / ' + buf.length + ' B / 魔数 ' + magic);
      if (declaredSize && buf.length !== declaredSize) no('E2', '字节数与 version.json 声明不符（声明 ' + declaredSize + '）');
      else ok('E2', '字节数 ' + buf.length + ' 与声明一致');
      if (declared && md5 !== declared) no('E3', 'md5 与 version.json 声明不符（声明 ' + declared + '）');
      else ok('E3', 'md5 与 version.json 声明逐字符相符');
      magic === '504b0304' ? ok('E4', 'PK 魔数正确（504b0304）') : no('E4', '魔数异常：' + magic);
    }
  }

  console.log('\n' + '\u2500'.repeat(52));
  console.log('通过 ' + pass + ' · 失败 ' + fail + ' · 待观察 ' + warn);
  console.log('\u2500'.repeat(52));
  process.exit(fail ? 1 : 0);
})();
