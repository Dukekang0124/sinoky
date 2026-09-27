/* 发版不变量验证 v0.27.0 —— 只读，不写任何文件
 * 判据：线上 version.json / 线上 index.html / 线上 sw.js / origin/main 根 version.json / APK 实体 五方一致
 * 用法：NODE_TLS_REJECT_UNAUTHORIZED=0 node _internal/verify_release_027.cjs
 */
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');

const V = '0.27.0';
const CODE = 2700;
const BASE = 'https://sinoky.pages.dev';

function get(u, opts) {
  return new Promise((res, rej) => {
    https.get(u, Object.assign({ headers: { 'User-Agent': 'node', 'Cache-Control': 'no-cache' } }, opts || {}), r => {
      let d = ''; r.setEncoding('utf8');
      r.on('data', c => d += c);
      r.on('end', () => res({ s: r.statusCode, b: d, h: r.headers }));
    }).on('error', rej);
  });
}
function head(u) {
  return new Promise((res, rej) => {
    const req = https.request(u, { method: 'HEAD', headers: { 'User-Agent': 'node' } }, r =>
      res({ s: r.statusCode, len: r.headers['content-length'], type: r.headers['content-type'] }));
    req.on('error', rej); req.end();
  });
}

const R = [];
function ok(name, pass, detail) { R.push({ name, pass, detail }); }

(async () => {
  const cb = Date.now();

  // ① 线上 version.json
  let live = null;
  try {
    const r = await get(BASE + '/version.json?cb=' + cb);
    live = JSON.parse(r.b);
    ok('① 线上 version.json 版本号 = ' + V, live.version === V, 'got ' + live.version);
    const a = live.apk || {};
    ok('①b 线上 apk.versionCode = ' + CODE, Number(a.versionCode) === CODE, 'got ' + a.versionCode);
    ok('①c 线上 apk.md5 非空', !!a.md5 && a.md5.length === 32, 'md5=' + (a.md5 || '(empty)'));
    ok('①d 线上 apk.size > 0', Number(a.size) > 0, 'size=' + a.size);
    ok('①e apk.url 指向 ' + V, String(a.url || '').includes('Sinoky-v' + V), 'url=' + a.url);
  } catch (e) { ok('① 线上 version.json 可读', false, String(e.message)); }

  // ② 线上首页 APP_VERSION（注意：/index.html 会 308 重定向，必须走根路径，否则拿不到正文）
  try {
    const r = await get(BASE + '/?cb=' + cb);
    const m = r.b.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    ok('② 线上首页 APP_VERSION = ' + V, m && m[1] === V, 'got ' + (m ? m[1] : 'not found') + ' status=' + r.s);
  } catch (e) { ok('② 线上首页可读', false, String(e.message)); }

  // ③ 线上 sw.js CACHE
  try {
    const r = await get(BASE + '/sw.js?cb=' + cb);
    const m = r.b.match(/CACHE\s*=\s*['"]([^'"]+)['"]/);
    ok('③ 线上 sw.js CACHE 含 ' + V, m && m[1].includes(V), 'got ' + (m ? m[1] : 'not found'));
  } catch (e) { ok('③ 线上 sw.js 可读', false, String(e.message)); }

  // ④ origin/main 根 version.json
  // 🔴 必先 fetch：CI 的回写 commit 与本地首次 fetch 之间可能只差十几秒（v0.27.0 实测差 ~16s），
  // 读过期 ref 会把「已回写成功」误判成「CI 静默失败」。
  try {
    execSync('git fetch -q origin main', { cwd: __dirname + '/..', stdio: 'ignore' });
  } catch (e) { /* 离线时忽略，下面的 git show 会用本地已有 ref */ }
  try {
    const raw = execSync('git show origin/main:version.json', { cwd: __dirname + '/..', encoding: 'utf8' });
    const j = JSON.parse(raw);
    ok('④ origin/main version = ' + V, j.version === V, 'got ' + j.version);
    const a = j.apk || {};
    ok('④b origin/main apk.md5 非空', !!a.md5 && a.md5.length === 32, 'md5=' + (a.md5 || '(empty)'));
    ok('④c origin/main apk.size > 0', Number(a.size) > 0, 'size=' + a.size);
    if (live && live.apk) {
      const same = JSON.stringify(live.apk) === JSON.stringify(j.apk);
      ok('④d 不变量：线上 apk 段 == origin/main apk 段', same,
        same ? '' : 'live=' + JSON.stringify(live.apk) + ' | main=' + JSON.stringify(j.apk));
    }
  } catch (e) { ok('④ origin/main version.json 可读', false, String(e.message)); }

  // ⑤ APK 实体可下 + 字节与 md5 复算
  try {
    const url = (live && live.apk && live.apk.url) || (BASE + '/apk/Sinoky-v' + V + '-release.apk');
    const h = await head(url + '?cb=' + cb);
    ok('⑤ APK HEAD 200', h.s === 200, 'status=' + h.s + ' len=' + h.len + ' type=' + h.type);
    ok('⑤b APK content-type 含 android/apk', /android|apk/i.test(String(h.type || '')), 'type=' + h.type);
    const declared = Number((live && live.apk && live.apk.size) || 0);
    if (h.len && declared) ok('⑤c APK 实际 Content-Length == 声明 size', Number(h.len) === declared,
      'real=' + h.len + ' declared=' + declared);

    // 真实 GET 复算 md5（内存）
    const buf = await new Promise((res, rej) => {
      https.get(url + '?cb=' + cb, { headers: { 'User-Agent': 'node' } }, r => {
        const cs = []; r.on('data', c => cs.push(c)); r.on('end', () => res(Buffer.concat(cs)));
      }).on('error', rej);
    });
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const pk = buf.slice(0, 2).toString('latin1') === 'PK';
    ok('⑤d APK PK 魔数', pk, 'first2=' + JSON.stringify(buf.slice(0, 2).toString('latin1')));
    ok('⑤e APK 实测 md5 == 线上声明 md5', md5 === String((live.apk || {}).md5 || ''), 'real=' + md5 + ' declared=' + (live.apk || {}).md5);
    ok('⑤f APK 实测 size == 线上声明 size', buf.length === declared, 'real=' + buf.length + ' declared=' + declared);
  } catch (e) { ok('⑤ APK 实体可下', false, String(e.message)); }

  // ⑥ GitHub Release
  try {
    const r = await get('https://api.github.com/repos/Dukekang0124/sinoky/releases?per_page=3');
    if (r.s === 200) {
      const rel = JSON.parse(r.b).find(x => x.tag_name === 'v' + V) || null;
      ok('⑥ GitHub Release v' + V + ' 存在', !!rel, rel ? (rel.assets || []).map(a => a.name + ':' + a.size).join(',') : 'HTTP ' + r.s + ' (私有仓库需 token)');
    } else {
      ok('⑥ GitHub Release 可查', false, 'HTTP ' + r.s + ' —— 私有仓库未认证（非发版缺陷，需 token 复核）');
    }
  } catch (e) { ok('⑥ GitHub Release 可查', false, String(e.message)); }

  const pass = R.filter(x => x.pass).length;
  R.forEach(x => console.log((x.pass ? '✅' : '❌') + ' ' + x.name + (x.pass ? '' : '  → ' + x.detail)));
  console.log('\n== ' + pass + '/' + R.length + ' 通过 ==');
  process.exit(pass === R.length ? 0 : 1);
})();
