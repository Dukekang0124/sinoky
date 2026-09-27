#!/usr/bin/env node
/* Sinoky 发版版本号同步（**版本无关，可复用**）。
   背景：版本号散在 6 处，漏一处就会「网页领先 / APK 落后」或「更新弹窗拉到旧包」。
   六处 = WEB 3 处（version.json 顶层 / index.html APP_VERSION / sw.js CACHE）
        + APK 3 处（version.json 的 apk 段 / apk.url 直链 / download.html 两处兜底直链）。

   apk 段特别说明：
     - versionCode = MA*10000 + MI*100 + PA（0.28.0 → 2800）
     - md5 / size **故意清空**（md5:"" size:0），由 CI（apk.yml）出包后回写真实值。
       本地若留着上一版的 md5/size，万一走了应急直连部署就会把**错误的校验值**推上线，
       客户端校验必然失败 ⇒ 用户点更新装不上。

   用法：
     node _internal/bump_version.cjs 0.28.0                       # 只同步版本号，note 不变
     node _internal/bump_version.cjs 0.28.0 _internal/notes/v0.28.0.json
        （notes 文件形如 {"note":"中文说明","noteEn":"英文说明"}；noteEn 会插到数组最前）

   退出码：0 全部命中；非 0 = 某处没找到（说明文件结构变了，别硬发版）。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NEW = process.argv[2];
const NOTE_FILE = process.argv[3] || '';

if(!NEW || !/^\d+\.\d+\.\d+$/.test(NEW)){
  console.error('用法: node _internal/bump_version.cjs <x.y.z> [noteFile]');
  process.exit(2);
}

const vjPath = path.join(ROOT, 'version.json');
const vj = JSON.parse(fs.readFileSync(vjPath, 'utf8'));
const OLD = vj.version;
if(OLD === NEW){ console.error('版本号已经是 ' + NEW + '，无需同步'); process.exit(2); }

const [MA, MI, PA] = NEW.split('.').map(Number);
const code = MA*10000 + MI*100 + PA;

const results = [];
function step(name, ok, detail){
  results.push({ name, ok:!!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  → ' + detail : ''));
}

/* ---- 1/N. version.json（结构化：字段多、note 超长，用 JSON 读写最稳） ---- */
const today = new Date(Date.now() + 8*3600e3).toISOString().slice(0,10);   /* 以 UTC+8 记日期 */
vj.version = NEW;
vj.updated = today;
if(NOTE_FILE){
  const nf = path.join(ROOT, NOTE_FILE);
  const n = JSON.parse(fs.readFileSync(nf, 'utf8'));
  vj.note = n.note;
  /* noteEn 是**倒序历史**（最新在最前），不是只留当前版本 —— 别整数组替换。 */
  vj.noteEn = [n.noteEn].concat(Array.isArray(vj.noteEn) ? vj.noteEn : []);
}
vj.apk = vj.apk || {};
const oldApkMd5 = vj.apk.md5, oldApkSize = vj.apk.size;
vj.apk.versionCode = code;
vj.apk.version = NEW;
vj.apk.url = 'https://sinoky.pages.dev/apk/Sinoky-v' + NEW + '-release.apk';
vj.apk.md5 = '';     /* CI 回写真实值 */
vj.apk.size = 0;     /* CI 回写真实值 */
fs.writeFileSync(vjPath, JSON.stringify(vj, null, 2) + '\n', 'utf8');
step('version.json · 顶层 version', true, OLD + ' → ' + NEW);
step('version.json · apk.versionCode', true, code);
step('version.json · apk.url', true, vj.apk.url.split('/').pop());
step('version.json · apk.md5/size 已清空待 CI 回写', true,
     '旧值 md5=' + (String(oldApkMd5).slice(0,8) || '(空)') + ' size=' + oldApkSize + ' → "" / 0');
if(NOTE_FILE) step('version.json · note / noteEn[0] 已更新', true, 'noteEn 共 ' + vj.noteEn.length + ' 条');

/* ---- 2/N. index.html APP_VERSION ---- */
const ixPath = path.join(ROOT, 'index.html');
let ix = fs.readFileSync(ixPath, 'utf8');
const ixRe = /var APP_VERSION = '[^']+';/;
if(ixRe.test(ix)){
  ix = ix.replace(ixRe, "var APP_VERSION = '" + NEW + "';");
  fs.writeFileSync(ixPath, ix, 'utf8');
  step('index.html · APP_VERSION', true, NEW);
} else {
  step('index.html · APP_VERSION', false, '未找到 var APP_VERSION = ...');
}

/* ---- 3/N. sw.js CACHE ---- */
const swPath = path.join(ROOT, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const swRe = /var CACHE = 'sinoky-v[^']+';/;
if(swRe.test(sw)){
  sw = sw.replace(swRe, "var CACHE = 'sinoky-v" + NEW + "';");
  fs.writeFileSync(swPath, sw, 'utf8');
  step('sw.js · CACHE', true, 'sinoky-v' + NEW);
} else {
  step('sw.js · CACHE', false, '未找到 var CACHE = ...');
}

/* ---- 4/N. download.html 兜底直链（两处，历史上漏过 → 用正则全覆盖） ---- */
const dlPath = path.join(ROOT, 'download.html');
let dl = fs.readFileSync(dlPath, 'utf8');
const dlRe = /Sinoky-v\d+\.\d+\.\d+-release\.apk/g;
const hits = (dl.match(dlRe) || []);
if(hits.length){
  dl = dl.replace(dlRe, 'Sinoky-v' + NEW + '-release.apk');
  fs.writeFileSync(dlPath, dl, 'utf8');
  step('download.html · 兜底直链 ×' + hits.length, true, hits.join(' , ') + ' → v' + NEW);
} else {
  step('download.html · 兜底直链', false, '未找到 Sinoky-vX.Y.Z-release.apk');
}

/* ---- 终局断言 ---- */
const bad = results.filter(function(r){ return !r.ok; });
console.log('──────────────────────────────────────────────');
if(bad.length){
  console.log('❌ 版本号同步有 ' + bad.length + ' 处失败 — **不要发版**，先核对文件结构');
  process.exit(1);
}
console.log('✅ 六处版本号已全部同步到 ' + NEW + '（apk.versionCode=' + code + '）');
console.log('   ⚠️ 提交信息里请写明版本号；tag 请用 v' + NEW);
