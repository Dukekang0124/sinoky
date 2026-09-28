/* 第 1 批修复前置侦察（一次性）—— 2026-09-28
 *
 * 🔴 安全纪律：本脚本会读到 preview 环境 VAPID_PRIVATE 的**明文值**（CF API 可读），
 *    因此**只输出布尔判定，绝不打印任何密钥值**。产物写 _internal/_audit_0928/（已 gitignore）。
 *
 * 要回答的四个问题：
 *   Q1 production / preview 各有哪些绑定（特别是有没有 durable object）
 *   Q2 preview 与 production 的 VAPID 是不是同一对密钥 —— 决定「轮换」会不会连坐线上订阅
 *   Q3 FEEDBACK KV 里 rl: 前缀到底多少键（要清的存量）
 *   Q4 sinoky-rl_Counter 这个 DO namespace 是否真实存在（写进 toml 要用它的 id）
 */
const fs = require('fs');
const path = require('path');

const ACC = 'd24caa86ff464fd98e1c95a11c814a61';
const SEC = 'C:/Users/Admin/.sinoky-secrets';
const FB_ID = '3e8bfa1dd43c49e1a9b77c336ded54df';
const TOKEN = fs.readFileSync(path.join(SEC, 'CLOUDFLARE_API_TOKEN.txt'), 'utf8').trim();
const H = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

const out = [];
const log = (...a) => { const s = a.join(' '); console.log(s); out.push(s); };

async function api(p) {
  const r = await fetch('https://api.cloudflare.com/client/v4' + p, { headers: H });
  let j = null;
  try { j = await r.json(); } catch (e) { j = { success: false, errors: [{ message: 'non-json' }] }; }
  return { status: r.status, j };
}

(async () => {
  const dir = path.join(__dirname, '_audit_0928');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  /* ── Q1/Q2：Pages 项目配置 ───────────────────────────── */
  const { status, j } = await api('/accounts/' + ACC + '/pages/projects/sinoky');
  if (!j.success) {
    console.log('CF API 失败 HTTP ' + status + ' ' + JSON.stringify(j.errors));
    process.exit(1);
  }
  const proj = j.result;
  const DC = proj.deployment_configs || {};

  log('=== Q1 绑定清单 ===');
  for (const envName of ['production', 'preview']) {
    const dc = DC[envName] || {};
    log('[' + envName + '] 顶层键: ' + Object.keys(dc).sort().join(', '));
    log('  kv_namespaces : ' + JSON.stringify(Object.keys(dc.kv_namespaces || {})));
    log('  ai_bindings   : ' + JSON.stringify(dc.ai_bindings));
    log('  d1/r2/do/其他 : ' + JSON.stringify(Object.fromEntries(
      Object.entries(dc).filter(([k]) => /durable|d1|r2|service|queue|analytics/i.test(k))
    )));
    const ev = dc.env_vars || {};
    log('  env_vars      : ' + Object.entries(ev).map(([k, v]) => k + '(' + (v && v.type) + ')').join(', '));
    log('  secrets 键名  : ' + JSON.stringify(Object.keys(dc.secrets || {})));
  }

  const P = (DC.preview && DC.preview.env_vars) || {};
  const D = (DC.production && DC.production.env_vars) || {};
  log('');
  log('=== Q2 VAPID 同值判定（只输出布尔，不打印值）===');
  const same = (a, b) => !!a && !!b && String(a.value) === String(b.value);
  log('  VAPID_PRIVATE  preview == production : ' + same(P.VAPID_PRIVATE, D.VAPID_PRIVATE));
  log('  VAPID_PUBLIC   preview == production : ' + same(P.VAPID_PUBLIC, D.VAPID_PUBLIC));
  log('  VAPID_PRIVATE type : preview=' + (P.VAPID_PRIVATE && P.VAPID_PRIVATE.type) +
      ' / production=' + (D.VAPID_PRIVATE && D.VAPID_PRIVATE.type));
  log('  VAPID_PRIVATE 存在性 : preview=' + !!P.VAPID_PRIVATE + ' production=' + !!D.VAPID_PRIVATE);
  log('  VAPID_PUBLIC  存在性 : preview=' + !!P.VAPID_PUBLIC + ' production=' + !!D.VAPID_PUBLIC);

  try {
    const local = JSON.parse(fs.readFileSync(path.join(SEC, 'vapid.json'), 'utf8'));
    log('  本地 vapid.json 字段: ' + Object.keys(local).join(', '));
    const lk = local.privateKey || local.private_key || local.VAPID_PRIVATE || '';
    const lp = local.publicKey || local.public_key || local.VAPID_PUBLIC || '';
    log('  本地私钥 == preview 私钥    : ' + (!!lk && same({ value: lk }, P.VAPID_PRIVATE)));
    log('  本地私钥 == production 私钥 : ' + (!!lk && same({ value: lk }, D.VAPID_PRIVATE)));
    log('  本地公钥 == preview 公钥    : ' + (!!lp && same({ value: lp }, P.VAPID_PUBLIC)));
    log('  本地公钥 == production 公钥 : ' + (!!lp && same({ value: lp }, D.VAPID_PUBLIC)));
  } catch (e) {
    log('  本地 vapid.json 读取失败: ' + e.message);
  }

  /* ── Q4：Durable Object namespace 清单 ───────────────── */
  log('');
  log('=== Q4 Durable Object namespaces ===');
  const doNs = await api('/accounts/' + ACC + '/workers/durable_objects/namespaces');
  if (doNs.j.success) {
    const arr = doNs.j.result || [];
    if (!arr.length) log('  (空 —— 账号下没有任何 DO namespace)');
    for (const n of arr) log('  id=' + n.id + '  class=' + n.class + '  script=' + n.script + '  name=' + (n.name || '-'));
  } else {
    log('  查询失败 HTTP ' + doNs.status + ' ' + JSON.stringify(doNs.j.errors));
  }

  /* ── Q3：KV namespaces + FEEDBACK 键统计 ─────────────── */
  log('');
  log('=== KV namespaces ===');
  const kv = await api('/accounts/' + ACC + '/storage/kv/namespaces?per_page=50');
  for (const n of (kv.j.result || [])) log('  ' + n.id + '  ' + n.title);

  log('');
  log('=== Q3 FEEDBACK 键统计 ===');
  async function countKeys(prefix) {
    let cursor = '', n = 0;
    for (let i = 0; i < 30; i++) {
      const u = '/accounts/' + ACC + '/storage/kv/namespaces/' + FB_ID + '/keys?limit=1000'
        + (prefix ? '&prefix=' + encodeURIComponent(prefix) : '')
        + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const r = await api(u);
      if (!r.j.success) return { n: n, err: JSON.stringify(r.j.errors) };
      const arr = r.j.result || [];
      n += arr.length;
      cursor = (r.j.result_info && r.j.result_info.cursor) || '';
      if (!cursor || arr.length < 1000) break;
    }
    return { n: n, err: null };
  }
  for (const p of ['rl:', 's:', 'f:', 'unl:', 'alert:', 'push:']) {
    const c = await countKeys(p);
    log('  "' + p + '" 键数 = ' + c.n + (c.err ? '  (查询出错: ' + c.err + ')' : ''));
  }
  const all = await countKeys('');
  log('  (全部) 键数 = ' + all.n);

  fs.writeFileSync(path.join(dir, 'batch1_probe.txt'), out.join('\n'), 'utf8');
  console.log('\n(产物已写入 _internal/_audit_0928/batch1_probe.txt)');
})().catch((e) => { console.error('侦察脚本异常：' + (e && e.stack || e)); process.exit(1); });
