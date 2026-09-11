# -*- coding: utf-8 -*-
"""v0.16.0 分享弹层打磨（第五补丁）
目视验收（弹层实拍）发现：
  P7 弹层内容超出屏高被裁 —— 卡片预览 324px 太大 + 说明文案两行
  P8 新弹层漏了关闭按钮（旧版有 Cancel；只剩「点遮罩关闭」这一条路，移动端不友好）
  P9 城巿卡英文与统计行过紧；连续卡「DAYS IN A ROW」贴住龙鳞
"""
import os, re, json, subprocess

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)
P = "index.html"
H = open(P, "rb").read().decode("utf-8")
assert H.count("\n") - H.count("\r\n") == 0
def crlf(s): return s.replace("\n", "\r\n")
def rep(old, new, n=1):
    global H
    o, w = crlf(old), crlf(new)
    c = H.count(o); assert c == n, f"命中 {c} 次（期望 {n}）：{old[:70]!r}"
    H = H.replace(o, w)

# P7-a 预览缩小
rep("#share-panel .sp-prev img{ width:100%; max-width:324px; display:block; }",
    "#share-panel .sp-prev img{ width:100%; max-width:276px; display:block; }")
# P8-a 关闭按钮样式
rep("""#share-panel .sp-h{ font-family:"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",serif;
  font-size:17px; font-weight:600; margin:0 0 4px; }""",
    """#share-panel .sp-head{ display:flex; align-items:center; justify-content:space-between; margin:0 0 4px; }
#share-panel .sp-h{ font-family:"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",serif;
  font-size:17px; font-weight:600; margin:0; }
#share-panel .sp-x{ background:transparent; border:1px solid transparent; color:var(--sub);
  font-size:15px; line-height:1; padding:6px 10px; cursor:pointer; border-radius:99px; }
#share-panel .sp-x:hover{ border-color:rgba(201,168,108,.4); }""")

# P7-b + P8-b 面板模板：加关闭按钮、说明文案砍到一行
rep(""".PANEL = ''
 + '<div class="sp-h">Share this card</div>'
 + '<div class="sp-sub">This is exactly what your friends will see. '
 + 'Chinese characters, pinyin and English \\u2014 so anyone can read it.</div>'""".replace(".PANEL", "SHARE.PANEL"),
    """.PANEL = ''
 + '<div class="sp-head"><div class="sp-h">Share this card</div>'
 + '<button class="sp-x" onclick="closeShare()" aria-label="Close">&#10005;</button></div>'
 + '<div class="sp-sub">Exactly what your friends will see.</div>'""".replace(".PANEL", "SHARE.PANEL"))

# P9-a 城巿卡：英文与统计行之间补呼吸
rep("      if (d.city.line.en) push({ t:d.city.line.en, size:_fit(ctx, d.city.line.en, maxW, 32, 22, SHARE.SANS), font:SHARE.SANS, color:'rgba(245,241,232,.62)', gap:30 });",
    "      if (d.city.line.en) push({ t:d.city.line.en, size:_fit(ctx, d.city.line.en, maxW, 32, 22, SHARE.SANS), font:SHARE.SANS, color:'rgba(245,241,232,.62)', gap:54 });")
# P9-b 连续卡：DAYS IN A ROW 与龙鳞拉开 + 整块上移一点
rep("    push({ t:'DAYS IN A ROW', size:34, font:SHARE.SANS, weight:'600', color:'rgba(245,241,232,.62)', gap:0 });\n    var yEnd = _stack(ctx, cx, items, 176, 620);",
    "    push({ t:'DAYS IN A ROW', size:34, font:SHARE.SANS, weight:'600', color:'rgba(245,241,232,.62)', gap:16 });\n    var yEnd = _stack(ctx, cx, items, 176, 592);")

data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open(P, "wb").write(data)
H2 = data.decode("utf-8")
lone = data.count(b"\n") - data.count(b"\r\n")
print("裸 LF:", lone); assert lone == 0
assert H2.count('class="sp-x"') == 1 and H2.count("closeShare()") >= 3

scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', H2, re.I)
open("_internal/_s3.js", "w", encoding="utf-8").write(scripts[-1])
r = subprocess.run([r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe", "--check", "_internal/_s3.js"],
                   capture_output=True, text=True)
print("模块语法 rc:", r.returncode, (r.stderr or "")[:200].strip())
os.remove("_internal/_s3.js")
assert r.returncode == 0

# 字典：补新文案
ZP = "langs/zh.json"
Z = json.load(open(ZP, encoding="utf-8"))
Z["Exactly what your friends will see."] = "朋友收到看到的就是这个。"
Z["Close"] = "关闭"
json.dump(Z, open(ZP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("zh.json 键数:", len(Z))
print("完成")
