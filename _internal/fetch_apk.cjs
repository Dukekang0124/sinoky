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

(async () => {
  if (fs.existsSync(dest)) {
    const b = fs.readFileSync(dest);
    const ok = b.length === apk.size && crypto.createHash('md5').update(b).digest('hex') === apk.md5;
    if (ok) { console.log('✅ www/apk/' + name + ' 已存在且校验通过（' + b.length + ' bytes）'); return; }
    console.log('⚠️ www/apk/' + name + ' 存在但校验不过，重新下载');
  }
  console.log('下载 ' + apk.url + ' …');
  const buf = await get(apk.url);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;   // PK
  console.log('   size ' + buf.length + ' / 期望 ' + apk.size);
  console.log('   md5  ' + md5 + ' / 期望 ' + apk.md5);
  console.log('   PK 魔数 ' + (isZip ? '✅' : '❌'));
  if (buf.length !== apk.size || md5 !== apk.md5 || !isZip) {
    console.error('✗ 校验失败，不落盘（避免写入坏文件）');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log('✅ 已写入 www/apk/' + name + '（校验通过）');
})();
