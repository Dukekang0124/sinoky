#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 二进制安全插入 /api/chat 后端到 _worker.js（保持 CRLF）
PATH = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app\_worker.js"

with open(PATH, "rb") as f:
    data = f.read()

# ---- 模块级 helper 函数（插入到 export default { 之前）----
HELPERS = [
    "/* ===== v0.14.7 诺诺自由对话（LLM「大脑」）=====",
    "   主用 GLM-4-Flash（智谱，永久免费 · 30 并发 · 128K，环境变量 GLM_KEY），",
    "   兜底 Workers AI @cf/qwen/qwen2.5-7b-instruct（env.AI 绑定，零密钥），",
    "   再兜底温柔降级文案。状态权归端上（前端 S.nonoChat 存最近 12 轮），模型侧无状态。 */",
    "const GLM_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';",
    "const CHAT_SYSTEM = '你是“诺诺”，一只教外国初学者说中文的熊猫。请用简单、口语化的简体中文回复，每轮1-3句。不要写英文解释，不要纠正对方语法（除非对方主动问）。每轮结尾抛一个开放式的简单问题，鼓励对方用中文回答。语气像朋友聊天，自然友好。';",
    "const CHAT_MAX = 20; // 聊天专属限流：每 IP 60s 窗口最多 20 次（叠加在全局 40 之上）",
    "",
    "// 聊天专属限流（复用全局 RATE_MAP 兜底 + env.RL DO 强一致计数，独立 key 前缀 chat:）",
    "async function chatRateOk(ip, env) {",
    "  const now = Date.now();",
    "  if (env && env.RL) {",
    "    try {",
    "      const id = env.RL.idFromName('chat:' + ip);",
    "      const stub = env.RL.get(id);",
    "      const res = await stub.fetch('https://do/hit?max=' + CHAT_MAX + '&window=' + RATE_WINDOW);",
    "      if (res.ok) {",
    "        const r = await res.json();",
    "        return !!r.allowed;",
    "      }",
    "    } catch (e) { /* DO 失败 → 落 Map 兜底 */ }",
    "  }",
    "  if (RATE_MAP.size > 2000) {",
    "    for (const [k, v] of RATE_MAP) if (now - v.ts > RATE_WINDOW) RATE_MAP.delete(k);",
    "  }",
    "  const e = RATE_MAP.get('chat:' + ip);",
    "  if (!e || now - e.ts > RATE_WINDOW) { RATE_MAP.set('chat:' + ip, { ts: now, count: 1 }); return true; }",
    "  e.count++;",
    "  return e.count <= CHAT_MAX;",
    "}",
    "",
    "async function chatGLM(userText, hist, env) {",
    "  const messages = [{ role: 'system', content: CHAT_SYSTEM }];",
    "  (hist || []).forEach(function (h) {",
    "    if (h && h.t) messages.push({ role: h.r === 'assistant' ? 'assistant' : 'user', content: h.t });",
    "  });",
    "  messages.push({ role: 'user', content: userText });",
    "  try {",
    "    const r = await fetch(GLM_CHAT_URL, {",
    "      method: 'POST',",
    "      headers: {",
    "        'Content-Type': 'application/json',",
    "        'Authorization': 'Bearer ' + (env.GLM_KEY || ''),",
    "      },",
    "      body: JSON.stringify({ model: 'glm-4-flash', messages: messages, temperature: 0.8, top_p: 0.9, max_tokens: 200 }),",
    "    });",
    "    if (r.ok) {",
    "      const d = await r.json().catch(function () { return null; });",
    "      const t = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();",
    "      if (t) return { text: t, model: 'glm-4-flash', degraded: false };",
    "    }",
    "  } catch (e) { /* GLM 失败 → 试 Workers AI */ }",
    "  try {",
    "    const r = await env.AI.run('@cf/qwen/qwen2.5-7b-instruct', { messages: messages, max_tokens: 200 });",
    "    const t = (r && (r.response || r.text || '') || '').trim();",
    "    if (t) return { text: t, model: 'workers-ai', degraded: false };",
    "  } catch (e) { /* Workers AI 失败 → 降级文案 */ }",
    "  return { text: '诺诺有点累了，待会再聊 😴', model: 'degraded', degraded: true };",
    "}",
    "",
    "// 聊天埋点（寄生写入 KV FEEDBACK，key 前缀 chat: 已被 feedback 读端点跳过，不污染看板）",
    "async function recordChatStat(env, uid, reply) {",
    "  if (!env.FEEDBACK) return;",
    "  try {",
    "    const rec = {",
    "      t: new Date().toISOString(),",
    "      type: 'chat',",
    "      uid: String(uid || '').slice(0, 40),",
    "      model: reply.model || '',",
    "      degraded: !!reply.degraded,",
    "      chars: (reply.text || '').length,",
    "      ts: Date.now(),",
    "    };",
    "    const key = 'chat:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);",
    "    await env.FEEDBACK.put(key, JSON.stringify(rec));",
    "  } catch (e) { /* 统计失败不影响回复 */ }",
    "}",
]
helpers_block = ("\r\n" + "\r\n".join(HELPERS) + "\r\n").encode("utf-8")

# ---- /api/chat 路由（插入到 /api/score 块之后、/api/register 注释之前）----
ROUTE = [
    "    /* v0.14.7 诺诺自由对话后端：/api/chat",
    "      主用 GLM-4-Flash（智谱 GLM_KEY），兜底 Workers AI Qwen2.5-7B（env.AI，零密钥），",
    "      再兜底温柔降级文案。状态权归端上（前端 S.nonoChat 存最近 12 轮），模型侧无状态。",
    "      自动继承 guardApi（Origin + 全局 40/60s 限流），此处再叠加聊天专属 20/60s/UID 限流。 */",
    "    if (url.pathname === '/api/chat' && req.method === 'POST') {",
    "      try {",
    "        const { text, uid, hist } = await req.json();",
    "        if (!text || !String(text).trim()) return json({ ok: false, error: 'empty text' }, 400);",
    "        if (!chatRateOk(clientIp(req), env)) {",
    "          return json({ ok: false, error: 'rate limited', degraded: true, reply: '诺诺有点忙，稍等一下再聊～' }, 429);",
    "        }",
    "        const history = Array.isArray(hist) ? hist.slice(-12) : [];",
    "        const reply = await chatGLM(String(text).trim(), history, env);",
    "        try { await recordChatStat(env, uid, reply); } catch (e) { /* 统计失败不影响回复 */ }",
    "        return json({ ok: true, reply: reply.text, model: reply.model, degraded: reply.degraded });",
    "      } catch (e) {",
    "        return json({ ok: false, error: String((e && e.message) || e) }, 500);",
    "      }",
    "    }",
]
route_block = ("\r\n" + "\r\n".join(ROUTE) + "\r\n").encode("utf-8")

# 锚点1：export default {
anchor1 = b"export default {"
idx1 = data.find(anchor1)
assert idx1 != -1, "anchor1 export default { not found"
assert data.find(helpers_block.strip()) == -1, "helpers already present?"
data = data[:idx1] + helpers_block + data[idx1:]

# 锚点2：/api/register 注释（/api/score 块之后）
anchor2 = "    /* v0.3.31 M1 收口：设备账号 + 进度云端备份".encode("utf-8")
idx2 = data.find(anchor2)
assert idx2 != -1, "anchor2 /api/register comment not found"
assert data.find(b"/api/chat") == -1, "/api/chat route already present?"
data = data[:idx2] + route_block + data[idx2:]

with open(PATH, "wb") as f:
    f.write(data)

print("OK: inserted helpers + /api/chat route, CRLF preserved")
print("helpers anchor idx:", idx1, "route anchor idx:", idx2)
