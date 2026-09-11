# -*- coding: utf-8 -*-
"""v0.16.0 分享功能 P0 —— 第二补丁：归因端点（_worker.js）+ i18n 字典 + 即时翻译"""
import os, re, json, subprocess, sys

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)

# ============================================================
# 1) _worker.js：新增 /api/share（POST 计数 / GET 读看板）
# ============================================================
WK = "_worker.js"
W = open(WK, "rb").read().decode("utf-8")
assert "shr:" not in W, "已注入过，中止"

ANCHOR = "    if (url.pathname === '/api/register' && req.method === 'POST') {"
assert W.count(ANCHOR) == 1, "锚点未唯一命中"

ROUTES = """    /* ===== v0.16.0 分享归因（P0）=====
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

"""
W = W.replace(ANCHOR, ROUTES + ANCHOR)
open(WK, "wb").write(W.encode("utf-8"))
print("_worker.js 已注入 /api/share；长度", len(W))

# 语法校验（_worker.js 是 ESM，必须用 .mjs 检查）
tmp = "_internal/_wk.mjs"
open(tmp, "w", encoding="utf-8").write(W)
r = subprocess.run([r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe", "--check", tmp],
                   capture_output=True, text=True)
print("worker 语法 rc:", r.returncode, (r.stderr or "")[:300].strip())
os.remove(tmp)
assert r.returncode == 0, "worker 语法错误"
assert W.count("'/api/share'") == 2
assert W.count("shr:") >= 3

# ============================================================
# 2) index.html：让主题名即时跟随语言
# ============================================================
H = open("index.html", "rb").read().decode("utf-8")
old = "  var tn = $('sp-tname'); if (tn) tn.textContent = SHARE.TNAME[SHARE.theme] || '';"
new = ("  var tn = $('sp-tname');\r\n"
       "  if (tn){ tn.textContent = SHARE.TNAME[SHARE.theme] || ''; try{ if (typeof applyI18n === 'function') applyI18n(tn); }catch(e){} }")
assert H.count(old) == 1, f"tname 行未唯一命中 ({H.count(old)})"
H = H.replace(old, new)
data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open("index.html", "wb").write(data)
print("index.html 即时翻译已加；裸 LF:", data.count(b"\n") - data.count(b"\r\n"))
assert data.count(b"\n") - data.count(b"\r\n") == 0

# ============================================================
# 3) langs/zh.json：新增分享模块文案（英文原文 = key）
# ============================================================
NEW = {
  "Share this card": "分享这张卡片",
  "This is exactly what your friends will see. Chinese characters, pinyin and English \u2014 so anyone can read it.":
    "朋友收到看到的就是这个。汉字、拼音、英文三行齐备——谁都能读懂。",
  "Shuffle": "换一个",
  "Your name (optional)": "你的名字（可不填）",
  "Share\u2026": "分享到\u2026",
  "Save image": "保存图片",
  "Copy text + link": "复制文案 + 链接",
  "Share this": "分享这张卡",
  "Share my progress": "分享我的进度",
  "Share this card": "分享这张卡片",
  "No account, no recording, no device ID on this card \u2014 just the Chinese you actually said.":
    "卡片上没有账号、没有录音、也没有设备号——只有你真正说出口的那句中文。",
  "Opened inside WeChat \u2014 press and hold the card above to save it, or use \u201cCopy text + link\u201d.":
    "在微信里打开——长按上面的卡片即可保存，或点「复制文案 + 链接」。",
  "Your browser can\u2019t open the system share sheet \u2014 save the image instead.":
    "当前浏览器无法调起系统分享——请用「保存图片」。",
  "Image saved": "图片已保存",
  "Could not build the image \u2014 try Share or Copy instead": "图片生成失败——可以改用分享或复制",
  "Long-press the card above to save it": "长按上面的卡片即可保存",
  "Copied \u2014 paste it anywhere": "已复制——粘到哪里都行",
  "Just started": "刚起步",
  "This line I said": "我说出口的这一句",
  "My streak": "我的连续天数",
  "City unlocked": "解锁了一座城",
  "New badge": "新徽章"
}
ZP = "langs/zh.json"
Z = json.load(open(ZP, encoding="utf-8"))
before = len(Z)
added = 0
for k, v in NEW.items():
    if k not in Z:
        Z[k] = v
        added += 1
json.dump(Z, open(ZP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"zh.json: {before} -> {len(Z)} 键（新增 {added}）")
assert len(Z) >= before + 15, "新增键数异常"

# ============================================================
# 4) 抽查：页面里新出现的英文串是否都在字典或有解释
# ============================================================
H2 = open("index.html", "rb").read().decode("utf-8")
i = H2.find('id="cn-share-mod"')
mod = H2[i:H2.find("</script>", i)]
Z2 = json.load(open(ZP, encoding="utf-8"))
print("\n=== 我的模块里新增的可翻译串对照 ===")
for s in ['Share this card', 'Share\u2026', 'Save image', 'Copy text + link',
          'Share my progress', 'Just started', 'This line I said', 'My streak',
          'City unlocked', 'New badge', 'Shuffle', 'Image saved']:
    print(("  OK  " if s in Z2 else "  MISS") + "  " + s)
print("\n完成")
