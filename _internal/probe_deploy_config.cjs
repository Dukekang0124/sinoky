/* 部署配置健康探针 —— 每次部署后跑一次，把「配置静默丢失」变成可见的红/黄。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 * 2026-09-28 实测发现：生产后端处于**静默故障**状态，而线上表面一切正常：
 *   · POST /api/asr     → 500「Cannot read properties of undefined (reading 'run')」
 *                         （env.AI 未绑定 ⇒ 所有用户的语音识别全挂）
 *   · POST /api/chat    → 200 但 degraded:glm-http401（GLM_KEY 失效 ⇒ 诺诺 AI 全链降级）
 *   · GET  /api/agg     → 403「set STATS_TOKEN」（secret 运行时空）
 *   · GET  /api/feedback→ 404「no FEEDBACK_TOKEN configured」（同上）
 *   · sinoky-push-cron  → failure（每日召回推送停了）
 * 这些都没有告警、没有日志异常、页面照常打开 —— 全靠主动探测才暴露。
 *
 * ── 判据为什么不需要 token ─────────────────────────────────────────────
 * 两个鉴权端点对「未配置」与「配了但 token 不对」返回**不同文案**：
 *   /api/agg       未配置 → 403 {"error":"AGG disabled: set STATS_TOKEN"}
 *                  配了   → 403 {"error":"unauthorized"}
 *   /api/feedback  未配置 → 404 {"error":"read endpoint disabled (no FEEDBACK_TOKEN configured)"}
 *                  配了   → 403 {"error":"forbidden"}
 * 所以「不带 token 请求，问它要 unauthorized 而不是要配置」即可判定 secret 是否生效，
 * 无需把 token 塞进 CI。
 *
 * ── 硬/软分级 ─────────────────────────────────────────────────────────
 * 硬失败（exit 1）= 可在仓库侧自动修的问题：AI 绑定、secret 存在性、KV、静态链路。
 * 软警告（::warning::，不失败）= 需要人工提供凭证的问题：GLM_KEY 失效。
 *   把 GLM 设成硬失败会让「拿不到新 key」期间所有发版卡死，反而训练出「无视红叉」——
 *   那正是本探针要消灭的东西。
 *
 * 用法：node _internal/probe_deploy_config.cjs [base-url]
 * 退出码：0 = 全部硬项通过；1 = 有硬项失败
 */
const BASE = (process.argv[2] || process.env.SINOKY_BASE || 'https://sinoky.pages.dev').replace(/\/$/, '');

let nPass = 0, nFail = 0, nWarn = 0;
const detailBox = [];

function ok(label, extra) {
  nPass++;
  console.log('  PASS  ' + label + (extra ? '   (' + extra + ')' : ''));
}
function bad(label, detail) {
  nFail++;
  console.log('  FAIL  ' + label);
  console.log('        → ' + detail);
  detailBox.push(label + ' :: ' + detail);
}
function warn(label, detail) {
  nWarn++;
  console.log('  WARN  ' + label);
  console.log('        → ' + detail);
  // GitHub Actions 注解：让它在 CI 摘要里显眼，但不失败
  console.log('::warning title=' + label + '::' + String(detail).replace(/[\r\n]+/g, ' '));
}

const bust = () => (BASE.indexOf('?') >= 0 ? '&' : '?') + 'cb=' + Date.now() + Math.random().toString(36).slice(2);

async function req(pathname, init) {
  const r = await fetch(BASE + pathname, init);
  const text = await r.text();
  return { status: r.status, text };
}

/* 200ms 16kHz 单声道 16bit 静音 WAV —— 探 ASR 只需「请求能进到模型」，
   内容为空不影响判定（env.AI 缺失时根本走不到模型，直接抛 undefined.run）。 */
function silentWav() {
  const samples = 3200;
  const data = Buffer.alloc(samples * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

(async () => {
  console.log('部署配置探针 · ' + BASE);
  console.log('─'.repeat(58));

  /* ① 静态链路（Pages 静态产物是否在服务） */
  try {
    const r = await req('/version.json' + bust());
    let v = null;
    try { v = JSON.parse(r.text).version; } catch (e) { /* 下面统一判 */ }
    if (r.status === 200 && v) ok('静态产物可达 /version.json', 'version=' + v);
    else bad('静态产物可达 /version.json', 'HTTP ' + r.status + ' 且未取到 version 字段');
  } catch (e) { bad('静态产物可达 /version.json', e.message); }

  /* ② Worker 存活（Pages Functions 是否被部署带上） */
  try {
    const r = await req('/api/push-sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status === 400 && /need sub/.test(r.text)) ok('Pages Functions 存活 /api/push-sub', '400 need sub');
    else bad('Pages Functions 存活 /api/push-sub', '期望 400 need sub，实得 HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  } catch (e) { bad('Pages Functions 存活 /api/push-sub', e.message); }

  /* ③ KV 绑定 PROFILES */
  try {
    const r = await req('/api/profile?uid=deploy-probe' + bust().replace('?', '&'));
    if (r.status === 200 && /"ok":true/.test(r.text)) ok('KV 绑定 PROFILES', '200 ok:true');
    else bad('KV 绑定 PROFILES', '期望 200 ok:true，实得 HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  } catch (e) { bad('KV 绑定 PROFILES', e.message); }

  /* ④ env.AI 绑定 —— 决定性判据。
        ⚠️ 不能用「状态码非 200」来判：静音 WAV 可能让模型返回空结果，那也是正常的。
        只咬「undefined.run」这个 env.AI 缺失的特征错误。 */
  try {
    const r = await req('/api/asr?target=' + encodeURIComponent('你好') + bust().replace('?', '&'), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: silentWav(),
    });
    if (/reading 'run'/.test(r.text) || /Cannot read properties of undefined/.test(r.text)) {
      bad('Workers AI 绑定 env.AI', 'env.AI 未绑定：HTTP ' + r.status + ' ' + r.text.slice(0, 140) +
        ' —— 检查 wrangler.toml 是否声明 [ai] binding = "AI"（non-inheritable key，只在 Dashboard 配会活不过下一次部署）');
    } else if (r.status === 500) {
      bad('Workers AI 绑定 env.AI', 'HTTP 500（非 undefined.run 形态，需人工看）：' + r.text.slice(0, 140));
    } else {
      ok('Workers AI 绑定 env.AI', 'HTTP ' + r.status + ' 且非 undefined.run');
    }
  } catch (e) { bad('Workers AI 绑定 env.AI', e.message); }

  /* ⑤ STATS_TOKEN 是否真的生效（不要 unauthorized，要「未配置」） */
  try {
    const r = await req('/api/agg' + bust());
    if (/set STATS_TOKEN/.test(r.text)) {
      bad('secret STATS_TOKEN 生效', '运行时空值 —— 期望 403 unauthorized，实得 403 "AGG disabled: set STATS_TOKEN"；' +
        '修复：wrangler pages secret put STATS_TOKEN --project-name sinoky 后再部署一次');
    } else if (r.status === 403 && /unauthorized/.test(r.text)) {
      ok('secret STATS_TOKEN 生效', '403 unauthorized（已配置，探针未带 token 属预期）');
    } else if (r.status === 200) {
      bad('secret STATS_TOKEN 生效', '端点无鉴权即返回 200 ⇒ token 实际未设置（应 403），需重写 secret');
    } else {
      bad('secret STATS_TOKEN 生效', '非预期响应 HTTP ' + r.status + ' ' + r.text.slice(0, 140));
    }
  } catch (e) { bad('secret STATS_TOKEN 生效', e.message); }

  /* ⑥ FEEDBACK_TOKEN 是否真的生效 */
  try {
    const r = await req('/api/feedback' + bust());
    if (/no FEEDBACK_TOKEN configured/.test(r.text)) {
      bad('secret FEEDBACK_TOKEN 生效', '运行时空值 —— 期望 403 forbidden，实得 404 read endpoint disabled；' +
        '修复：wrangler pages secret put FEEDBACK_TOKEN --project-name sinoky 后再部署一次');
    } else if (r.status === 403 && /forbidden/.test(r.text)) {
      ok('secret FEEDBACK_TOKEN 生效', '403 forbidden（已配置，探针未带 token 属预期）');
    } else if (r.status === 200) {
      bad('secret FEEDBACK_TOKEN 生效', '端点无鉴权即返回 200 ⇒ token 实际未设置（应 403），需重写 secret');
    } else {
      bad('secret FEEDBACK_TOKEN 生效', '非预期响应 HTTP ' + r.status + ' ' + r.text.slice(0, 140));
    }
  } catch (e) { bad('secret FEEDBACK_TOKEN 生效', e.message); }

  /* ⑦ AI 链可用性（软警告 —— 凭证只能由人补，不该阻塞发版）
        ⚠️ 判据要小心：GLM 失效但 CF Workers AI 兜底成功时，响应看起来**完全正常**
           （reply 有内容、degraded:false），只有 model 字段暴露了「这次不是 GLM 答的」。
           所以这里既看 degraded 真值，也看 model 前缀。 */
  try {
    const r = await req('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '你好', uid: 'deploy-probe', mode: 'chat' }),
    });
    const m = r.text.match(/glm-http(\d+)/);
    const model = (r.text.match(/"model"\s*:\s*"([^"]*)"/) || [])[1] || '(未知)';
    const degradedTrue = /"degraded"\s*:\s*true/.test(r.text);
    if (m) {
      warn('AI 链可用性（chat）', '智谱 HTTP ' + m[1] + ' 且 CF Workers AI 兜底也失败 —— 用户侧 AI 能力不可用。' +
        '401=凭证被删/失效，402=余额或额度不足。');
    } else if (/ai-exc@@/.test(r.text)) {
      warn('AI 链可用性（chat）', '兜底链整体异常：' + r.text.slice(0, 160));
    } else if (degradedTrue) {
      warn('AI 链可用性（chat）', 'degraded=true：' + r.text.slice(0, 160));
    } else if (/^workers-ai:/.test(model)) {
      warn('GLM_KEY 可用性（间接判据）', '本次回复由 CF Workers AI 兜底（model=' + model + '）而非 GLM —— ' +
        '通常意味着 GLM_KEY 失效（401）或超时。用户侧无感，但成本与质量口径已改变。' +
        '需人工提供新的 GLM key：wrangler pages secret put GLM_KEY --project-name sinoky 后重新部署。');
    } else {
      ok('AI 链可用性（chat）', 'model=' + model);
    }
  } catch (e) { warn('AI 链可用性（chat）', '探测请求本身失败：' + e.message); }

  /* ⑧ 精确判定（可选）：带 STATS_TOKEN 时调 /api/ai-probe —— 它是服务端自带的运维自检端点，
        能直接给出 aiBinding 状态与 glm.status，比上面任何间接判据都硬。
        CI 不提供该 secret（保持零新增凭证），所以此段在 CI 里会 SKIP；
        本地排查时 export STATS_TOKEN=<值> 即可开启。 */
  const statsTok = process.env.STATS_TOKEN || '';
  if (!statsTok) {
    console.log('  SKIP  /api/ai-probe 精确判定 —— 未提供 STATS_TOKEN（本地可 export STATS_TOKEN=... 开启）');
  } else {
    try {
      const r = await req('/api/ai-probe?token=' + encodeURIComponent(statsTok) + bust().replace('?', '&'));
      let j = null;
      try { j = JSON.parse(r.text); } catch (e) { /* 下面统一判 */ }
      if (!j || r.status !== 200) {
        bad('/api/ai-probe 精确判定', 'HTTP ' + r.status + ' ' + r.text.slice(0, 160));
      } else {
        if (j.aiBinding === 'ok') ok('/api/ai-probe · aiBinding', 'ok');
        else bad('/api/ai-probe · aiBinding', '服务端报告 aiBinding=' + j.aiBinding +
          '（应 ok）—— 即 wrangler.toml 的 [ai] binding = "AI" 未生效');

        const g = j.glm || {};
        if (g.ok) ok('/api/ai-probe · glm', 'HTTP ' + g.status);
        else warn('/api/ai-probe · glm', '智谱返回 ' + (g.status || 0) + ' —— GLM 不可用（用户侧由 CF Workers AI 兜底）');

        const badModel = (j.models || []).filter((x) => !x.ok);
        if (!badModel.length) ok('/api/ai-probe · 兜底模型链', (j.models || []).length + ' 个模型全部可用');
        else warn('/api/ai-probe · 兜底模型链', badModel.map((x) => x.model + '(' + (x.error || 'FAIL') + ')').join(' · '));
      }
    } catch (e) { bad('/api/ai-probe 精确判定', e.message); }
  }

  console.log('─'.repeat(58));
  console.log('  通过 ' + nPass + ' · 失败 ' + nFail + ' · 警告 ' + nWarn);
  if (nFail) {
    console.log('');
    console.log('  需处理：');
    detailBox.forEach((d) => console.log('   · ' + d));
  }
  process.exit(nFail ? 1 : 0);
})().catch((e) => {
  console.error('探针自身异常：' + (e && e.stack || e));
  process.exit(1);
});
