// Sinoky Pages 同源后端（advanced mode _worker.js）
// 路由：/api/asr → Whisper 中文识别（16kHz WAV 最稳）
//       /api/tts → 中文语音合成（Google → melotts → 有道 多源兜底）
//       /api/score → 音节级发音评分（pinyin-pro 转拼音，声母/韵母/调分别扣分）
//       其他 → 静态资源（env.ASSETS）
// 注：绑 env.AI（Pages 项目 settings→bindings 已通过 CF API 配置 type=ai name=AI）
//
// v0.3.7：评分合并进 Pages Worker 后原先只能用简化算法（字符重合），
// 拿不到"声母/韵母/调"的分别扣分。这里用 esbuild 把 pinyin-pro 打成单文件
// ESM bundle（457KB / gzip 150KB），Pages Worker 就能加载并恢复音节级评分。
//
// ⚠️ 关键坑：pinyin-pro 的模块顶层会调 setTimeout，而 Cloudflare Workers
// 禁止在全局作用域设置 timer（报 "Disallowed operation called within global
// scope"）。所以**绝不能用静态 import**（静态 import 会立刻执行顶层代码），
// 必须用动态 import() 在 fetch handler 内加载 —— timer 就落到请求处理阶段，合法。
let PINYIN = null;
async function ensurePinyin() {
  if (!PINYIN) {
    const mod = await import('./vendor/pinyin-pro.bundle.mjs');
    PINYIN = mod.pinyin;
  }
  return PINYIN;
}
/* ===== 音节级发音评分（移植自原 sinoky-score worker，算法完全一致）=====
   耳朵：前端 MediaRecorder 录音 → /api/asr(whisper) 转汉字 → 这里评分。
   大脑：pinyin-pro 把两端汉字转拼音串 → 解析声母/韵母/调 → 加权比对。
   关键：比的是"拼音符号串"，只用 pinyin-pro 一次（汉字→拼音数组），
   绝不再把拼音当汉字二次转写。 */
import { handleBadgeApi } from './badge-backend.mjs';
const W = { initial: 0.2, final: 0.3, tone: 0.5 };

// 拼音符号 → 数字调值（à→4 等；无声调符号→0 轻声）
const TONE_SYM = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
  'ü': 0, 'ń': 2, 'ň': 3, 'ǹ': 4, 'ḿ': 2,
};

function parsePy(py) {
  let tone = 0;
  for (const ch of py) {
    if (TONE_SYM[ch] !== undefined) { tone = TONE_SYM[ch]; break; }
  }
  // NFD 分解 + 去掉组合音标，得到无声调的基础拼音
  const base = py.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const initials = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
  let initial = '';
  for (const ini of initials) {
    if (base.startsWith(ini)) { initial = ini; break; }
  }
  const final = initial ? base.slice(initial.length) : base;
  return { initial, final, tone };
}

function cmp(a, b) {
  const errs = [];
  let s = 0;
  if (a.initial === b.initial) s += W.initial; else errs.push('initial');
  if (a.final === b.final) s += W.final; else errs.push('final');
  if (a.tone === 0 || b.tone === 0) {
    if (a.tone !== 0 || b.tone !== 0) errs.push('neutral/tone mismatch');
  } else if (a.tone === b.tone) {
    s += W.tone;
  } else {
    errs.push('tone');
  }
  return { score: s, errs };
}

function scoreSyllables(targetHz, userHz, py) {
  const tArr = py(targetHz, { toneType: 'symbol', type: 'array', nonZh: 'removed' });
  const uArr = py(userHz, { toneType: 'symbol', type: 'array', nonZh: 'removed' });
  const n = Math.max(tArr.length, uArr.length);
  const perSyll = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t = tArr[i], u = uArr[i];
    if (!t || !u) {
      const tp = t ? parsePy(t) : { tone: 0 }, up = u ? parsePy(u) : { tone: 0 };
      perSyll.push({ target: t || '—', user: u || '—', score: 0, errs: ['missing syllable'], tExp: tp.tone, tGot: up.tone, toneOk: false });
      continue;
    }
    const tp = parsePy(t), up = parsePy(u);
    const r = cmp(tp, up);
    total += r.score;
    /* 声调闭环(A)：标记声调是否对，并给出期望/实测调值，前端据此标「应为 X 声」 */
    const toneErr = r.errs.indexOf('tone') >= 0 || r.errs.indexOf('neutral/tone mismatch') >= 0;
    perSyll.push({ target: t, user: u, score: r.score, errs: r.errs, tExp: tp.tone, tGot: up.tone, toneOk: !toneErr });
  }
  const overall = n ? Math.round((total / n) * 100) : 0;
  // verdict 必须英文 —— 目标用户是不懂中文的外国学习者，中文输出即缺陷
  const verdict = overall >= 85 ? 'Great ✅' : overall >= 70 ? 'Pass ⚠️' : 'Retry ❌';
  return { overall, verdict, perSyll, n };
}

/* ===== v0.3.23 安全加固：公开 API 滥用防护 =====
   背景：/api/tts、/api/asr 走 CF Workers AI（按调用计费），/api/feedback POST 写 KV，
   三者此前完全公开、无鉴权、无限流。上线后被脚本/爬虫直接打会刷爆额度产生费用、污染 KV。
   两层防护（不改前端调用逻辑，刷新即生效）：
   1) Origin 校验：同源（浏览器通常不发 Origin 头）或同 host → 放行；跨站浏览器调用 → 403。
      挡掉绝大多数跨站盗用（恶意站点嵌脚本调你的端点）。
   2) 每 IP 60s 窗口限 40 次：首选 Durable Object 强一致计数（见下），兜底 KV / in-isolate。
   注：/health 与 feedback 读端点已有独立鉴权，此处跳过。

   ⚠️ 为什么计数必须用 Durable Object（踩坑实录）：
   - 方案一 in-isolate Map：CF 把请求随机分发到大量 isolate，单 isolate 计数永远到不了阈值。废。
   - 方案二 KV read-modify-write：KV 读有边缘缓存（~60s）+ 最终一致，突发请求下
     45 连发实测只累到 10 —— 计数器永远数不准。CF 文档明确不推荐 KV 做限流。废。
   - 方案三 Durable Object（最终方案）：同一 IP 的请求经 idFromName(ip) 路由到同一
     DO 实例，SQLite storage 强一致，计数原子准确。Worker sinoky-rl 部署在
     kang7108558 账号，namespace sinoky-rl_Counter，通过 API 绑到 Pages 项目（binding=RL）。
     免费额度 100k 请求/天，Sinoky 体量零成本。 */
/* v0.3.68: 加 Capacitor 原生壳 Origin —— APK WebView 页面源是 https://localhost(Android)
   / capacitor://localhost(iOS)，不加会被 guardApi 403 拒掉 */
const ALLOWED_ORIGINS = ['https://sinoky.pages.dev', 'https://localhost', 'capacitor://localhost'];
// 自定义域名（如 https://sinoky.com）上线后，同源访问会由 sameHost 自动放行，无需加进此白名单；
// 此数组仅用于放行「非同源但合法的第三方站」（一般留空）。
const RATE_WINDOW = 60_000;   // 滑动窗口 60 秒
const RATE_MAX = 120;         // 每 IP 窗口内最多 120 次。v0.23.8（UX 评审 M14）：原为 40 —— 公司/校园网共享出口
                              // 多用户会互相挤掉。防刷仍由 Origin allowlist + DO 强一致计数承担，单用户正常使用远不会到 120。
const RATE_MAP = new Map();   // 兜底：无 DO/KV 绑定时（本地 dev）用 in-isolate 近似计数

async function rateOk(ip, env) {
  const now = Date.now();
  // 首选 Durable Object 计数（强一致、全局准确）：binding=RL，namespace sinoky-rl_Counter
  if (env && env.RL) {
    try {
      const id = env.RL.idFromName('ip:' + ip);
      const stub = env.RL.get(id);
      const res = await stub.fetch('https://do/hit?max=' + RATE_MAX + '&window=' + RATE_WINDOW);
      if (res.ok) {
        const r = await res.json();
        return !!r.allowed;
      }
    } catch (e) { /* DO 调用失败 → 落到 KV/Map 兜底，不阻塞用户 */ }
  }
  // 兜底一：KV 计数（读有边缘缓存，突发下计数偏少 —— 仅当 DO 不可用时降级用）
  if (env && env.FEEDBACK) {
    const key = 'rl:' + ip;
    let d = { ts: now, count: 0 };
    try {
      const raw = await env.FEEDBACK.get(key);
      if (raw) { const p = JSON.parse(raw); if (now - p.ts <= RATE_WINDOW) d = p; }
    } catch (e) { /* 忽略读取异常，按新窗口计 */ }
    d.count++;
    const allowed = d.count <= RATE_MAX;
    try {
      // 注意：此处不放 expirationTtl（与 feedback 写保持一致，避免 options 触发异常被吞）。
      // 过期由读取侧的 now - p.ts <= RATE_WINDOW 判定；rl: 键已被 feedback 读端点跳过。
      await env.FEEDBACK.put(key, JSON.stringify(d));
    } catch (e) { /* 写入失败不阻塞用户，仅失去本次计数 */ }
    return allowed;
  }
  // 兜底二（本地 dev）：in-isolate 近似，跨 isolate 不精确
  if (RATE_MAP.size > 2000) {
    for (const [k, v] of RATE_MAP) if (now - v.ts > RATE_WINDOW) RATE_MAP.delete(k);
  }
  const e = RATE_MAP.get(ip);
  if (!e || now - e.ts > RATE_WINDOW) { RATE_MAP.set(ip, { ts: now, count: 1 }); return true; }
  e.count++;
  return e.count <= RATE_MAX;
}

function clientIp(req) {
  return (req.cf && req.cf.connecting_ip)
    || req.headers.get('cf-connecting-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown';
}

async function guardApi(req, url, json, env) {
  if (url.pathname === '/health') return null;                                   // 健康检查跳过
  if (url.pathname === '/api/feedback' && req.method === 'GET') return null;     // 读端点已有 token 鉴权
  const origin = req.headers.get('origin');
  if (origin) {
    const sameHost = origin === url.origin;
    if (!sameHost && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ ok: false, error: 'origin not allowed' }, 403);
    }
  }
  // ⚠️ 必须 await：rateOk 是 async 函数，漏 await 的话拿到的是 Promise（恒真值），
  // !Promise === false → 429 分支永远不触发（v0.3.23 排查数轮的真实根因，勿改回）。
  if (!(await rateOk(clientIp(req), env))) {
    return json({ ok: false, error: 'rate limited', retry_after: Math.ceil(RATE_WINDOW / 1000) }, 429);
  }

  return null;
}



/* Edge TTS 拟人化主音源：经独立 Worker sinoky-edge-tts 转发。
   Pages Functions 不支持出站 websocket 升级（请求会挂死），故把微软 ws 握手封进独立
   Worker（已部署 kang7108558 账号，仅接受 x-edge-key）。此处仅做普通 HTTPS 转发，
   失败返回 null 由上层回退 google/melo/youdao。默认 XiaoxiaoNeural 女声，?voice= 切男声。 */
const EDGE_TTS_URL = 'https://sinoky-edge-tts.kang7108558.workers.dev/tts';
const EDGE_KEY = 'sk_sinoky_edge_x9K2';
async function edgeTts(text, voiceShort) {
  try {
    const r = await fetch(EDGE_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-edge-key': EDGE_KEY },
      body: JSON.stringify({ text, voice: voiceShort || 'zh-CN-XiaoxiaoNeural' }),
    });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 1000) return null;
    return { body: new Uint8Array(buf), type: 'audio/mpeg', src: 'edge' };
  } catch (e) { return null; }
}

/* 阶段二 CosyVoice2 情感语音：转发到独立 Worker 的 /cosy 路由（百炼 HTTP）。
   四档映射在 Worker 内完成：开心→v3-plus+happy；严肃→v3-plus+sad(≈严肃)；
   温柔→v2+龙小淳/龙湾天生音色；标准档走 Edge 不进此路由。缺 key 时 /cosy 返 501 →
   收 null；上层兜底链自动回退 Edge，不让用户静音。instruct 透传情感档(happy/serious/gentle)。 */
const COSY_TTS_URL = 'https://sinoky-edge-tts.kang7108558.workers.dev/cosy';
async function cosyTts(text, voiceShort, instruct) {
  try {
    const r = await fetch(COSY_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-edge-key': EDGE_KEY },
      body: JSON.stringify({ text, voice: voiceShort || 'zh-CN-XiaoxiaoNeural', instruct: instruct || '' }),
    });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 1000) return null;
    return { body: new Uint8Array(buf), type: 'audio/mpeg', src: 'cosy' };
  } catch (e) { return null; }
}

/* ===== v0.3.33 M2 埋点（P0）：匿名使用统计 =====
   目的：让 M2 判停线（D7留存≥15% / 北极星每周盲说句数≥10 / 首日完成率≥60% / 声调使用率≥40%）
         真的能被测量，而不是靠感觉。此前全库零埋点，这四个数一个都拿不到。
   原则：① 全匿名，只有设备 uid，无 PII；② 零新增请求——统计寄生在已有的 /api/profile 同步里；
        ③ 幂等：用 max/最新值语义，重复上报不会重复计数；④ 统计失败绝不影响进度保存。
   存储：KV PROFILES 的 s:<uid>（与进度 p:<uid> 分开）。 */
async function recordStat(env, uid, st) {
  if (!env.PROFILES || !uid || !st) return;
  const key = 's:' + uid;
  let s = { first: 0, last: 0, days: [], phrases: 0, tone: 0, day1Done: false, scenes: {}, src: '', funnel: {}, err: { n: 0, last: '' } };
  let s_before = null;  // v0.3.39：保留写入前的独立副本，用于判断业务字段是否真变化
  try {
    const raw = await env.PROFILES.get(key);
    if (raw) { try { s_before = JSON.parse(raw); s = Object.assign(s, s_before); } catch (e) { /* 脏数据则重建 */ } }
  /* v0.23.8 FIX（真实缺陷，本轮测试咬出来的）：Object.assign 是**浅拷贝** ——
     s.feat / s.scenes / s.err 这些嵌套对象与 s_before 的同名属性指向**同一个对象**。
     后面原地改 s.err.n 会把 s_before 一起改掉 ⇒ 脏检查
        before = sig(s_before)  与  sig(s)
     恒相等（两边看的是同一块内存）⇒ 这些字段的**单独变化永远触发不了写入**。
     （v0.3.36 / v0.3.39 起就在这个坑上，只是没人验过。）

     这里只隔离**本组新增**的 funnel / err：它们的写放大有上界
     （漏斗每位一生 0→1 一次，共 ≤4 次；错误用 3 档粗桶），不威胁每天 1000 写的配额。
     feat / scenes 的同一缺陷**本轮不动** —— 修它会让「只浏览场景、不说话」的用户
     每次 scene 计数变化都写一次 KV，那是**配额决策**，应交康哥单独拍板。 */
  if (s_before) {
    s.funnel = Object.assign({}, s_before.funnel || {});
    s.err = Object.assign({}, s_before.err || { n: 0, last: '' });
  }
  } catch (e) { /* 读失败用默认值 */ }

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (!s.first) s.first = now;
  s.last = now;
  if (!Array.isArray(s.days)) s.days = [];
  if (s.days.indexOf(today) < 0) s.days.push(today);
  // v0.23.8（UX 评审 L6）：与前端同口径，日期数组上限 400 天
  if (s.days.length > 400) s.days = s.days.slice(-400);

  // 幂等：累计量取 max（用户换设备/重复上报不会虚增）
  const ph = Math.max(0, Number(st.phrases) || 0);
  const tn = Math.max(0, Number(st.tone) || 0);
  if (ph > (s.phrases || 0)) s.phrases = ph;
  if (tn > (s.tone || 0)) s.tone = tn;
  if (st.day1Done) s.day1Done = true;
  /* v0.23.8 FIX：自测设备标记。src=test 不可逆——自测机不会“变回”真实用户，
     否则一次误点 ?src=real 就把历史自测数据洗成真实数据。 */
  if (String(st.src || '') === 'test') s.src = 'test';
  else if (!s.src) s.src = 'real';
  // v0.3.36 功能级使用计数（tone/cards/reading/sentences/prog/scene 打开次数），同口径 max 幂等
  if (st.feat && typeof st.feat === 'object') {
    s.feat = s.feat || {};
    for (const k in st.feat) {
      const v = Math.max(0, Number(st.feat[k]) || 0);
      if (v > (s.feat[k] || 0)) s.feat[k] = v;
    }
  }
  /* v0.23.8 FIX（审计 P3-13）：漏斗四步 —— OR 合并（走过就是走过）。 */
  if (st.funnel && typeof st.funnel === 'object') {
    s.funnel = s.funnel || {};
    for (const fk of ['open', 'heard', 'spoke', 'verified']) if (st.funnel[fk]) s.funnel[fk] = 1;
  }
  /* 错误计数：n 取 max（幂等）；last 跟随 n 较大的一侧。 */
  if (st.err && typeof st.err === 'object') {
    const en = Math.max(0, Number(st.err.n) || 0);
    s.err = s.err || { n: 0, last: '' };
    if (en > (s.err.n || 0)) { s.err.n = en; if (st.err.last) s.err.last = String(st.err.last).slice(0, 160); }
    else if (!s.err.last && st.err.last) s.err.last = String(st.err.last).slice(0, 160);
  }
  // 首次开口时间：只在 phrases 首次 >0 时记录（用于"首日完成首次挑战率"）
  if (ph > 0 && !s.firstPhraseAt) s.firstPhraseAt = now;
  if (st.scenes && typeof st.scenes === 'object') {
    s.scenes = s.scenes || {};
    for (const k in st.scenes) {
      const v = Math.max(0, Number(st.scenes[k]) || 0);
      if (v > (s.scenes[k] || 0)) s.scenes[k] = v;
    }
  }
  // v0.3.39 写入节流：派生统计无变化就跳过 put（每天 KV 写仅 1000 配额）。
  // 业务字段 = phrases/tone/day1Done/feat/scenes/days；忽略 first/last/firstPhraseAt（时间戳每次变，非业务变化）。
  const sig = (o) => JSON.stringify([
    o.phrases || 0, o.tone || 0, !!o.day1Done,
    o.feat || {}, o.scenes || {}, (o.days || []).slice().sort(),
    o.src || '',   /* v0.23.8：自测标记变化也要落盘 */
    o.funnel || {},/* v0.23.8：漏斗四位各只从 0→1 一次 ⇒ 一生最多 4 次状态变化 */
    /* v0.23.8（配额纪律）：错误数**必须用粗桶进 sig**。若直接放 n，就会
       「每多一条错误 → 下一次上报多一次 KV 写」——错误越多写得越勤，
       正好在最脆弱的时候加压。四档封顶，写放大上界是常数。 */
    (function (n) { return n === 0 ? 0 : n < 3 ? 1 : n < 10 ? 2 : 3; })((o.err && o.err.n) || 0)
  ]);
  const before = s_before ? sig(s_before) : null;
  if (before !== null && before === sig(s)) {
    console.log('[RECORDSTAT] skip no-change', key);
    return;
  }
  await env.PROFILES.put(key, JSON.stringify(s));
}

/* 聚合看板：只输出汇总数字，不返回任何个人信息。
   注意分母口径：留存/首日完成率只统计"已过相应天数"的用户，避免新用户拉低分母造成误判。 */
async function summarizeStats(env) {
  const DAY = 86400000;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const list = await env.PROFILES.list({ prefix: 's:' });
  const keys = (list && list.keys) || [];

  let users = 0, dau = 0, phraseSum = 0, toneUsers = 0, day1Users = 0;
  let e1 = 0, r1 = 0, e3 = 0, r3 = 0, e7 = 0, r7 = 0, firstDayDone = 0;
  const sceneDist = {};
  const featDist = {};   /* v0.3.36 功能使用分布 */

  /* v0.23.8 FIX（审计 P0-2 / P0-3）：
     - MAU：最近 7 / 30 个自然日内至少活跃 1 天（活跃日 = days 数组）。
       这是“读时聚合”——复用本函数既有的全表遍历，**零新增 KV 写**。
     - real 真实口径：把自测机（src=test）从比率里剔除。
       否则自己在自己机器上刷的数字会假装成用户行为，判停线就是自欺。 */
  const dayAgo = (n) => new Date(now - n * DAY).toISOString().slice(0, 10);
  const c7 = dayAgo(6), c30 = dayAgo(29);   /* 含今天共 7 / 30 天 */
  let mau7 = 0, mau30 = 0, mau7Real = 0, mau30Real = 0;
  let usersReal = 0, usersTest = 0, dauReal = 0, day1Real = 0, toneReal = 0, phraseSumReal = 0;

  /* v0.23.8 FIX（审计 P3-13）：漏斗四步 + 错误聚合（同样是读时聚合，零新增写） */
  let fOpen = 0, fHeard = 0, fSpoke = 0, fVerif = 0;
  let fOpenReal = 0, fHeardReal = 0, fSpokeReal = 0, fVerifReal = 0;
  let errDevices = 0, errDevicesReal = 0, errTotal = 0;
  const errTop = {};

  for (const k of keys) {
    const raw = await env.PROFILES.get(k.name);
    if (!raw) continue;
    let s; try { s = JSON.parse(raw); } catch (e) { continue; }
    users++;
    const isTest = String(s.src || '') === 'test';
    if (isTest) usersTest++; else usersReal++;
    const days = Array.isArray(s.days) ? s.days : [];
    if (days.indexOf(today) >= 0) { dau++; if (!isTest) dauReal++; }
    const ph = Number(s.phrases) || 0;
    phraseSum += ph;
    if (!isTest) phraseSumReal += ph;
    if ((Number(s.tone) || 0) > 0) { toneUsers++; if (!isTest) toneReal++; }
    if (s.day1Done) { day1Users++; if (!isTest) day1Real++; }
    if (s.scenes) for (const sc in s.scenes) sceneDist[sc] = (sceneDist[sc] || 0) + (Number(s.scenes[sc]) || 0);
    if (s.feat) for (const f in s.feat) featDist[f] = (featDist[f] || 0) + (Number(s.feat[f]) || 0);

    /* 漏斗（v0.23.8）：每一步都按"走到过这一步的设备数"计，比率以 open 为分母。 */
    const fu = s.funnel || {};
    if (fu.open)     { fOpen++;     if (!isTest) fOpenReal++; }
    if (fu.heard)    { fHeard++;    if (!isTest) fHeardReal++; }
    if (fu.spoke)    { fSpoke++;    if (!isTest) fSpokeReal++; }
    if (fu.verified) { fVerif++;    if (!isTest) fVerifReal++; }

    /* 错误（v0.23.8）：设备数 / 总次数 / 最近一条的分布（取 top 5） */
    const errN = (s.err && Number(s.err.n)) || 0;
    if (errN > 0) {
      errDevices++; errTotal += errN;
      if (!isTest) errDevicesReal++;
      const em = String((s.err && s.err.last) || 'unknown').slice(0, 80);
      errTop[em] = (errTop[em] || 0) + 1;
    }

    /* MAU：days 里有无活跃日落在窗口内。
       'YYYY-MM-DD' 的字典序即时间序 ⇒ 直接比字符串（避开 Date 解析）。 */
    let a7 = false, a30 = false;
    for (const d of days) {
      if (d >= c7) { a7 = true; a30 = true; break; }
      if (d >= c30) a30 = true;
    }
    if (a7) { mau7++; if (!isTest) mau7Real++; }
    if (a30) { mau30++; if (!isTest) mau30Real++; }

    const first = Number(s.first) || 0;
    if (!first) continue;
    const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
    const inDays = (offset) => days.indexOf(dayOf(first + offset * DAY)) >= 0;
    // 满 N 天才计入分母（eligible），否则新用户会把留存率拉低、得出错误结论
    if (now - first >= 1 * DAY) { e1++; if (inDays(1)) r1++; }
    if (now - first >= 3 * DAY) { e3++; if (inDays(3)) r3++; }
    if (now - first >= 7 * DAY) { e7++; if (inDays(7)) r7++; }
    // 首日完成首次挑战：开口时间距首次活跃 ≤1 天
    if (s.firstPhraseAt && (Number(s.firstPhraseAt) - first) <= DAY && (now - first) >= 1 * DAY) firstDayDone++;
  }

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);   // 分母为 0 时返回 null（而不是假的 0%）
  const d1 = pct(r1, e1), d3 = pct(r3, e3), d7 = pct(r7, e7);
  const ppu = users ? Math.round((phraseSum / users) * 10) / 10 : 0;
  const fdr = pct(firstDayDone, e1), tur = pct(toneUsers, users);

  /* v0.23.8：真实口径（排除自测机）—— 判停线只该看这一组 */
  const rUsers = usersReal;
  const rPpu = rUsers ? Math.round((phraseSumReal / rUsers) * 10) / 10 : 0;
  const rDay1 = pct(day1Real, rUsers);

  return {
    ok: true, asOf: new Date(now).toISOString(),
    users, dau, phraseSum,
    mau7, mau30,
    real: {
      users: usersReal, test: usersTest, dau: dauReal,
      mau7: mau7Real, mau30: mau30Real,
      phrasesPerUser: rPpu, day1DoneRate: rDay1, toneUsageRate: pct(toneReal, rUsers),
      note: 'real = 排除 src=test 的自测设备；本机自测请用 ?src=test 打开一次（永久生效）'
    },
    retention: {
      d1: d1, d3: d3, d7: d7,
      eligible: { d1: e1, d3: e3, d7: e7 },   // 分母：满对应天数的用户数
      note: '留存在"满 N 天"的用户里算，分母随内测推进逐渐变大'
    },
    northStar: { phrasesPerUser: ppu, target: 10 },
    toneUsageRate: tur,
    firstDayCompletionRate: fdr,
    day1DoneRate: pct(day1Users, users),
    sceneDist,
    featDist,
    /* v0.23.8 FIX（审计 P3-13）：漏斗四步 + 错误。比率分母统一用 open（"打开过的人里有多少…"）。 */
    funnel: {
      open: fOpen, heard: fHeard, spoke: fSpoke, verified: fVerif,
      heardRate: pct(fHeard, fOpen), spokeRate: pct(fSpoke, fOpen), verifiedRate: pct(fVerif, fOpen),
      note: 'open→heard→spoke→verified；verified = 判分成功过至少一次（唯一非自述的开口证据）'
    },
    funnelReal: {
      open: fOpenReal, heard: fHeardReal, spoke: fSpokeReal, verified: fVerifReal,
      spokeRate: pct(fSpokeReal, fOpenReal), verifiedRate: pct(fVerifReal, fOpenReal),
      note: 'real = 排除 src=test 自测设备'
    },
    errors: {
      devices: errDevices, devicesReal: errDevicesReal, total: errTotal,
      deviceRate: pct(errDevices, users),
      top: Object.keys(errTop).sort((a, b) => errTop[b] - errTop[a]).slice(0, 5)
             .map((k) => ({ msg: k, devices: errTop[k] })),
      note: '设备本地计数随 stat 上云（v0.23.8）；不是实时通道，采样偏差已消除但延迟到下次上报'
    },
    // 判停线（OB §6.2）一眼对照；null 表示样本还不够，别急着下结论
    gate: {
      d7:        { target: 15, actual: d7,  pass: d7  !== null && d7  >= 15, enough: e7  > 0 },
      northStar: { target: 10, actual: ppu, pass: ppu >= 10,                enough: users > 0 },
      firstDay:  { target: 60, actual: fdr, pass: fdr !== null && fdr >= 60, enough: e1  > 0 },
      tone:      { target: 40, actual: tur, pass: tur !== null && tur >= 40, enough: users > 0 }
    }
  };
}


/* ===== v0.14.7 诺诺自由对话（LLM「大脑」）=====
   主用 GLM-4-Flash（智谱，永久免费 · 30 并发 · 128K，环境变量 GLM_KEY），
   兜底 Workers AI @cf/qwen/qwen2.5-7b-instruct（env.AI 绑定，零密钥），
   再兜底温柔降级文案。状态权归端上（前端 S.nonoChat 存最近 12 轮），模型侧无状态。 */
const GLM_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const CHAT_SYSTEM = '你是“诺诺”，一只教外国初学者说中文的熊猫。请用简单、口语化的简体中文回复，每轮1-3句。不要写英文解释，不要纠正对方语法（除非对方主动问）。每轮结尾抛一个开放式的简单问题，鼓励对方用中文回答。语气像朋友聊天，自然友好。';
const COACH_SYSTEM = '你是“诺诺”，一只教外国初学者说中文的熊猫口语教练。用户刚跟读了一句中文，你会看到他的评分数据。请用诺诺鼓励、朋友的口吻，给一句不超过 30 字的中文为主简短点评：指出他最该改进的那一个点（声调、声母、流利度或完整度），并给一句具体小建议。可以夹 1-2 个英文关键词（如 tone、rhythm）。不要抛开放式问题，不要写长篇解释。';
/* ===== v0.23.17 DRILL_SYSTEM (AI 复习出题) ===== */
const DRILL_SYSTEM = '你是"诺诺"，一只教外国初学者说中文的熊猫出题教练。用户在某方面有发音弱点（如三声、声母、流利度）。请基于这个弱点，造一句超简单、日常、不超过 8 个字的中文练习句，让 ta 开口练这个弱点。格式严格为：中文句子 | English translation。不要解释，不要多余标点。例：你好吗 | How are you';
/* ===== v0.23.17 DRILL_SYSTEM (AI 复习出题) ===== */

/* ===== v0.23.18 大模型渗透场景 3/4/5/6 四模式 + L4 聚合（AI 渗透收口） ===== */
/* 复用现有 GLM-4-Flash 链（chatGLM 仅按 mode 切换系统提示），零服务端重构。 */
const SCENE_SYSTEM = '你是"诺诺"，一只教外国初学者说中文的熊猫。用户在情景对话里刚说了一句中文。请扮演情景里的本地人，用一句自然、简短的日常中文接着聊天回应（像真人接话），可以附一句英文提示。不要教学、不要纠正，只要自然接话。如果用户有发音弱项，可以自然地带一句小提醒。';
const DAILY_SYSTEM = '你是"诺诺"，一只教外国初学者说中文的熊猫。请基于用户的中文学习情况，造一句超简单、日常、不超过 10 字的中文练习句，让他今天开口练。格式严格：中文句子 | English translation。不要解释。例：今天天气真好 | The weather is nice today';
const CARD_SYSTEM = '你是"诺诺"，中文老师。用户收藏了一个汉字。请给一个帮他记住这个字的记忆锚点（谐音 / 画面 / 例句），并辨析一个易混字。格式严格：记忆锚点 | 易混字辨析。中文为主，简短。';
const TONE_SYSTEM = '你是"诺诺"，中文老师。用户刚在声调训练里听错了声调。请用一句人话（中文为主，不超过 40 字）解释为什么是这个声调、怎么听怎么读，并给一个含该声调的例词。不要列规则条文。';
/* ===== v0.23.19 自适应日计划（B1）=====
   输入用户全量学习状态摘要，输出今日练习清单（≤3 条、末条必为开口说）。
   沿用免费 GLM-4-Flash 链，零服务端重构，仅新增一个 mode 分支。 */
const PLAN_SYSTEM = '你是"诺诺"，一只教外国初学者说中文的熊猫学习规划师。用户会给你他的学习状态（已学天数、已练句数、连续天数、发音弱点）。请基于状态生成今天的练习计划：最多 3 条，每条一句中文具体行动（如"再练一遍三声词：你好吗"），最后一条必须是开口说的任务。不要解释，用换行分隔每条，每条以 • 开头。';

const CHAT_MAX = 20; // 聊天专属限流：每 IP 60s 窗口最多 20 次（叠加在全局 40 之上）

// 聊天专属限流（复用全局 RATE_MAP 兜底 + env.RL DO 强一致计数，独立 key 前缀 chat:）
async function chatRateOk(ip, env) {
  const now = Date.now();
  if (env && env.RL) {
    try {
      const id = env.RL.idFromName('chat:' + ip);
      const stub = env.RL.get(id);
      const res = await stub.fetch('https://do/hit?max=' + CHAT_MAX + '&window=' + RATE_WINDOW);
      if (res.ok) {
        const r = await res.json();
        return !!r.allowed;
      }
    } catch (e) { /* DO 失败 → 落 Map 兜底 */ }
  }
  if (RATE_MAP.size > 2000) {
    for (const [k, v] of RATE_MAP) if (now - v.ts > RATE_WINDOW) RATE_MAP.delete(k);
  }
  const e = RATE_MAP.get('chat:' + ip);
  if (!e || now - e.ts > RATE_WINDOW) { RATE_MAP.set('chat:' + ip, { ts: now, count: 1 }); return true; }
  e.count++;
  return e.count <= CHAT_MAX;
}

async function chatGLM(userText, hist, env, mode) {
  const sysPrompt = (mode === 'coach') ? COACH_SYSTEM
    : (mode === 'drill') ? DRILL_SYSTEM
    : (mode === 'scene') ? SCENE_SYSTEM
    : (mode === 'daily') ? DAILY_SYSTEM
    : (mode === 'card') ? CARD_SYSTEM
    : (mode === 'tone') ? TONE_SYSTEM
    : (mode === 'plan') ? PLAN_SYSTEM
    : CHAT_SYSTEM;
  const messages = [{ role: 'system', content: sysPrompt }];
  (hist || []).forEach(function (h) {
    if (h && h.t) messages.push({ role: h.r === 'assistant' ? 'assistant' : 'user', content: h.t });
  });
  messages.push({ role: 'user', content: userText });

  // L1：GLM-4-Flash（智谱，环境变量 GLM_KEY）
  let glmErr = '';
  try {
    const r = await fetch(GLM_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (env.GLM_KEY || ''),
      },
      body: JSON.stringify({ model: 'glm-4-flash', messages: messages, temperature: 0.8, top_p: 0.9, max_tokens: 200 }),
    });
    if (r.ok) {
      const d = await r.json().catch(function () { return null; });
      const t = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
      if (t) return { text: t, model: 'glm-4-flash', degraded: false };
      glmErr = 'glm-empty-body';
    } else {
      glmErr = 'glm-http' + r.status;
    }
  } catch (e) { glmErr = 'glm-exc:' + String((e && e.message) || e); }

  // L2：Workers AI（env.AI 绑定，零密钥）——按可用性依次尝试多个模型，兼容多种返回结构
  let aiErr = '';
  const AI_MODELS = ['@cf/qwen/qwen2.5-7b-instruct', '@cf/qwen/qwen1.5-7b-chat', '@cf/meta/llama-3-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.2'];
  for (const m of AI_MODELS) {
    try {
      const r = await env.AI.run(m, { messages: messages, max_tokens: 200 });
      const t = (
        (r && r.response) ||
        (r && r.result && r.result.response) ||
        (r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) ||
        (r && r.text) || ''
      ).trim();
      if (t) return { text: t, model: 'workers-ai:' + m, degraded: false };
      aiErr = 'ai-empty@' + m + ':' + JSON.stringify(r).slice(0, 100);
    } catch (e) { aiErr = 'ai-exc@' + m + ':' + String((e && e.message) || e); }
  }

  // L3：两层都挂 → 温柔降级 + 记录原因（看板 model 字段可观测）
  console.log('[CHAT] degraded -> glm:' + glmErr + ' | ai:' + aiErr);
  return { text: '诺诺有点累了，待会再聊 😴', model: 'degraded:' + glmErr + '|' + aiErr, degraded: true };
}

// 聊天埋点（寄生写入 KV FEEDBACK，key 前缀 chat: 已被 feedback 读端点跳过，不污染看板）
async function recordChatStat(env, uid, reply) {
  if (!env.FEEDBACK) return;
  try {
    const rec = {
      t: new Date().toISOString(),
      type: 'chat',
      uid: String(uid || '').slice(0, 40),
      model: reply.model || '',
      degraded: !!reply.degraded,
      chars: (reply.text || '').length,
      ts: Date.now(),
    };
    const key = 'chat:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    await env.FEEDBACK.put(key, JSON.stringify(rec));
  } catch (e) { /* 统计失败不影响回复 */ }
}
/* v0.23.18 L4 聚合：遍历 p:<uid> 全量镜像，统计 AI 效果与留存。
   p: 存的是完整 S（含 aiFunnel / aiWeak / days），与 s: 派生统计分开。
   只读数，零新增写；游标分页 + 上限保护，避免大库遍历打爆。 */
async function aggregateAiEffect(env) {
  const DAY = 86400000;
  let cursor = null, scanned = 0, devs = 0, returned = 0, hit = 0, loop = 0, weak = 0, aiUsers = 0;
  const CAP = 2000;
  do {
    const opts = { prefix: 'p:' };
    if (cursor) opts.cursor = cursor;
    let list;
    try { list = await env.PROFILES.list(opts); } catch (e) { break; }
    for (const k of (list.keys || [])) {
      scanned++;
      try {
        const raw = await env.PROFILES.get(k.name);
        if (!raw) continue;
        const s = JSON.parse(raw);
        devs++;
        const days = Array.isArray(s.days) ? s.days : [];
        if (days.length >= 2) {
          const sorted = days.slice().sort();
          const span = (new Date(sorted[sorted.length - 1]) - new Date(sorted[0])) / DAY;
          if (span >= 1) returned++;
        }
        const af = s.aiFunnel || {};
        const h = Number(af.hit) || 0, l = Number(af.loop) || 0;
        hit += h; loop += l; if (h > 0) aiUsers++;
        const dims = (s.aiWeak && s.aiWeak.dims) || {};
        for (const kk in dims) weak += (Number(dims[kk]) || 0);
      } catch (e) { /* 坏记录跳过 */ }
      if (scanned >= CAP) break;
    }
    cursor = (list && list.list_complete) ? null : (list && list.cursor ? list.cursor : null);
  } while (cursor && scanned < CAP);
  return {
    ok: true, devs, returned, d1Rate: devs ? Math.round(100 * returned / devs) : 0,
    aiUsers, hit, loop, loopRate: hit ? Math.round(100 * loop / hit) : 0,
    weak, scanned
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-target',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { 'Content-Type': 'application/json', ...cors },
    });

    // v0.3.23 安全加固：所有 /api/* 写/计费端点先过 guard（Origin + 速率限制）
    const blocked = await guardApi(req, url, json, env);
    if (blocked) return blocked;

    // v0.14.4：勋章/进度后端（同源 /api/badges /api/users/*）
    const badgeRes = await handleBadgeApi(req, url, env, json);
    if (badgeRes) return badgeRes;

    /* /api/tts：中文语音合成，服务端多源串行兜底。
       为什么必须服务端多源：
       - 用户浏览器在国内，Google translate_tts 直连不可达（502）；
         但 Worker 在境外，可以访问 Google —— 这是关键洞察。
       - melotts 免费层间歇返回 3043 Internal server error（实测约半数）。
       - 有道 dictvoice 偶发返回 120 字节的 500 JSON（约 30% 概率）。
       三个源都不稳，但串行兜底后综合成功率约 97%。
       用 GET 而非 POST：文本→音频是确定性映射，浏览器可缓存，
       同一句第二次点播直接命中本地缓存（零延迟、零失败）。
       响应头 X-TTS-Source 标明是哪个源成功的，便于线上排障。 */
    if (url.pathname === '/api/tts' && (req.method === 'GET' || req.method === 'POST')) {
      try {
        let text = '';
        let voiceParam = '';
        let engineParam = '';
        let instructParam = '';
        if (req.method === 'GET') {
          text = url.searchParams.get('text') || '';
          voiceParam = url.searchParams.get('voice') || '';
          engineParam = url.searchParams.get('engine') || '';
          instructParam = url.searchParams.get('instruct') || '';
        } else {
          const b = await req.json().catch(() => ({}));
          text = b.text || '';
          voiceParam = b.voice || '';
          engineParam = b.engine || '';
          instructParam = b.instruct || '';
        }
        text = String(text).trim().slice(0, 300);
        if (!text) return json({ ok: false, error: 'text required' }, 400);

        /* Google translate_tts：境外可达、中文发音标准、mp3 体积小。
           client=tw-ob 是免鉴权的公开客户端（Google 翻译播放按钮同款）。 */
        const google = async () => {
          const r = await fetch(
            'https://translate.google.com/translate_tts?ie=UTF-8&q=' +
            encodeURIComponent(text) + '&tl=zh-CN&client=tw-ob',
            { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
          );
          if (!r.ok) return null;
          const b = await r.arrayBuffer();
          return b.byteLength > 1000 ? { body: b, type: 'audio/mpeg', src: 'google' } : null;
        };

        /* melotts（Cloudflare Workers AI）：只接受 prompt，
           传 lang 参数会 3043。中文支持正常，但间歇性失败，故重试 2 次。 */
        const melo = async (tries) => {
          for (let i = 0; i < tries; i++) {
            try {
              const r = await env.AI.run('@cf/myshell-ai/melotts', { prompt: text });
              if (r && r.audio) {
                const bin = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
                if (bin.length > 1000) return { body: bin, type: 'audio/wav', src: 'melotts' };
              }
            } catch (e) { /* 3043 等，继续重试 */ }
          }
          return null;
        };

        /* 有道 dictvoice：中文发音质量好，但偶发返回 500 JSON。
           Worker 侧访问是最后一档兜底（前端已优先直连过有道）。 */
        const youdao = async () => {
          const r = await fetch(
            'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&le=zh'
          );
          if (!r.ok) return null;
          const b = await r.arrayBuffer();
          return b.byteLength > 1000 ? { body: b, type: 'audio/mpeg', src: 'youdao' } : null;
        };

        // 音源顺序（v0.3.29）：engine=cosy 先走 Qwen3-TTS-Instruct 自然语言情绪语音（开心/严肃/温柔），失败回退 Edge；
        // 否则默认 Edge 主音源（微软神经网络，零成本），再整段回退 google/melo/youdao
        let out = null;
        if (engineParam === 'cosy') {
          try { out = await cosyTts(text, voiceParam, instructParam); } catch (e) { out = null; }
        }
        if (!out) { try { out = await edgeTts(text, voiceParam); } catch (e) { out = null; } }
        if (!out) out = await google();
        if (!out) out = await melo(3);
        if (!out) out = await youdao();
        if (!out) return json({ ok: false, error: 'all tts sources failed' }, 502);

        return new Response(out.body, {
          headers: {
            'Content-Type': out.type,
            // 音源会随兜底链切换（edge/google/melo/youdao），禁止长缓存，否则用户听不到切换
            'Cache-Control': 'no-store',
            'X-TTS-Source': out.src,
            ...cors,
          },
        });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) }, 500);
      }
    }

    if (url.pathname === '/api/asr' && req.method === 'POST') {
      try {
        /* target 从 query string 读 —— fetch headers 必须是 ISO-8859-1（纯 ASCII），
           之前用 header 传中文 target 会直接抛 "non ISO-8859-1 code point"，
           客户端 catch 吞错显示"Did not catch that"，bug 隐藏了几个月。
           同时保留 header 兼容旧调用方式（decodeURIComponent 安全）。 */
        const target = decodeURIComponent(
          url.searchParams.get('target') ||
          req.headers.get('x-target') || ''
        );
        const buf = await req.arrayBuffer();
        if (!buf || buf.byteLength < 100) return json({ ok: false, error: 'no audio' }, 400);
        // whisper-large-v3-turbo：audio = base64 字符串（官方教程用法，比旧版 whisper 更快更准）
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: btoa(binary) });
        const text = String((r && (r.text || r.transcription)) || '').trim();
        const tClean = target.replace(/\s/g, '');
        const hit = !!(tClean && text && text.replace(/\s/g, '').includes(tClean));
        return json({ ok: true, text, hit, target });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message || e) }, 500);
      }
    }

    /* 读取反馈（康哥查看用）：/api/feedback?token=<FEEDBACK_TOKEN>
       token 走环境变量，不硬编码进代码（仓库是公开的）。
       未配置该环境变量时端点直接禁用 —— 安全默认，宁可看不到也不能被公开读。 */
    if (url.pathname === '/api/feedback' && req.method === 'GET') {
      const want = env.FEEDBACK_TOKEN;
      if (!want) return json({ ok: false, error: 'read endpoint disabled (no FEEDBACK_TOKEN configured)' }, 404);
      if (url.searchParams.get('token') !== want) return json({ ok: false, error: 'forbidden' }, 403);
      if (!env.FEEDBACK) return json({ ok: false, error: 'no KV binding' }, 500);
      try {
        const list = await env.FEEDBACK.list({ limit: 200 });
        const items = [];
        for (const k of list.keys) {
          if (k.name.startsWith('rl:')) continue; // 跳过速率限制计数器，不污染反馈视图
          if (k.name.startsWith('chat:')) continue; // 跳过诺诺聊天埋点，不污染反馈视图
          const v = await env.FEEDBACK.get(k.name);
          if (v) { try { items.push(JSON.parse(v)); } catch (e) { items.push({ raw: v }); } }
        }
        items.sort((a, b) => String(b.t || '').localeCompare(String(a.t || '')));
        return json({ ok: true, count: items.length, items });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) }, 500);
      }
    }

    /* /api/feedback：真实用户反馈（v0.3.8，6 个老外在用了）。
       老外遇到 bug 不会主动联系，只会默默关掉 —— 必须给一个零门槛入口。
       存进 KV（binding=FEEDBACK）。
       康哥查看：/api/feedback?token=<FEEDBACK_TOKEN>
       或 Dashboard → Workers & Pages → KV → FEEDBACK namespace 浏览。
       附带设备信息 + 最近 JS 错误，避免"不好用"这种无法行动的反馈。 */
    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      try {
        const body = await req.json();
        const msg = String((body && body.message) || '').trim().slice(0, 2000);
        if (!msg) return json({ ok: false, error: 'message required' }, 400);
        const rec = {
          t: new Date().toISOString(),
          msg,
          cat: String((body && body.cat) || 'other').slice(0, 40),
          v: String((body && body.v) || '').slice(0, 20),
          ua: String(req.headers.get('user-agent') || '').slice(0, 300),
          lang: String(req.headers.get('accept-language') || '').slice(0, 100),
          country: req.cf ? String(req.cf.country || '') : '',
          errs: Array.isArray(body && body.errs) ? body.errs.slice(-10) : [],
        };
        const key = 'fb:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
        if (env.FEEDBACK) {
          await env.FEEDBACK.put(key, JSON.stringify(rec));
          /* 写完立刻读回来验证 —— put 可能静默失败，只有回读能证明真的存住了 */
          const back = await env.FEEDBACK.get(key);
          console.log('[FEEDBACK] saved', key, 'verified=' + !!back);
          return json({ ok: true, verified: !!back, key: key });
        }
        /* KV 未绑（本地/预览环境）时兜底：只记日志，不阻塞用户 */
        console.log('[FEEDBACK] no KV binding, payload =', JSON.stringify(rec));
        return json({ ok: true, stored: false });
      } catch (e) {
        const em = String((e && e.message) || e);
        /* v0.3.69: free-tier KV daily write limit reached. Tell the user truthfully instead of a generic 500. */
        if (/KV put\(\) limit exceeded|limit exceeded for the day/i.test(em)) {
          return json({ ok: false, error: em }, 429);
        }
        return json({ ok: false, error: em }, 500);
      }
    }

    // 健康检查（含 AI binding 自检）
    if (url.pathname === '/health') {
      let ai = 'missing';
      try { ai = env.AI ? 'ok' : 'missing'; } catch (e) { /* */ }
      return json({ ok: true, service: 'sinoky-pages-worker', ai });
    }

    /* /api/score：音节级发音评分（v0.3.7 恢复，与独立 score-worker 算法一致）。
       为什么合并进 Pages Worker：独立 Worker sinoky-score.kang7108558.workers.dev
       在移动网络下访问卡死（vConsole 显示 [SCORE] → 后无响应），Pages Worker 正常。
       为什么用 esbuild bundle：Pages Worker 不支持 npm import，故把 pinyin-pro
       打成单文件 ESM（457KB / gzip 150KB）放在 vendor/ 下直接 import。

       算法：汉字 → 拼音串（pinyin-pro）→ 解析声母/韵母/调 → 加权比对
       （调 0.5 / 韵母 0.3 / 声母 0.2），能分别报出 initial / final / tone 错误。 */
    if (url.pathname === '/api/score' && req.method === 'POST') {
      try {
        const { target, user } = await req.json();
        if (!target || !user) return json({ error: 'need target and user' }, 400);

        /* 动态加载 pinyin-pro（不能在顶层静态 import，见 ensurePinyin 注释） */
        const py = await ensurePinyin();
        const result = scoreSyllables(String(target), String(user), py);
        return json(result);
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }


    /* v0.14.7 诺诺自由对话后端：/api/chat
      主用 GLM-4-Flash（智谱 GLM_KEY），兜底 Workers AI Qwen2.5-7B（env.AI，零密钥），
      再兜底温柔降级文案。状态权归端上（前端 S.nonoChat 存最近 12 轮），模型侧无状态。
      自动继承 guardApi（Origin + 全局 40/60s 限流），此处再叠加聊天专属 20/60s/UID 限流。 */
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      try {
        const { text, uid, hist, mode } = await req.json();
        if (!text || !String(text).trim()) return json({ ok: false, error: 'empty text' }, 400);
        if (!chatRateOk(clientIp(req), env)) {
          return json({ ok: false, error: 'rate limited', degraded: true, reply: '诺诺有点忙，稍等一下再聊～' }, 429);
        }
        const history = Array.isArray(hist) ? hist.slice(-12) : [];
        const reply = await chatGLM(String(text).trim(), history, env, mode);
        try { await recordChatStat(env, uid, reply); } catch (e) { /* 统计失败不影响回复 */ }
        return json({ ok: true, reply: reply.text, model: reply.model, degraded: reply.degraded });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) }, 500);
      }
    }
    /* v0.3.31 M1 收口：设备账号 + 进度云端备份
       /api/register：签发/校验设备 UID（无状态，UID 即身份，不落 KV）
       /api/profile ：GET ?uid= 读云端进度；POST {uid,state} 写云端进度（KV binding=PROFILES）
       前端 saveState 异步推云端、启动拉云端合并（云端 _ts 新则覆盖），换机/清缓存可恢复，
       也为 L3 语伴互认铺路。两路由均走上方 guardApi（Origin + 每 IP 60s/40 次限流，防刷 KV）。 */
    /* ===== v0.16.0 分享归因（P0）=====
       目的：知道「分享带来了多少次打开」，用来判断分享功能到底有没有在拉新。
       隐私设计（硬约束，与隐私政策 never saved / never shared 一致）：
         - 分享码由前端随机生成 8 位，与设备 UID **无任何关联**，一次分享一个码；
         - 服务端只存「码 → 打开次数 / 主题 / 首次日期」，不存 UID、不存 IP、
           不存任何可回溯到个人的字段 → 即便 KV 泄露也反推不出是谁分享的。
       存储：PROFILES KV 前缀 shr:（与进度 p: / 统计 s: / 勋章 b: 完全分开。
             刻意用 shr: 而不是 sh:，避免与 summarizeStats 的 's:' 前缀发生任何歧义）
       写入量：一条分享链接被打开一次，写一次；叠加 guardApi 限流，量级可忽略。 */
    if (url.pathname === '/api/share' && req.method === 'POST') {
      try {
        const b = await req.json().catch(() => ({}));
        const code = String((b && b.c) || '').trim().toLowerCase();
        const theme = String((b && b.t) || '').trim().toLowerCase();
        if (!/^[a-z0-9]{4,12}$/.test(code)) return json({ ok: false, error: 'bad code' }, 400);
        if (theme && !/^[a-z]{1,12}$/.test(theme)) return json({ ok: false, error: 'bad theme' }, 400);
        if (!env.PROFILES) return json({ ok: false, error: 'profiles KV not bound' }, 200);
        const key = 'shr:' + code;
        let rec = { t: theme, n: 0, f: new Date().toISOString().slice(0, 10) };
        try {
          const raw = await env.PROFILES.get(key);
          if (raw) rec = Object.assign(rec, JSON.parse(raw));
        } catch (e) { /* 读失败按新记录计，不阻塞 */ }
        rec.n = Math.min(100000, (parseInt(rec.n, 10) || 0) + 1);
        if (theme) rec.t = theme;
        try {
          await env.PROFILES.put(key, JSON.stringify(rec), { expirationTtl: 15552000 }); /* 180 天 */
        } catch (e) {
          /* 极少数运行时不接受 options → 退回不带 options 写一次 */
          try { await env.PROFILES.put(key, JSON.stringify(rec)); } catch (e2) { /* 静默 */ }
        }
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: 'share failed' }, 200); /* 统计失败绝不影响用户 */
      }
    }

    /* GET /api/share：给看板读。返回「分享带来的打开总数 / 独立分享码数 / 按主题分布」。
       鉴权口径与 /api/stats 完全一致（STATS_TOKEN，未设置时保持开放）。 */
    if (url.pathname === '/api/share' && req.method === 'GET') {
      const wantTok = env.STATS_TOKEN || '';
      if (wantTok) {
        const gotTok = url.searchParams.get('token') || req.headers.get('x-stats-token') || '';
        if (gotTok !== wantTok) return json({ ok: false, error: 'unauthorized' }, 401);
      }
      if (!env.PROFILES) return json({ ok: false, error: 'profiles KV not bound' }, 500);
      try {
        let cursor = undefined, opens = 0, codes = 0, byTheme = {}, page = 0;
        do {
          const r = await env.PROFILES.list({ prefix: 'shr:', cursor });
          for (const k of r.keys) {
            codes++;
            try {
              const v = JSON.parse((await env.PROFILES.get(k.name)) || '{}');
              const n = parseInt(v.n, 10) || 0;
              opens += n;
              if (v.t) byTheme[v.t] = (byTheme[v.t] || 0) + n;
            } catch (e) { /* 单条坏了不影响整体 */ }
          }
          cursor = r.list_complete ? null : r.cursor;
          page++;
        } while (cursor && page < 10);
        return json({ ok: true, opens, codes, byTheme });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) }, 500);
      }
    }

    if (url.pathname === '/api/register' && req.method === 'POST') {
      try {
        const b = await req.json().catch(() => ({}));
        let uid = String((b && b.uid) || '').trim();
        // 仅接受合法既有 uid；非法或空 → 重新生成（避免脏数据写入 KV）
        const okUid = /^[a-zA-Z0-9_-]{8,64}$/.test(uid);
        if (!okUid) {
          uid = (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now() + Math.random().toString(36).slice(2));
        }
        return json({ ok: true, uid });
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) }, 500);
      }
    }

    if (url.pathname === '/api/profile') {
      if (!env.PROFILES) return json({ ok: false, error: 'profiles KV not bound' }, 500);
      if (req.method === 'GET') {
        const uid = url.searchParams.get('uid') || '';
        if (!uid) return json({ ok: false, error: 'uid required' }, 400);
        try {
          const raw = await env.PROFILES.get('p:' + uid);
          return json({ ok: true, state: raw ? JSON.parse(raw) : null });
        } catch (e) {
          return json({ ok: false, error: String((e && e.message) || e) }, 500);
        }
      }
      if (req.method === 'POST') {
        try {
          const b = await req.json().catch(() => ({}));
          const uid = String((b && b.uid) || '').trim();
          if (!uid) return json({ ok: false, error: 'uid required' }, 400);
          const state = b.state || {};
          // v0.3.39 写入节流：业务状态没变就跳过 put（KV 免费额度每天仅 1000 写，
          // 否则前端每 8s 一次同步、或 pullProfile 触发的合并，都会重复刷爆配额）。
          // 比对时剥离 _ts（合并时间戳每次都变，不算业务变化）。
          let skipPut = false;
          try {
            const prev = await env.PROFILES.get('p:' + uid);
            if (prev) {
              /* v0.3.40：比对时同时剥离 cards（前端已不再上报该字段，
             剥离它可让历史已存记录与新载荷判定为一致，避免上线瞬间全量重写一次） */
              const strip = (o) => JSON.stringify(o, (k, v) => (k === '_ts' || k === 'cards') ? undefined : v);
              if (strip(JSON.parse(prev)) === strip(state)) skipPut = true;
            }
          } catch (e) { /* 读失败则照常写，不阻塞 */ }
          if (!skipPut) {
            await env.PROFILES.put('p:' + uid, JSON.stringify(state));
          } else {
            console.log('[PROFILE] skip unchanged put for', uid);
          }
          // v0.3.33：顺带落匿名统计（寄生写入，零新增请求）；统计失败绝不影响进度保存
          try { await recordStat(env, uid, b.stat); } catch (e) { /* 忽略 */ }
          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: String((e && e.message) || e) }, 500);
        }
      }
      return json({ ok: false, error: 'method not allowed' }, 405);
    }

    /* v0.23.18 L4：GET /api/agg 聚合「AI 是否让用户多开口 / 留存」（把 L4 从不可知变为可证伪）。
       读 p:<uid> 全量镜像（含 aiFunnel / aiWeak / days），零新增写（只读 KV）。
       仅 operator 可用：必须带 ?token= 或 x-stats-token 头，且 env.STATS_TOKEN 已设；否则 403。
       前端 Progress 页不调用（避免暴露 token），聚合经 _internal/agg_kv.py 离线查证。 */
    if (url.pathname === '/api/agg' && req.method === 'GET') {
      const wantTok = env.STATS_TOKEN || '';
      if (!wantTok) return json({ ok: false, error: 'AGG disabled: set STATS_TOKEN' }, 403);
      const gotTok = url.searchParams.get('token') || req.headers.get('x-stats-token') || '';
      if (gotTok !== wantTok) return json({ ok: false, error: 'unauthorized' }, 403);
      try { const r = await aggregateAiEffect(env); return json(r, 200); }
      catch (e) { return json({ ok: false, error: String((e && e.message) || e) }, 500); }
    }

    /* v0.3.33 看板：GET /api/stats 返回聚合汇总（只有数字，无个人信息）。
       注意：走上方 guardApi（Origin + 每 IP 60s/40 次限流），避免被刷导致遍历 KV。 */
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      /* v0.3.35 热修（原 L5）：看板数据此前完全公网可读——任何人 GET /api/stats
         就能拿到内测规模、DAU、场景分布、北极星指标与 kill criteria。
         现在只要设了 secret STATS_TOKEN 就必须带 ?token= 或 x-stats-token 头。
         未设置该 secret 时保持开放（本地/预览环境不挡）。 */
      const wantTok = env.STATS_TOKEN || '';
      if (wantTok) {
        const gotTok = url.searchParams.get('token') || req.headers.get('x-stats-token') || '';
        if (gotTok !== wantTok) return json({ ok: false, error: 'unauthorized' }, 401);
      }
      if (!env.PROFILES) return json({ ok: false, error: 'profiles KV not bound' }, 500);
      try {
        return json(await summarizeStats(env));
      } catch (e) {
        return json({ ok: false, error: String((e && e.message) || e) }, 500);
      }
    }

    // 静态资源透传 + 附加 CORS 头（APK 壳内 https://localhost 跨域拉 version.json 需要）
    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers: h });
  },
};
