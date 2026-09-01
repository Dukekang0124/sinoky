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

    if (url.pathname === '/api/tts' && req.method === 'POST') {
      try {
        const { text } = await req.json();
        if (!text) return json({ ok: false, error: 'text required' }, 400);
        // 注意：melotts 只接受 prompt（传 lang 会 3043 内部错误），自动按文本语言发音，输出 WAV
        const r = await env.AI.run('@cf/myshell-ai/melotts', { prompt: String(text).slice(0, 300) });
        if (!r || !r.audio) return json({ ok: false, error: 'tts failed' }, 502);
        const bin = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
        return new Response(bin, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=86400', ...cors } });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message || e) }, 500);
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
