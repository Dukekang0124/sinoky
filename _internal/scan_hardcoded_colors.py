# -*- coding: utf-8 -*-
"""P0 前置：全库硬编码色值盘点（按色值归类 + 判断是否在 CSS 值位）"""
import re, collections

P = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app\index.html"
H = open(P, "rb").read().decode("utf-8", "replace")

OLD = {"#e63946": "旧洋红(换肤前 --red)", "#141a24": "旧墨色(换肤前 --bg)",
       "#1b2330": "旧 --bg2", "#1e2735": "旧 --card", "#2b3648": "旧 --line", "#7fb3b0": "旧 --teal"}

cnt = collections.Counter(m.group(0).lower() for m in re.finditer(r'#[0-9a-fA-F]{6}', H))
print("=== 全库 hex 颜色盘点（Top 25）===")
for c, n in cnt.most_common(25):
    flag = "  <<< " + OLD[c] if c in OLD else ""
    print(f"  {c}  x{n}{flag}")

print("\n=== 旧值残留逐处上下文（判断是否在 CSS 值位）===")
for c, label in OLD.items():
    ms = list(re.finditer(re.escape(c), H, re.I))
    if not ms:
        continue
    print(f"\n  --- {c}  {label}  共 {len(ms)} 处 ---")
    for m in ms:
        seg = H[max(0, m.start() - 55):m.end() + 22].replace("\r\n", " ").replace("\n", " ")
        # 判断是否处于 <script> 内
        before = H[:m.start()]
        in_script = before.count("<script") > before.count("</script")
        print(f"    [{'JS' if in_script else 'CSS'}] ...{re.sub(r'\\s+', ' ', seg)}...")

print("\n=== rgba(230,57,70,*) 旧红半透明 ===")
for m in re.finditer(r'rgba\(230,\s*57,\s*70,\s*[\d.]+\)', H):
    seg = H[max(0, m.start() - 70):m.end() + 15].replace("\r\n", " ").replace("\n", " ")
    print("   ..." + re.sub(r'\\s+', ' ', seg) + "...")
print("   计数:", len(re.findall(r'rgba\(230,\s*57,\s*70,', H)))

print("\n=== meta theme-color ===")
print("  ", re.search(r'<meta name="theme-color"[^>]*>', H).group(0))
