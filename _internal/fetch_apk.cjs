/* 把「当前版本的 APK 实体」补进 www/apk/ —— 应急部署（绕过 CI）前必做的一步。
 *
 * 根因：CI 在部署前会 `cp dist/*.apk www/apk/`（apk.yml 第 485-486 行），
 *   而本机构建产物 `www/` 里**从来没有** APK。
 *   CF Pages 部署是「整包替换」⇒ 本地缺 `apk/` 就把线上 APK 一起删掉，
 *   线上 version.json 还指向它 ⇒ App 用户点「更新」直接 404。
 *   （2026-09-27 用 _internal/verify_www_vs_live.cjs 的键集合比对才发现，此前无人察觉）
 *
 * 做法：读 version.json 的 apk.url / md5 / size，下载到内存 → 校验 size + md5 + PK 魔数
 *       → 落盘 www/apk/<文件名>。校验不过就不落盘（宁可失败也不写坏文件）。
 *
 * 用法：NODE_TLS_REJECT_UNAUTHORIZED=0 node _internal/fetch_apk.cjs
 * 退出码：0 = 已就绪（或本地已存在且校验通过）；1 = 失败
 *
 * v2（2026-09-28 实证）：单源「线上 URL」会自举死锁 —— 部署是整包替换，一旦某次
 *   build 后没跑本脚本就部署，线上 APK 即被删（SPA 兜底返回 index.html，200 OK），
 *   此后本脚本从线上只能下到 HTML，永远恢复不了。
 *   ⇔ 改多源回退（顺序即优先级），每一源都跑「PK 魔数 + md5 + size」三重校验：
 *     ① 持久本地缓存 _internal/apk-cache/（发版后随手备份一次，永久免疫此坑）
 *     ② GitHub Release（CI 出包时上传，最稳）
 *     ③ 线上 Pages URL（只在证明还活着时有意义，放最后）
 *   ⚠️ CF 对已删资源/SPA 兜底都会缓存 ⇒ 线上 200 不代表是 APK，必须判 PK 魔数。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
const apk = vj.apk || {};
if (!apk.url || !apk.md5 || !apk.size) {
  console.error('✗ version.json 的 apk 段不完整（url/md5/size 需齐全）：' + JSON.stringify(apk));
  process.exit(1);
}
const name = apk.url.split('/').pop();
const dest = path.join(ROOT, 'www', 'apk', name);
const ver = apk.version || vj.version;
const cachePath = path.join(__dirname, 'apk-cache', name);
// 顺序即优先级；本地缓存非 http，走文件分支
const SOURCES = [
  ['本地持久缓存', cachePath],
  ['GitHub Release', `https://github.com/Dukekang0124/sinoky/releases/download/v${ver}/${name}`],
  ['线上 Pages', apk.url],
];

function get(url, tries = 3) {
  return new Promise((resolve, reject) => {
    const go = (n) => https.get(url, { headers: { 'User-Agent': 'node' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n > 0) {
        r.resume();
        return go(n - 1, new URL(r.headers.location, url).href);
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', (e) => (n > 0 ? setTimeout(() => go(n - 1), 800) : reject(e)));
    go(tries);
  });
}

function verify(buf) {
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;   // PK
  return { md5, isZip, ok: buf.length === apk.size && md5 === apk.md5 && isZip };
}

(async () => {
  if (fs.existsSync(dest)) {
    const b = fs.readFileSync(dest);
    const v = verify(b);
    if (v.ok) { console.log('✅ www/apk/' + name + ' 已存在且校验通过（' + b.length + ' bytes）'); return; }
    console.log('⚠️ www/apk/' + name + ' 存在但校验不过，重新拉取');
  }
  const tried = [];
  for (const [label, src] of SOURCES) {
    let buf = null;
    try {
      if (fs.existsSync(src)) {
        buf = fs.readFileSync(src);
        console.log('读取 ' + label + '：' + src);
      } else {
        console.log('下载 ' + label + '：' + src + ' …');
        buf = await get(src);
      }
    } catch (e) { tried.push(`${label}: ${e.message}`); console.log(`   ✗ ${label} 取不到（${e.message}）`); continue; }
    const v = verify(buf);
    console.log(`   size ${buf.length} / 期望 ${apk.size}`);
    console.log(`   md5  ${v.md5} / 期望 ${apk.md5}`);
    console.log(`   PK 魔数 ${v.isZip ? '✅' : '❌（SPA 兜底页或残缺包）'}`);
    if (!v.ok) { tried.push(`${label}: 校验不过`); continue; }
    // 落盘两处：www/apk/（部署用）+ 持久缓存（下次免下载，免疫「线上被删」死锁）
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, buf);
    console.log('✅ 已写入 www/apk/' + name + ' + 持久缓存 _internal/apk-cache/（校验通过）');
    return;
  }
  console.error('✗ 所有来源都取不到真包：\n   - ' + tried.join('\n   - '));
  process.exit(1);
})();
