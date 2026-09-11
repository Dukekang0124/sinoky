# -*- coding: utf-8 -*-
"""v0.18.0 补丁 3：收尾 i18n（声调名/徽章名/计数模板）"""
import os, re, json, subprocess
APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
P = os.path.join(APP, "index.html")
H = open(P, "rb").read().decode("utf-8")
n = 0
def rep(old, new, label):
    global H, n
    c = H.count(old)
    if c == 0 and new in H: print("  -- 已应用，跳过 " + label); return
    assert c == 1, f"[{label}] 命中 {c} 次：{old[:70]!r}"
    H = H.replace(old, new); n += 1; print("  OK " + label)

rep("""'">'+(st.n>0 ? st.r+'/'+st.n+' right' : '1 sound')+'</span></div>'""",
    """'">'+(st.n>0 ? T('{r}/{n} right').replace('{r}',st.r).replace('{n}',st.n) : T('1 sound'))+'</span></div>'""",
    "听辨正确率计数模板化")
rep("""'<span class="badge">'+litN+'/'+all.length+' LIT</span></div>'""",
    """'<span class="badge">'+T('{a}/{b} LIT').replace('{a}',litN).replace('{b}',all.length)+'</span></div>'""",
    "城市点亮计数模板化")

data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open(P, "wb").write(data)
lone = data.count(b"\n") - data.count(b"\r\n")
print(f"\n改动 {n} 处 | 裸 LF = {lone}")
assert lone == 0
NODE = r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
for i, s in enumerate(re.findall(r'<script[^>]*>([\s\S]*?)</script>', data.decode("utf-8"), re.I), 1):
    f = os.path.join(APP, "_internal", f"_v18c{i}.js"); open(f, "w", encoding="utf-8").write(s)
    r = subprocess.run([NODE, "--check", f], capture_output=True, text=True)
    assert r.returncode == 0, f"script#{i}: {r.stderr[:200]}"; os.remove(f)
print("JS 语法全部通过")

ZP = os.path.join(APP, "langs", "zh.json")
Z = json.load(open(ZP, encoding="utf-8")); before = len(Z)
NEW = {
 # 声调名（TONE_LABEL）
 "1 flat": "1 声 · 平", "2 rising": "2 声 · 升", "3 dip": "3 声 · 降升", "4 fall": "4 声 · 降",
 # 徽章名（含数字，之前被过滤条件漏掉）
 "3-day streak": "连续 3 天", "7-day streak": "连续 7 天",
 "14-day streak": "连续 14 天", "100-day streak": "连续 100 天",
 "5 landmarks": "5 个地标",
 # 计数模板
 "{r}/{n} right": "{r}/{n} 正确", "{a}/{b} LIT": "已点亮 {a}/{b}",
 "1 sound": "1 个音", "1 keyword": "1 个关键词",
 "· Must include at least": "· 至少要包含",
 # 诺诺文案
 "🔥 {s}-day streak! Speak it out there.": "🔥 连续 {s} 天！大声说出来。",
 "🔥 {s} day streak · 🗣️ {a} phrases said": "🔥 连续 {s} 天 · 🗣️ 已开口 {a} 句",
}
add = 0
for k, v in NEW.items():
    if k not in Z: Z[k] = v; add += 1
json.dump(Z, open(ZP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"zh.json {before} \u2192 {len(Z)}（新增 {add}）")
