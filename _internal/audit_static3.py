# -*- coding: utf-8 -*-
"""审计 Step1c：花括号配对精确归属 + 关键 CSS 精查"""
import re, ssl, time, urllib.request

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
H = urllib.request.urlopen(urllib.request.Request(
    "https://sinoky.pages.dev/?audit3=" + str(time.time()),
    headers={"User-Agent": "Mozilla/5.0 audit"}), timeout=60, context=ctx).read().decode("utf-8", "replace")


def funcs_with(call_re):
    """返回真正调用了 call_re 的函数名（花括号配对界定函数体）"""
    res = {}
    for m in re.finditer(r'function\s+(\w+)\s*\([^)]*\)\s*\{', H):
        name, i, depth = m.group(1), m.end() - 1, 0
        while i < len(H):
            c = H[i]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = H[m.end():i]
        hits = re.findall(call_re, body)
        if hits:
            res[name] = hits
    return res


print("=== 诺诺钩子真实归属（函数体内部严格匹配）===")
for fn, hits in funcs_with(r'nono(?:Show|Milestone|Cheer|Hook|Say|Tip)\s*\(').items():
    print(f"  {fn}(): {hits}")

print("\n=== 场景/F 钩子关键词（严格函数体内）===")
for kw, label in [(r'NONO\.sceneCheer', '句卡全清'), (r'NONO\.chat5', '聊天5轮'),
                  (r'NONO\.milestone|milestone', '里程碑'), (r'复习|review', 'review 相关函数')]:
    d = funcs_with(kw)
    print(f"  [{label}] 命中函数 {len(d)}: {list(d)[:12]}")

print("\n=== graduate / badge / tone / daily 钩子 ===")
for fn in ["nonoGraduation", "nonoWatchBadges", "nonoGrade", "nonoToneTip", "nonoDailyLine",
           "nonoPracticeLine", "nonoPracticeDialog", "nonoContextGreet"]:
    m = re.search(r'function\s+' + fn + r'\s*\([^)]*\)\s*\{', H)
    if not m:
        print(f"  {fn}: 不存在")
        continue
    i, depth = m.end() - 1, 0
    while i < len(H):
        if H[i] == '{':
            depth += 1
        elif H[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = H[m.end():i]
    strs = re.findall(r"'([^']{4,40})'", body)
    print(f"  {fn}() len={len(body)} | nono调用={len(re.findall(r'nono', body))} | 文案样例={strs[:3]}")

print("\n=== 关键 CSS 精查 ===")
for sel in [r'\.nc-bub\b[^{]*\{[^}]*\}', r'\.nc-you\b[^{]*\{[^}]*\}', r'#fb-open\{[^}]*\}',
            r'\.badge\b[^{]*\{[^}]*\}', r'\.seg\{[^}]*\}', r'\.tonebtn\{[^}]*\}',
            r'\.np-foot button\{[^}]*\}', r'\.syl\{[^}]*\}', r'\.rv-mode\{[^}]*\}']:
    for m in list(re.finditer(sel, H))[:2]:
        t = re.sub(r'\s+', ' ', m.group(0))
        print("  " + t[:190])

print("\n=== 首页/hero 是否有插画位 ===")
hero = re.search(r'<div class="hero">(.*?)</div>', H, re.S)
print("  hero 内容:", re.sub(r'\s+', ' ', hero.group(0))[:220] if hero else "n/a")
print("  index 内 <img> 总数:", len(re.findall(r'<img', H)))
print("  引用的本地资产种类:", sorted(set(re.findall(r'assets/(\w+)/', H))))

print("\n=== 诺诺面板限高 / 滚动（方案 4.2）===")
for sel in [r'#nono-panel\{[^}]*\}', r'\.npanel-flex[^{]*\{[^}]*\}', r'#nono-chat\{[^}]*\}', r'\.nc-scroll[^{]*\{[^}]*\}']:
    for m in list(re.finditer(sel, H))[:1]:
        print("  " + re.sub(r'\s+', ' ', m.group(0))[:230])
