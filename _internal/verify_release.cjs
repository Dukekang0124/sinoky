/* 发版不变量验证（版本无关，自动读本地 version.json）—— 只读，不写任何文件
 * 判据：线上 version.json / 线上首页 APP_VERSION / 线上 sw.js CACHE / origin/main 根 version.json / APK 实体 六方一致
 * 用法：NODE_OPTIONS="--use-system-ca" node _internal/verify_release.cjs
 * 可选环境变量：BASE 覆盖站点根（默认 https://sinoky.pages.dev）·
 *               REQ_TIMEOUT_MS 单个小请求超时（默认 20000）· APK_TIMEOUT_MS 下载**墙钟**上限（默认 300000，24MB 实测慢链路可达 ~270s）·
 *               BUDGET_MS 总预算（默认 420000）—— 到点**强制出结论**（部分断言 + 退出码 1）。⚠️ BUDGET_MS 必须 > APK_TIMEOUT_MS
 * 🔴 所有网络等待都有上界，超时一律计为**失败**：闸门挂死 ≠ 通过（曾实测无超时版挂死 12 分钟零输出）。
 * 输出约定：✅ 通过 / ❌ 失败 / ⏭ 未执行（前置失败导致同组后续断言没跑，**不能按全绿读**）。
 */
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');

const APP = path.join(__dirname, '..');
const LOCAL = JSON.parse(require('fs').readFileSync(path.join(APP, 'version.json'), 'utf8'));
const V = LOCAL.version;
const CODE = Number((LOCAL.apk || {}).versionCode || 0);
/* 🔴 双线版本（v0.28.1 起）：网页线可以**领先** APK 线（纯网页修正不发新 APK）。
   此时 apk 段仍指向上一个真实出包版本。凡「APK 相关」的断言都必须用 AV 而非 V，
   否则每发一次网页线就会集体报假失败（v0.23.3 同类坑的重演）。 */
const AV = String((LOCAL.apk || {}).version || V);
const SPLIT = AV !== V;
const BASE = process.env.BASE || 'https://sinoky.pages.dev';
console.log('网页版本 v' + V + (SPLIT ? '（网页线领先，APK 线仍为 v' + AV + '）' : '') +
            ' │ versionCode ' + CODE + ' │ 站点 ' + BASE + '\n');

/* 🔴 每个请求都必须带超时（2026-09-28 加）。
 * 根因实测：本脚本原先无超时，一次运行**挂死 12 分钟零输出**（对比 `verify_www_vs_live.cjs`
 *   的 req() 有 25s 超时）。**闸门挂死 = 不产出结论**，而人工看着像「还在跑」，
 *   很容易被当作「没问题」放过 —— 与「wrangler deploy 报 success 后不退出」是同一类陷阱。
 *   判据：任何网络等待都要有上界，超时必须是**失败**而不是「继续等」。 */
const REQ_TIMEOUT = Number(process.env.REQ_TIMEOUT_MS || 20000);

function get(u, opts) {
  return new Promise((res, rej) => {
    const r0 = https.get(u, Object.assign({ headers: { 'User-Agent': 'node', 'Cache-Control': 'no-cache' } }, opts || {}), r => {
      let d = ''; r.setEncoding('utf8');
      r.on('data', c => d += c);
      r.on('end', () => res({ s: r.statusCode, b: d, h: r.headers }));
    }).on('error', rej);
    r0.setTimeout(REQ_TIMEOUT, () => r0.destroy(new Error('timeout ' + REQ_TIMEOUT + 'ms: ' + u)));
  });
}
function head(u) {
  return new Promise((res, rej) => {
    const req = https.request(u, { method: 'HEAD', headers: { 'User-Agent': 'node' } }, r =>
      res({ s: r.statusCode, len: r.headers['content-length'], type: r.headers['content-type'] }));
    req.on('error', rej); req.end();
    req.setTimeout(REQ_TIMEOUT, () => req.destroy(new Error('timeout ' + REQ_TIMEOUT + 'ms: ' + u)));
  });
}

const R = [];
function ok(name, pass, detail) { R.push({ name, pass, detail }); }
/* 🔴 「未执行」必须与「通过」区分开（2026-09-28 加）。
 * 根因：断言按组写在 try/catch 里，前置一失败，同组后续断言**根本没跑**，
 *   而原先的计数会从 18 掉到 14 —— 读起来像「只差一项」，实则漏掉的往往是**最关键的那一项**
 *   （实测：`spawnSync cmd.exe EBUSY` 让 ④ 抛异常，连带 ④d「线上 apk 段 == origin/main apk 段」
 *   这条唯一的「线上与仓库耦合」断言一起消失，而报告只显示 ④ 失败）。
 * ⇒ 同组后续断言一律显式登记为 skip（不计通过、且在汇总里单列）。 */
function skip(name, reason) { R.push({ name, pass: false, skip: true, detail: reason }); }
/* 「不适用」与「未执行」必须再分开一层（2026-09-28）：
 * skip = 因**前置失败**而没跑（伴随 ❌，必须让人看见）；na = 该断言在本环境/本协议下**本就不成立**
 *   （例如 CF 对 HEAD 不返回 Content-Length ⇒ ⑤c 永远不会执行），且已有等价断言覆盖（⑤f）。
 * 为什么非要分：一个长期恒定的「未执行」会把人训练成**忽略这个告警** —— 那样真出现「关键断言没跑」时也没人看。
 * ⚠️ 用 na 的门槛：必须 (a) 是协议/环境固有的，不是这次运气不好；(b) 有等价断言覆盖同语义。 */
function na(name, reason) { R.push({ name, pass: false, skip: true, na: true, detail: reason }); }
function syncSleep(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {} }

/* 🔴 总预算看门狗（2026-09-28 加）：**闸门永远必须产出结论**。
 * 为什么单靠「每个请求加超时」不够：本脚本仍然实测挂死过两次（一次 12m31s、一次 10m21s）
 *   —— 卡点不在单个请求，而在「某个 `await` 之后再没有下文」（例如子进程的孙进程持有管道、
 *   `execFileSync` 的 timeout 只杀直接子进程等），逐个请求设超时覆盖不到。
 * 判据：**任何会「什么都不输出就停住」的东西，都必须有总预算** —— 到点就打出已收集到的断言并退 1。
 * 这样「挂死」这个失败模式被彻底消除：要么出结论，要么出「部分结论 + 明确说明」。 */
function dump(code) {
  clearTimeout(WATCHDOG);
  const pass = R.filter(x => x.pass).length;
  const naList = R.filter(x => x.na);
  const skips = R.filter(x => x.skip && !x.na);
  const fails = R.filter(x => !x.pass && !x.skip);
  R.forEach(x => console.log((x.na ? '◦ ' : x.skip ? '⏭ ' : x.pass ? '✅' : '❌') + ' ' + x.name + (x.pass ? '' : '  → ' + x.detail)));
  console.log('\n== ' + pass + '/' + R.length + ' 通过'
    + (skips.length ? ' · ' + skips.length + ' 未执行' : '')
    + (naList.length ? ' · ' + naList.length + ' 不适用' : '') + ' ==');
  if (naList.length) console.log('   ◦ 不适用（协议/环境固有，已有等价断言覆盖，不影响结论）：'
    + naList.map(x => x.name).join(' · '));
  if (skips.length) console.log('   ⚠️ 下列断言**未执行**（≠ 通过）：每一条都伴随一个已失败的前置，故不影响退出码，\n      但**不能按「全绿」读**——尤其 ④d 那种关键不变量没跑时，等于这项根本没验：\n      ' + skips.map(x => '      · ' + x.name + '（' + x.detail + '）').join('\n'));
  /* 退出码只看 ❌：skip 必然伴随一个已失败的兄弟断言（skip 的成因就是同组前置失败，
     或该断言所需数据本身来自一条失败断言）⇒ 把 skip 计入退出码只会重复惩罚，不会漏判。 */
  process.exit(fails.length === 0 ? code : 1);
}
const BUDGET_MS = Number(process.env.BUDGET_MS || 420000);
const WATCHDOG = setTimeout(() => {
  console.log('\n⏰ 总预算 ' + Math.round(BUDGET_MS / 1000) + 's 用尽 ⇒ 强制出结论（下列为已收集到的断言）');
  skip('（后续断言未执行）', '未执行：总预算耗尽，脚本在某一步之后没有下文 —— 这本身就是缺陷，请定位卡点');
  dump(1);
}, BUDGET_MS);

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
    ok('①e apk.url 指向 ' + AV + (SPLIT ? '（APK 线版本）' : ''), String(a.url || '').includes('Sinoky-v' + AV), 'url=' + a.url);
  } catch (e) {
    ok('① 线上 version.json 可读', false, String(e.message));
    ['①b 线上 apk.versionCode', '①c 线上 apk.md5 非空', '①d 线上 apk.size > 0', '①e apk.url 指向 ' + AV]
      .forEach((n) => skip(n, '未执行：① 前置失败'));
  }

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
  /* 🔴 走 execFileSync（直接 exec git）而不是 execSync（经 cmd.exe / /bin/sh）。
   * 实测（2026-09-28）：本机 `execSync` 抛 `spawnSync C:\windows\system32\cmd.exe EBUSY`，
   *   而且**重试 4 次仍失败** ⇒ 不是抖动，是本环境对「spawn cmd.exe」这条路径的限制
   *   （同一条 `git show origin/main:version.json` 在交互式 shell 里完全正常）。
   *   直连可执行文件不经过 shell，顺带还避免了 shell 引号/转义这一整类坑。
   * 🔴 再加一层：**某些运行环境连 `execFileSync('git')` 也 EBUSY**（实测过）。
   *   此时回退到 GitHub API 读同一个 `main` 分支的 `version.json` —— 不需要 fork 子进程，
   *   而且**天然不会读到陈旧 ref**（本地 `origin/main` 可能落后，API 永远是最新的）。
   *   ⇒ 这条回退不是「降级将就」：对本检查而言 API 反而是更强的判据。
   *   （仓库可匿名读 API —— 本脚本 ⑥ 早已依赖这一点。） */
  const REMOTE_VERSION_API = 'https://api.github.com/repos/Dukekang0124/sinoky/contents/version.json?ref=main';
  async function readRemoteVersion() {
    const spawnErr = [];
    try {
      for (let i = 0; i < 4; i++) {
        try {
          const raw = execFileSync('git', ['show', 'origin/main:version.json'], { cwd: __dirname + '/..', encoding: 'utf8', timeout: 30000 });
          return { raw, src: 'git origin/main' };
        } catch (e) {
          spawnErr.push(String(e.message).split('\n')[0]);
          if (!/EBUSY|EPERM|EAGAIN|ENOENT/i.test(String(e.message)) || i === 3) throw e;
          syncSleep(400 * (i + 1));
        }
      }
    } catch (e) { /* 落到 API 回退 */ }
    const r = await get(REMOTE_VERSION_API);
    if (r.s !== 200) throw new Error('git 不可用（' + spawnErr[0] + '）且 GitHub API HTTP ' + r.s);
    const j = JSON.parse(r.b);
    return { raw: Buffer.from(String(j.content || ''), 'base64').toString('utf8'), src: 'GitHub API ?ref=main（本环境不能 fork git）' };
  }

  try {
    execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: __dirname + '/..', stdio: 'ignore', timeout: 60000 });
  } catch (e) { /* 离线时忽略，下面的读法会用本地已有 ref 或 API */ }
  try {
    const { raw, src } = await readRemoteVersion();
    const j = JSON.parse(raw);
    ok('④ origin/main version = ' + V + '（源：' + src + '）', j.version === V, 'got ' + j.version);
    const a = j.apk || {};
    ok('④b origin/main apk.md5 非空', !!a.md5 && a.md5.length === 32, 'md5=' + (a.md5 || '(empty)'));
    ok('④c origin/main apk.size > 0', Number(a.size) > 0, 'size=' + a.size);
    if (live && live.apk) {
      const same = JSON.stringify(live.apk) === JSON.stringify(j.apk);
      ok('④d 不变量：线上 apk 段 == origin/main apk 段', same,
        same ? '' : 'live=' + JSON.stringify(live.apk) + ' | main=' + JSON.stringify(j.apk));
    }
  } catch (e) {
    const msg = String(e.message);
    ok('④ origin/main version.json 可读', false, /EBUSY/i.test(msg)
      ? msg + '\n        ↳ 这是**运行环境限制**（该 sandbox 内 node 无法 fork 子进程），不是 git/token 问题：请在普通 shell（或 CI）重跑，否则 ④ 组等于没验。'
      : msg);
    ['④b origin/main apk.md5 非空', '④c origin/main apk.size > 0',
     '④d 不变量：线上 apk 段 == origin/main apk 段（**关键：本脚本唯一的「线上 == 仓库」耦合断言**）']
      .forEach((n) => skip(n, '未执行：④ 前置失败'));
  }

  // ④e 版本账内部一致性：package.json.version 必须 == 顶层 version
  // 🔴 2026-09-28 产品审计 P2-16 的护栏：它曾长期飘在版本账之外（package.json=0.3.59，
  //    其余五处=0.29.3，相差 28 个版本号）。因为**不影响构建产物**（build-web.mjs 与 gradle
  //    都不读它），所以一直没人发现，但任何读 package.json 取产品版本的人/工具都会拿到错值。
  //    本项是**纯本地文件比对、不依赖网络**，所以刻意放在 ④ 的 try/catch **之外** ——
  //    不能因为远程读不到就把本地一致性也一起 skip 掉（那正是「断言空转」）。
  try {
    const pkg = JSON.parse(require('fs').readFileSync(path.join(APP, 'package.json'), 'utf8'));
    ok('④e package.json.version = ' + V + '（版本账内部一致）', pkg.version === V,
      pkg.version === V ? '' : 'got ' + pkg.version + ' —— 应与 version.json 的 ' + V +
        ' 一致（由 _internal/bump_version.cjs 第 4/N 步同步）');
  } catch (e) {
    ok('④e package.json.version 可读', false, String(e.message));
  }

  // ⑤ APK 实体可下 + 字节与 md5 复算
  try {
    const url = (live && live.apk && live.apk.url) || (BASE + '/apk/Sinoky-v' + AV + '-release.apk');
    const h = await head(url + '?cb=' + cb);
    ok('⑤ APK HEAD 200', h.s === 200, 'status=' + h.s + ' len=' + h.len + ' type=' + h.type);
    ok('⑤b APK content-type 含 android/apk', /android|apk/i.test(String(h.type || '')), 'type=' + h.type);
    const declared = Number((live && live.apk && live.apk.size) || 0);
    if (h.len && declared) ok('⑤c APK 实际 Content-Length == 声明 size', Number(h.len) === declared,
      'real=' + h.len + ' declared=' + declared);
    else if (declared) na('⑤c APK 实际 Content-Length == 声明 size',
      'CF 对 HEAD /apk/*.apk 不返回 Content-Length（协议固有）⇒ 本项永不执行；同语义已由 ⑤f「实测 size == 声明 size」覆盖');
    else skip('⑤c APK 实际 Content-Length == 声明 size', '未执行：线上未声明 apk.size（① 已失败）');

    // 真实 GET 复算 md5（内存）。24MB 用**墙钟**判定超时（不用 socket 空闲超时）：
    // 连接若在「慢慢滴字节」就永远不空闲 ⇒ 空闲超时永不触发 ⇒ 表现为挂死（实测过）。
    const APK_BUDGET = Number(process.env.APK_TIMEOUT_MS || 300000);
    const apkT0 = Date.now();
    const buf = await new Promise((res, rej) => {
      let killed = false;
      const kill = (why) => { if (!killed) { killed = true; apkReq.destroy(new Error(why)); } };
      const apkReq = https.get(url + '?cb=' + cb, { headers: { 'User-Agent': 'node' } }, r => {
        const cs = []; let n = 0;
        r.on('data', c => {
          cs.push(c); n += c.length;
          const el = Date.now() - apkT0;
          if (el > APK_BUDGET) return kill('timeout(wall)：已用 ' + Math.round(el / 1000) + 's / ' + Math.round(n / 1048576) + 'MB，超过 ' + Math.round(APK_BUDGET / 1000) + 's');
        });
        r.on('end', () => res(Buffer.concat(cs)));
      }).on('error', rej);
      apkReq.setTimeout(APK_BUDGET, () => kill('timeout(idle)：' + Math.round(APK_BUDGET / 1000) + 's 无数据'));
    });
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const pk = buf.slice(0, 2).toString('latin1') === 'PK';
    ok('⑤d APK PK 魔数', pk, 'first2=' + JSON.stringify(buf.slice(0, 2).toString('latin1')));
    ok('⑤e APK 实测 md5 == 线上声明 md5', md5 === String((live.apk || {}).md5 || ''), 'real=' + md5 + ' declared=' + (live.apk || {}).md5);
    ok('⑤f APK 实测 size == 线上声明 size', buf.length === declared, 'real=' + buf.length + ' declared=' + declared);
  } catch (e) {
    ok('⑤ APK 实体可下', false, String(e.message));
    ['⑤b APK content-type 含 android/apk', '⑤d APK PK 魔数',
     '⑤e APK 实测 md5 == 线上声明 md5', '⑤f APK 实测 size == 线上声明 size']
      .forEach((n) => skip(n, '未执行：⑤ 前置失败'));
  }

  // ⑥ GitHub Release
  try {
    const r = await get('https://api.github.com/repos/Dukekang0124/sinoky/releases?per_page=3');
    if (r.s === 200) {
      const rel = JSON.parse(r.b).find(x => x.tag_name === 'v' + AV) || null;
      ok('⑥ GitHub Release v' + AV + (SPLIT ? '（APK 线版本）' : '') + ' 存在', !!rel, rel ? (rel.assets || []).map(a => a.name + ':' + a.size).join(',') : 'HTTP ' + r.s + ' (私有仓库需 token)');
    } else {
      ok('⑥ GitHub Release 可查', false, 'HTTP ' + r.s + ' —— 私有仓库未认证（非发版缺陷，需 token 复核）');
    }
  } catch (e) { ok('⑥ GitHub Release 可查', false, String(e.message)); }

  dump(0);
})();
