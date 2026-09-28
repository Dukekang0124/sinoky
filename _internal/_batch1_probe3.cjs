/* 第 1 批侦察 · 之三 —— VAPID 私钥值「结构」判定（一次性）
 *
 * 🔴 严格纪律：只输出长度 / 首字符类别 / 解析结果类型 / 字段名 / 配对布尔。
 *    **绝不打印值的任何片段**（除单字符的首字符，用于判断是 { 还是 " ）。
 *
 * 要回答：
 *   Q7 production 的 VAPID_PRIVATE 到底是什么形态？
 *      形态 A：JWK JSON 对象字符串  → 正常
 *      形态 B：被引号包裹的 JSON（双重编码） → JSON.parse 得到 string ⇒ jwk.x undefined ⇒ 签名抛错
 *      形态 C：其他（base64 / 私钥 hex 等） → 与代码不兼容
 *   Q8 在「正确的解析策略」下，production 私钥是否与硬编码公钥配对？
 */
const fs = require('fs');
const path = require('path');

const ACC = 'd24caa86ff464fd98e1c95a11c814a61';
const SEC = 'C:/Users/Admin/.sinoky-secrets';
const TOKEN = fs.readFileSync(path.join(SEC, 'CLOUDFLARE_API_TOKEN.txt'), 'utf8').trim();
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
const HARDCODED = 'BKTM58m1NKL_FfTpbkfUex6SPcIRkAcvn7Z9XFsRd8JnxIlurfO13155jctyA0J1j4YsRu7nDEhyTwJkmjA0-2k';

const b64u = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const pubFromJwk = (k) => b64u(Buffer.concat([Buffer.from([4]), b64d(k.x), b64d(k.y)]));

async function api(p) {
  const r = await fetch('https://api.cloudflare.com/client/v4' + p, { headers: H });
  let j = null; try { j = await r.json(); } catch (e) { j = { success: false }; }
  return { j };
}

/* 只描述结构，不泄露内容 */
function shape(v) {
  if (v === null || v === undefined) return { k: 'null-or-undefined' };
  const s = String(v);
  const o = { k: 'string', len: s.length, firstChar: JSON.stringify(s.slice(0, 1)) };
  let p1 = null, e1 = null;
  try { p1 = JSON.parse(s); } catch (e) { e1 = e.message; }
  o.parse1 = p1 === null ? 'null' : (Array.isArray(p1) ? 'array' : typeof p1);
  o.parse1Err = e1;
  if (typeof p1 === 'string') {
    o.note = '形态 B：值是被引号包裹的 JSON（双重编码）';
    try {
      const p2 = JSON.parse(p1);
      o.parse2 = Array.isArray(p2) ? 'array' : typeof p2;
      o.parse2Keys = p2 && typeof p2 === 'object' ? Object.keys(p2).sort().join(',') : null;
    } catch (e) { o.parse2Err = e.message; }
  } else if (p1 && typeof p1 === 'object') {
    o.parse1Keys = Object.keys(p1).sort().join(',');
    o.looksJwk = ['d', 'x', 'y'].every((k2) => k2 in p1);
  }
  return o;
}

function tryPair(label, raw) {
  const log = [];
  const attempts = [];
  if (raw == null) { log.push(label + ': 空值'); return { log, matched: null, mode: null }; }
  const s = String(raw);
  attempts.push({ mode: 'as-is', v: s });
  try { const p = JSON.parse(s); if (typeof p === 'string') attempts.push({ mode: 'double-decoded', v: p }); } catch (e) { /* ignore */ }
  for (const a of attempts) {
    let jwk = null;
    try { jwk = JSON.parse(a.v); } catch (e) { log.push(label + ' [' + a.mode + '] parse 失败: ' + e.message); continue; }
    if (!jwk || typeof jwk !== 'object' || !(jwk.x && jwk.y && jwk.d)) {
      log.push(label + ' [' + a.mode + '] 解析成功但非可用 JWK（字段: ' + Object.keys(jwk || {}).join(',') + '）');
      continue;
    }
    const pub = pubFromJwk(jwk);
    const matched = pub === HARDCODED;
    log.push(label + ' [' + a.mode + '] ✅ 可用 JWK，crv=' + (jwk.crv || '?') + ' kty=' + (jwk.kty || '?') +
      ' → 推导公钥 ' + pub.slice(0, 12) + '… 与硬编码公钥配对=' + matched);
    return { log, matched, mode: a.mode };
  }
  return { log, matched: null, mode: null };
}

(async () => {
  const dir = path.join(__dirname, '_audit_0928');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const out = []; const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };

  const { j } = await api('/accounts/' + ACC + '/pages/projects/sinoky');
  const DC = j.result.deployment_configs || {};
  const PV = ((DC.preview || {}).env_vars || {}).VAPID_PRIVATE;
  const DV = ((DC.production || {}).env_vars || {}).VAPID_PRIVATE;

  log('=== Q7 值的结构（不含内容）===');
  log('  preview   : type=' + (PV && PV.type));
  log('    ' + JSON.stringify(shape(PV && PV.value)));
  log('  production: type=' + (DV && DV.type));
  log('    ' + JSON.stringify(shape(DV && DV.value)));

  log('');
  log('=== Q8 解析策略 × 配对判定 ===');
  const pr = tryPair('preview   ', PV && PV.value);
  pr.log.forEach((s) => log('  ' + s));
  const dr = tryPair('production', DV && DV.value);
  dr.log.forEach((s) => log('  ' + s));

  log('');
  log('=== 裁决 ===');
  if (dr.matched === true) log('  production 私钥与硬编码公钥配对 ⇒ 生产推送链路正常');
  else if (dr.matched === false) log('  🔴 production 私钥与硬编码公钥**不配对** ⇒ 生产推送必然失败（VAPID 签名被拒）');
  else log('  ⚠️ production 私钥无法按任何已知策略解析成 JWK ⇒ 若线上真在推送，则 vapidToken 会抛错被 catch');

  fs.writeFileSync(path.join(dir, 'batch1_probe3.txt'), out.join('\n'), 'utf8');
  console.log('\n(产物已写入 _internal/_audit_0928/batch1_probe3.txt)');
})().catch((e) => { console.error('异常：' + (e && e.stack || e)); process.exit(1); });
