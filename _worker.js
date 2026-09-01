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
      perSyll.push({ target: t || '—', user: u || '—', score: 0, errs: ['missing syllable'] });
      continue;
    }
    const r = cmp(parsePy(t), parsePy(u));
    total += r.score;
    perSyll.push({ target: t, user: u, score: r.score, errs: r.errs });
  }
  const overall = n ? Math.round((total / n) * 100) : 0;
  // verdict 必须英文 —— 目标用户是不懂中文的外国学习者，中文输出即缺陷
  const verdict = overall >= 85 ? 'Great ✅' : overall >= 70 ? 'Pass ⚠️' : 'Retry ❌';
  return { overall, verdict, perSyll, n };
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
        if (req.method === 'GET') text = url.searchParams.get('text') || '';
        else { const b = await req.json().catch(() => ({})); text = b.text || ''; }
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

        let out = await google();
        if (!out) out = await melo(3);
        if (!out) out = await youdao();
        if (!out) return json({ ok: false, error: 'all tts sources failed' }, 502);

        return new Response(out.body, {
          headers: {
            'Content-Type': out.type,
            'Cache-Control': 'public, max-age=31536000, immutable',
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
        return json({ ok: false, error: String((e && e.message) || e) }, 500);
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

    // 静态资源透传 + 附加 CORS 头（APK 壳内 https://localhost 跨域拉 version.json 需要）
    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers: h });
  },
};
