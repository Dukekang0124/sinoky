#!/usr/bin/env node
/* Sinoky 发版版本号同步（**版本无关，可复用**）。
   背景：版本号散在 6 处，漏一处就会「网页领先 / APK 落后」或「更新弹窗拉到旧包」。
   六处 = WEB 3 处（version.json 顶层 / index.html APP_VERSION / sw.js CACHE）
        + APK 3 处（version.json 的 apk 段 / apk.url 直链 / download.html 两处兜底直链）。

   ★ v0.29.3 起：download.html 从「真下载页」退休为**零版本跳转壳**（真实下载页 = /landing/download.html，
   运行时读 version.json ⇒ 永久不用手改版本号）⇒ **六处降为五处**：
   WEB 3（顶层 version / APP_VERSION / sw CACHE）+ APK 2（apk 段的 versionCode/version/url；md5/size 由 CI 回写）。
   第 5/N 步因此**预期 0 命中且判绿**（见该步注释）。

   ★ v0.29.4 起：**再补一处 package.json.version**（见第 4/N 步）。它此前长期飘在版本账之外：
   写 0.3.59，而其余五处都是 0.29.3 —— 不影响构建产物，但**读产品版本的人会读到错的值**，
   2026-09-28 的产品审计就因此误判过一次（报告 P2-16）。纳入同步后永远等于顶层 version。

   apk 段特别说明：
     - versionCode = MA*10000 + MI*100 + PA（0.28.0 → 2800）
     - md5 / size **故意清空**（md5:"" size:0），由 CI（apk.yml）出包后回写真实值。
       本地若留着上一版的 md5/size，万一走了应急直连部署就会把**错误的校验值**推上线，
       客户端校验必然失败 ⇒ 用户点更新装不上。

   用法：
     node _internal/bump_version.cjs 0.28.0                       # 只同步版本号，note 不变
     node _internal/bump_version.cjs 0.28.0 _internal/notes/v0.28.0.json
        （notes 文件形如 {"note":"中文说明","noteEn":"英文说明"}；noteEn 会插到数组最前）
     node _internal/bump_version.cjs 0.28.1 _internal/notes/v0.28.1.json --web-only
        （**只发网页线**：apk 段与 download.html **一律不动**，只改 WEB 三处 ——
          纯网页/CSS/文案修复的既有权衡，见 skill `sinoky-release-sop` §1.1。
          ⚠️ 此时 apk.version 会比顶层 version 旧一档，这是**预期落差不是缺陷**，交付文档必须写明。）
     node _internal/bump_version.cjs 0.28.1 _internal/notes/v0.29.1.json --apk-only
        （**补出 APK（网页线转正式发版）**：顶层 version 已由 --web-only 就位，本模式**只改 APK 线**
          —— version.json 的 apk 段 4 字段（versionCode / version / url / md5+size 清空待 CI 回写）
             + download.html 的无硬编码校验；WEB 三处与顶层 version 保持不变。
          用途：某版先按「只发网页线」发了（APK 段故意落后一档），之后决定**正式发版**让 App 用户
          也拿到 —— 直接打 tag 会因 apk 段指向旧版本而语义错乱，本模式把六处补齐后 tag 才干净。
          note 走**替换**而非插入（同一次发版的 note 已在 --web-only 时写过，插入会重复）。
          顺序：`--web-only` 先发网页线 → （可延迟）→ `--apk-only` 补齐 → `git tag vX.Y.Z` 正式发版。）

   退出码：0 全部命中；非 0 = 某处没找到（说明文件结构变了，别硬发版）。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2).filter(function(a){ return a.indexOf('--') !== 0; });
const WEB_ONLY = process.argv.indexOf('--web-only') > -1;
const APK_ONLY = process.argv.indexOf('--apk-only') > -1;
const NEW = ARGS[0];
const NOTE_FILE = ARGS[1] || '';

if(!NEW || !/^\d+\.\d+\.\d+$/.test(NEW)){
  console.error('用法: node _internal/bump_version.cjs <x.y.z> [noteFile] [--web-only|--apk-only]');
  process.exit(2);
}
if(WEB_ONLY && APK_ONLY){
  console.error('🔴 --web-only 与 --apk-only 互斥：一个只改网页三处、一个只改 APK 三处，不能同时用');
  process.exit(2);
}

const vjPath = path.join(ROOT, 'version.json');
const vj = JSON.parse(fs.readFileSync(vjPath, 'utf8'));
const OLD = vj.version;
/* --apk-only 的前提正是「顶层 version 已就位」，所以这个模式下 OLD === NEW 是**正常且必需**的。 */
if(OLD === NEW && !APK_ONLY){
  console.error('版本号已经是 ' + NEW + '，无需同步（若是要把先发的网页线补出 APK，加 --apk-only）');
  process.exit(2);
}

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
  /* noteEn 是**倒序历史**（最新在最前），不是只留当前版本 —— 别整数组替换。
     --apk-only 例外：同一次发版的 note 已在 --web-only 时写过 ⇒ **替换** noteEn[0]，
     否则会把同一条英文说明插两遍（历史里出现重复条目）。 */
  if(APK_ONLY && Array.isArray(vj.noteEn) && vj.noteEn.length){
    vj.noteEn[0] = n.noteEn;
  } else {
    vj.noteEn = [n.noteEn].concat(Array.isArray(vj.noteEn) ? vj.noteEn : []);
  }
}
vj.apk = vj.apk || {};

/* 🔴 --web-only 前置闸门（v0.28.1 实测踩到，代价是「全量 App 用户收不到更新」）
   根因链：完整发版时脚本把 apk.md5/size **清空**待 CI 回写 → CI 把真值**只推到 main**、
   不会改你的工作区 → 你的本地 version.json 一直是空的 → 此时若走 --web-only 的
   「apk 段保持不变」，保持的就是**空值**，部署直接把线上正确的 md5/size 抹掉。
   ⇒ 凡是「本地 apk 段 == origin/main」这个前提不成立，就必须拒绝发网页线（并且要在写盘之前拒）。 */
if(WEB_ONLY){
  let remoteApk = null;
  try{
    require('child_process').execSync('git fetch origin main', { stdio:'ignore' });
    remoteApk = JSON.parse(require('child_process').execSync('git show origin/main:version.json', { stdio:['ignore','pipe','ignore'] }).toString()).apk;
  }catch(e){ remoteApk = null; }
  const localMd5 = String(vj.apk.md5 || ''), localSize = Number(vj.apk.size || 0);
  const rMd5 = remoteApk ? String(remoteApk.md5 || '') : null;
  const rSize = remoteApk ? Number(remoteApk.size || 0) : null;
  if(!remoteApk || !rMd5 || rMd5 !== localMd5 || rSize !== localSize){
    console.error('🔴 --web-only 前置闸门失败：本地 apk 段与 origin/main 不一致（或读不到远程）');
    console.error('   本地 md5/size = ' + (localMd5 || '(空)') + ' / ' + localSize);
    console.error('   远程 md5/size = ' + (rMd5 || '(空)') + ' / ' + rSize);
    console.error('   若不修就部署 ⇒ 把空/过期的 md5 与 size 推上线 ⇒ **全量 App 用户从此收不到更新**（表面无异常）。');
    console.error('   修法：git fetch origin main，再把 origin/main:version.json 的 apk 段覆盖到本地 version.json（保留顶层 version/note），重跑。');
    process.exit(1);
  }
  step('--web-only 前置 · 本地 apk 段 == origin/main', true, 'md5=' + rMd5.slice(0,8) + ' size=' + rSize);
}

const oldApkMd5 = vj.apk.md5, oldApkSize = vj.apk.size;
if(WEB_ONLY){
  /* 只发网页线：apk 段描述的是**仍在线的那个旧 APK**，动它会让「网页版 vs APK 落差巡检」失真。 */
  step('version.json · apk 段保持不变（--web-only）', true,
       'apk.version=' + vj.apk.version + ' code=' + vj.apk.versionCode + '（预期落差，非缺陷）');
} else {
  vj.apk.versionCode = code;
  vj.apk.version = NEW;
  vj.apk.url = 'https://sinoky.pages.dev/apk/Sinoky-v' + NEW + '-release.apk';
  vj.apk.md5 = '';     /* CI 回写真实值 */
  vj.apk.size = 0;     /* CI 回写真实值 */
  step('version.json · apk.versionCode', true, code);
  step('version.json · apk.url', true, vj.apk.url.split('/').pop());
  step('version.json · apk.md5/size 已清空待 CI 回写', true,
       '旧值 md5=' + (String(oldApkMd5).slice(0,8) || '(空)') + ' size=' + oldApkSize + ' → "" / 0');
}
fs.writeFileSync(vjPath, JSON.stringify(vj, null, 2) + '\n', 'utf8');
step('version.json · 顶层 version', true, (OLD === NEW ? OLD + '（--apk-only，已就位）' : OLD + ' → ' + NEW));
if(NOTE_FILE) step('version.json · note / noteEn[0] 已更新', true, 'noteEn 共 ' + vj.noteEn.length + ' 条');

/* ---- 2/N. index.html APP_VERSION ---- */
const ixPath = path.join(ROOT, 'index.html');
let ix = fs.readFileSync(ixPath, 'utf8');
const ixRe = /var APP_VERSION = '[^']+';/;
if(APK_ONLY){
  /* 顶层已就位 ⇒ WEB 三处必然已是 NEW，本模式下只做**校验**，不重写（避免无意义 diff）。 */
  step('index.html · APP_VERSION 保持不变（--apk-only）', ixRe.test(ix) && ix.indexOf("var APP_VERSION = '" + NEW + "';") > -1,
       ixRe.test(ix) ? ix.match(ixRe)[0] : '未找到');
} else if(ixRe.test(ix)){
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
if(APK_ONLY){
  step('sw.js · CACHE 保持不变（--apk-only）', swRe.test(sw) && sw.indexOf("var CACHE = 'sinoky-v" + NEW + "';") > -1,
       swRe.test(sw) ? sw.match(swRe)[0] : '未找到');
} else if(swRe.test(sw)){
  sw = sw.replace(swRe, "var CACHE = 'sinoky-v" + NEW + "';");
  fs.writeFileSync(swPath, sw, 'utf8');
  step('sw.js · CACHE', true, 'sinoky-v' + NEW);
} else {
  step('sw.js · CACHE', false, '未找到 var CACHE = ...');
}

/* ---- 4/N. package.json version ----
   🔴 为什么补这一步（2026-09-28 产品审计 P2-16）：
   它一直写在版本账的"五处"之外 —— package.json 是 0.3.59，而 version.json / index APP_VERSION /
   sw CACHE / apk.version 全是 0.29.3，相差 28 个版本号。它**不影响构建产物**（build-web.mjs 与
   gradle 都不读它），所以没人发现；但任何「读 package.json 取产品版本」的人/工具都会拿到错值。
   用正则做**行内替换**（而不是 JSON.parse→stringify 整文件重写），保证 diff 只有一行。 */
const pkgPath = path.join(ROOT, 'package.json');
try {
  const pkgTxt = fs.readFileSync(pkgPath, 'utf8');
  const pkgRe = /"version":\s*"[^"]*"/;
  if (!pkgRe.test(pkgTxt)) {
    step('package.json · version', false, '未找到 "version": "..." 字段');
  } else {
    const oldPkg = (pkgTxt.match(pkgRe) || [''])[0];
    fs.writeFileSync(pkgPath, pkgTxt.replace(pkgRe, '"version": "' + NEW + '"'), 'utf8');
    step('package.json · version', true, oldPkg + ' → "version": "' + NEW + '"');
  }
} catch (e) {
  step('package.json · version', false, '读写失败：' + e.message);
}

/* ---- 5/N. download.html 硬编码直链 ----
   ★ v0.29.3 起：本步**预期 0 命中，且 0 命中判绿**。
   download.html 已从「真下载页」退休为**零版本跳转壳**；真实下载页 = /landing/download.html，
   改为运行时读 version.json ⇒ 永久不再需要手改版本号。版本号因此从六处降为五处。
   保留本步**唯一目的是防回归**：万一有人把 `Sinoky-vX.Y.Z-release.apk` 又写回 download.html，
   这里会命中并照改（不让它把发版卡死），同时打印 ⚠️ 提醒把那行删掉。
   注意：兜底直链指向的是 **APK**，所以 --web-only 时无需处理。 */
if(WEB_ONLY){
  step('download.html · 零硬编码版本（--web-only 无需处理）', true, '已退休为跳转壳');
} else {
  const dlPath = path.join(ROOT, 'download.html');
  let dl = fs.readFileSync(dlPath, 'utf8');
  const dlRe = /Sinoky-v\d+\.\d+\.\d+-release\.apk/g;
  const hits = (dl.match(dlRe) || []);
  if(hits.length){
    dl = dl.replace(dlRe, 'Sinoky-v' + NEW + '-release.apk');
    fs.writeFileSync(dlPath, dl, 'utf8');
    step('download.html · 命中 ×' + hits.length + '（⚠️ 该页本应零硬编码，请删掉这些行）', true, hits.join(' , ') + ' → v' + NEW);
  } else {
    step('download.html · 零硬编码版本（预期：已退休为跳转壳）', true, '0 命中 = 正确');
  }
}

/* ---- 终局断言 ---- */
const bad = results.filter(function(r){ return !r.ok; });
console.log('──────────────────────────────────────────────');
if(bad.length){
  console.log('❌ 版本号同步有 ' + bad.length + ' 处失败 — **不要发版**，先核对文件结构');
  process.exit(1);
}
if(WEB_ONLY){
  console.log('✅ 网页线三处版本号已同步到 ' + NEW + '（apk 段保持 ' + vj.apk.version + ' —— 预期落差）');
  console.log('   ⚠️ **只发网页线：不要打 tag**。部署必须走应急三必须：');
  console.log('      build-web.mjs → fetch_apk.cjs → verify_www_vs_live.cjs 全绿 → 才 pages deploy');
  console.log('   交付文档要显式写「本版只发网页线」+ 理由（见 skill sinoky-release-sop §1.1）');
} else if(APK_ONLY){
  console.log('✅ APK 线已补齐到 ' + NEW + '（apk.versionCode=' + code + '；顶层 version / WEB 三处保持不变）');
  console.log('   六处现已一致 → 可以正式发版：');
  console.log('     git tag v' + NEW + ' && git push origin v' + NEW + '   （CI apk.yml 出包 + 挂 Release + 回写 apk.md5/size）');
  console.log('   ⚠️ apk.md5/size 已清空待 CI 回写；tag 前请确认本轮 WEB 变更已在 main 上。');
} else {
  console.log('✅ 六处版本号已全部同步到 ' + NEW + '（apk.versionCode=' + code + '）');
  console.log('   ⚠️ 提交信息里请写明版本号；tag 请用 v' + NEW);
}
