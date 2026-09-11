# -*- coding: utf-8 -*-
"""审计 Step1b：精确复核（消除上一步模糊匹配的假阳性/假阴性）"""
import re, ssl, time, urllib.request

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
req = urllib.request.Request("https://sinoky.pages.dev/?audit2=" + str(time.time()),
                             headers={"User-Agent": "Mozilla/5.0 audit"})
H = urllib.request.urlopen(req, timeout=60, context=ctx).read().decode("utf-8", "replace")


def ctxs(pat, n=3, width=90):
    out = []
    for m in list(re.finditer(pat, H))[:n]:
        s = max(0, m.start() - width)
        out.append("..." + H[s:m.end() + width].replace("\r\n", " ").replace("\n", " ") + "...")
    return out


print("=== A. 诺诺钩子：真实调用点（含所在函数上下文）===")
for m in re.finditer(r'function\s+(\w+)\s*\([^)]*\)\s*\{', H):
    name = m.group(1)
    seg = H[m.end():m.end() + 2600]
    hits = re.findall(r"nono\w*\s*\(", seg)
    keys = re.findall(r"NONO\.\w+", seg)
    if hits or keys:
        print(f"  fn {name}(): nono 调用 {len(hits)} 次 | 状态键 {sorted(set(keys))}")

print("\n=== B. 复习钩子（连对 / 清空当日）实际实现 ===")
for pat, label in [(r'连对', '连对'), (r'清空', '清空'), (r'streak', 'streak'), (r'rvRun|rvCor|rvNext', '复习流程函数')]:
    hits = ctxs(pat, 2, 70)
    print(f"  [{len(re.findall(pat, H))} 处] {label}")
    for h in hits:
        print("      " + h)

print("\n=== C. 气泡圆角（方案：14px 圆角 + 单角 4px 尖）===")
for sel in ['.nc-b{', '.nc-msg{', '.nc-bub{']:
    m = re.search(re.escape(sel) + r'([^}]*)\}', H)
    if m:
        print(f"  {sel} {m.group(1)[:170]}")
for m in list(re.finditer(r'border-radius:1[0-9]px 1[0-9]px 1[0-9]px [0-9]px', H))[:4]:
    print("  " + H[max(0, m.start() - 60):m.end() + 10].replace("\r\n", " "))

print("\n=== D. 「龙鳞 / 跃龙门 / 辰辰」真伪核验 ===")
for w in ["龙鳞", "跃龙门", "辰辰", "化龙", "龙门"]:
    print(f"  {w}: {H.count(w)} 处")
print("  （若 0 → 三期项确实未实施）")

print("\n=== E. mascot 表情资产实际引用 ===")
print("  ", sorted(set(re.findall(r'assets/mascot/(\w+)\.webp', H))))

print("\n=== F. 是否存在任何 data-URI SVG 纹样 ===")
print("  data:image/svg+xml 出现:", H.count("data:image/svg+xml"))
print("  background-image 出现:", H.count("background-image"))
print("  回纹/祥云/角花/如意 关键词:", {w: H.count(w) for w in ["回纹", "祥云", "角花", "如意", "纹样"]})

print("\n=== G. 导航选中态实现 ===")
m = re.search(r'nav button\.on\{[^}]*\}', H)
print("  " + (m.group(0) if m else "n/a"))
print("  nav button::before/::after 规则:", bool(re.search(r'nav button[^{]*::(before|after)', H)))

print("\n=== H. 输入框与录音钮 ===")
for sel in ['input{', '.np-in{', '.nctrl-txt', '.record{', '#fb-open{']:
    m = re.search(re.escape(sel) + r'([^}]*)\}', H)
    if m:
        print(f"  {sel} {m.group(1)[:150]}")
