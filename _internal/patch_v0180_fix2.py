# -*- coding: utf-8 -*-
"""v0.18.0 补丁 2：模板化剩余拼接串 + 补漏译（幂等：已应用则跳过）"""
import os, re, json, subprocess

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
P = os.path.join(APP, "index.html")
H = open(P, "rb").read().decode("utf-8")
n = 0

def rep(old, new, label):
    global H, n
    c = H.count(old)
    if c == 0 and new in H:
        print("  -- 已应用，跳过 " + label); return
    assert c == 1, f"[{label}] 命中 {c} 次：{old[:70]!r}"
    H = H.replace(old, new); n += 1
    print("  OK " + label)

rep("if(cnt) cnt.textContent = q.length + ' due';",
    "if(cnt) cnt.textContent = T('{n} due').replace('{n}', q.length);",
    "复习页计数徽章模板化")

for mode, pct in (("random_recall", 60), ("role_reversal", 70), ("speed_run", 80)):
    old = "<i>'+(byMode." + mode + "||0)+' due \u00b7 " + str(pct) + "%</i>"
    new = ("<i>'+T('{n} due \u00b7 {p}%').replace('{n}',(byMode." + mode
           + "||0)).replace('{p}'," + str(pct) + ")+'</i>")
    rep(old, new, mode + " 计数模板化")

rep("textContent = 'Pinyin: ' + (rdShowPy ? 'on' : 'off');",
    "textContent = T(rdShowPy ? 'Pinyin: on' : 'Pinyin: off');",
    "字卡 Pinyin 开关模板化")

data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open(P, "wb").write(data)
lone = data.count(b"\n") - data.count(b"\r\n")
print(f"\n改动 {n} 处 | 裸 LF = {lone}")
assert lone == 0

NODE = r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
for i, s in enumerate(re.findall(r'<script[^>]*>([\s\S]*?)</script>', data.decode("utf-8"), re.I), 1):
    f = os.path.join(APP, "_internal", f"_v18b{i}.js")
    open(f, "w", encoding="utf-8").write(s)
    r = subprocess.run([NODE, "--check", f], capture_output=True, text=True)
    assert r.returncode == 0, f"script#{i}: {r.stderr[:200]}"
    os.remove(f)
print("JS 语法全部通过")

ZP = os.path.join(APP, "langs", "zh.json")
Z = json.load(open(ZP, encoding="utf-8"))
before = len(Z)
NEW = {
 "110 police \u00b7 119 fire \u00b7 120 ambulance \u2014 and how to say them so they understand.":
   "110 报警 \u00b7 119 火警 \u00b7 120 急救\u2014\u2014以及怎么说对方才听得明白。",
 "{n} due \u00b7 {p}%": "{n} 条待复习 \u00b7 {p}%",
 "Pinyin: on": "拼音：开",
 "Pinyin: off": "拼音：关",
 "Segmentation failed:": "分词失败：",
 "Segmentation failed: ": "分词失败：",
 "keep the app in the foreground": "让应用保持在前台",
}
add = 0
for k, v in NEW.items():
    if k not in Z: Z[k] = v; add += 1
json.dump(Z, open(ZP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"zh.json {before} \u2192 {len(Z)}（新增 {add}）")
