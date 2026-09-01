// Sinoky Pages 同源后端（advanced mode _worker.js）
// 路由：/api/asr → Whisper 中文识别（16kHz WAV 最稳）
//       /api/tts → melotts 中文语音合成（本地 speechSynthesis 无中文 voice 时兜底）
//       其他 → 静态资源（env.ASSETS）
// 注：绑 env.AI（Pages 项目 settings→bindings 已通过 CF API 配置 type=ai name=AI）
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
        const target = decodeURIComponent(req.headers.get('x-target') || '');
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

    // 健康检查（含 AI binding 自检）
    if (url.pathname === '/health') {
      let ai = 'missing';
      try { ai = env.AI ? 'ok' : 'missing'; } catch (e) { /* */ }
      return json({ ok: true, service: 'sinoky-pages-worker', ai });
    }

    // 静态资源透传 + 附加 CORS 头（APK 壳内 https://localhost 跨域拉 version.json 需要）
    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers: h });
  },
};
