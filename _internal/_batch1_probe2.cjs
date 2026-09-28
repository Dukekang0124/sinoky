/* 第 1 批侦察 · 之二（修正版）—— VAPID 密钥配对判定 + 订阅规模
 *
 * 🔴 只输出布尔 / 计数，绝不打印密钥明文。
 *
 * ⚠️ 修正记录（v2）：上一版把「secret_text 类型导致 value 不可读」判成了「键不存在」，
 *    因此得出的「preview != production」是**假结论** —— 那是「不可见」不是「不同值」。
 *    本版把三态分开：missing（键不存在）/ secret（存在但不可读）/ readable（可读）。
 *
 * 要回答：
 *   Q5 硬编码 VAPID_PUBLIC 与哪把可读私钥配对？（决定「轮换」是否必须）
 *   Q6 PUSH KV 订阅规模（轮换代价）
 */
const fs = require('fs');
const path = require('path');

const ACC = 'd24caa86ff464fd98e1c95a11c814a61';
const SEC = 'C:/Users/Admin/.sinoky-secrets';
const PUSH_ID = '9a54616846814bd6be285971ae604b48';
const TOKEN = fs.readFileSync(path.join(SEC, 'CLOUDFLARE_API_TOKEN.txt'), 'utf8').trim();
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
const HARDCODED = 'BKTM58m1NKL_FfTpbkfUex6SPcIRkAcvn7Z9XFsRd8JnxIlurfO13155jctyA0J1j4YsRu7nDEhyTwJkmjA0-2k';

const b64u = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function pubFromJwk(jwk) {
  return b64u(Buffer.concat([Buffer.from([4]), b64d(jwk.x), b64d(jwk.y)]));
}
/* 三态判定：不允许把「未定义」与「不可读」混为一谈 */
function state(ev) {
  if (!ev) return { k: 'missing' };
  if (ev.value === null || ev.value === undefined) return { k: 'secret', type: ev.type };
  return { k: 'readable', type: ev.type, v: ev.value };
}
async function api(p) {
  const r = await fetch('https://api.cloudflare.com/client/v4' + p, { headers: H });
  let j = null; try { j = await r.json(); } catch (e) { j = { success: false }; }
  return { status: r.status, j };
}

(async () => {
  const dir = path.join(__dirname, '_audit_0928');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const out = []; const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };

  const { j } = await api('/accounts/' + ACC + '/pages/projects/sinoky');
  if (!j.success) { console.log('API 失败'); process.exit(1); }
  const DC = j.result.deployment_configs || {};
  const PS = state(((DC.preview || {}).env_vars || {}).VAPID_PRIVATE);
  const DS = state(((DC.production || {}).env_vars || {}).VAPID_PRIVATE);

  log('=== Q5 三态判定 ===');
  log('  硬编码 VAPID_PUBLIC 前 12: ' + HARDCODED.slice(0, 12) + '… (len ' + HARDCODED.length + ')');
  log('  preview   VAPID_PRIVATE : ' + PS.k + (PS.type ? ' (type=' + PS.type + ')' : ''));
  log('  production VAPID_PRIVATE: ' + DS.k + (DS.type ? ' (type=' + DS.type + ')' : ''));
  log('  ⇒ 两环境「值是否相同」: ' +
      (PS.k === 'readable' && DS.k === 'readable'
        ? String(PS.v === DS.v)
        : '⚠️ 无法判定 —— 至少一侧不可读（不可读 ≠ 不同值）'));

  function pair(label, st) {
    if (st.k !== 'readable') { log('  ' + label + ': 不可读（' + st.k + '）→ 无法用此法判定配对'); return null; }
    let jwk = null;
    try { jwk = JSON.parse(st.v); } catch (e) { log('  ' + label + ': 值非 JSON'); return null; }
    if (!(jwk.x && jwk.y && jwk.d)) { log('  ' + label + ': JWK 缺字段'); return null; }
    const m = pubFromJwk(jwk) === HARDCODED;
    log('  ' + label + ': 推导公钥 ' + pubFromJwk(jwk).slice(0, 12) + '…  配对=' + m);
    return m;
  }
  const pm = pair('preview  私钥', PS);
  const dm = pair('production 私钥', DS);

  log('');
  log('=== 推论（严格基于上表）===');
  if (pm === true && dm === null) {
    log('  preview 的**明文**私钥与硬编码公钥配对（公钥是全局唯一的、硬编码共用）');
    log('  ⇒ 生产用的私钥几乎必然与它同值（否则线上推送早就全 401/403）');
    log('  ⇒ 判断：**preview 的明文 = 生产私钥的明文** ⇒ 按安全惯例应视为已泄露 ⇒ 必须轮换');
    log('  ⇒ 但 production 是 secret_text，值读不到，无法 100% 确证 ⇒ 轮换前先做一次「显式配对自测」');
  } else if (pm === true && dm === true) {
    log('  两环境都与硬编码公钥配对 ⇒ 私钥必然同值 ⇒ 明文泄露 = 生产私钥泄露 ⇒ 必须轮换');
  } else {
    log('  配对情况不完整，需人工复核');
  }

  /* Q6 订阅规模 */
  log('');
  log('=== Q6 PUSH KV 订阅规模（轮换代价）===');
  let total = 0, cursor = '';
  for (let i = 0; i < 30; i++) {
    const r = await api('/accounts/' + ACC + '/storage/kv/namespaces/' + PUSH_ID + '/keys?limit=1000'
      + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (!r.j.success) { log('  查询失败 ' + JSON.stringify(r.j.errors)); break; }
    const arr = r.j.result || [];
    total += arr.length;
    cursor = (r.j.result_info && r.j.result_info.cursor) || '';
    if (!cursor || arr.length < 1000) break;
  }
  log('  PUSH KV 键数（订阅记录数）: ' + total);
  log('  ⇒ ' + (total <= 5 ? '订阅极少，轮换 VAPID 的实际代价 ≈ 0（这 ' + total + ' 条失效后用户重订即可）'
                          : '轮换会让这 ' + total + ' 条订阅失效，需权衡'));

  fs.writeFileSync(path.join(dir, 'batch1_probe2.txt'), out.join('\n'), 'utf8');
  console.log('\n(产物已写入 _internal/_audit_0928/batch1_probe2.txt)');
})().catch((e) => { console.error('异常：' + (e && e.stack || e)); process.exit(1); });
