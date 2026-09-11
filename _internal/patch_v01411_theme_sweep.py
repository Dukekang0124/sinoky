# -*- coding: utf-8 -*-
"""P0 清剿：把「换肤前的旧色值」全部归到主题变量（按色值归类，逐处核验上下文）"""
import re, os

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
P = os.path.join(APP, "index.html")
H = open(P, "rb").read().decode("utf-8", "replace")
orig = H

report = []


def sub_count(pat, repl, label, allow=None):
    """全局替换并统计；allow 给定时校验每处上下文都含允许关键词"""
    global H
    n = 0
    for m in list(re.finditer(pat, H, re.I))[::-1]:
        ctx = H[max(0, m.start() - 90):m.end() + 60]
        if allow and not any(k in ctx for k in allow):
            report.append(f"  !! 跳过（上下文不符 {label}）: {re.sub(chr(92)+'s+', ' ', ctx)[:120]}")
            continue
        H = H[:m.start()] + repl + H[m.end():]
        n += 1
    report.append(f"  {label}: {n} 处")
    return n


print("=== 应用清剿 ===")

# 1) 旧洋红 hex → 主题变量（CSS 值位）
sub_count(r'#e63946(?![0-9a-fA-F])', 'var(--red)', "旧洋红 #e63946 → var(--red)")

# 2) JS 里的 var(--accent,#e63946) 兜底 → 新红兜底
sub_count(r'var\(--accent,\s*var\(--red\)\)', 'var(--accent,var(--red))', "accent 兜底(已被上一步改写)")

# 3) 旧红半透明 rgba(230,57,70,*) → 新朱砂 rgb(194,54,43,*)
sub_count(r'rgba\(230,\s*57,\s*70,', 'rgba(194,54,43,', "旧红半透明 rgba(230,57,70,*) → rgba(194,54,43,*)")

# 4) 旧墨色 #141a24 → 主题变量（4 处，用途不同分别处理）
H = H.replace('content="#141a24"', 'content="#161a20"'); report.append("  meta theme-color → #161a20")
H = H.replace('#splash{position:fixed;inset:0;z-index:9999;background:#141a24;',
              '#splash{position:fixed;inset:0;z-index:9999;background:var(--bg);'); report.append("  #splash 底 → var(--bg)")
H = H.replace('linear-gradient(180deg,#18202b 0%,#141a24 100%)',
              'linear-gradient(180deg,var(--bg2) 0%,var(--bg) 100%)'); report.append("  诺诺面板底 → var(--bg2)→var(--bg)")
H = H.replace('background:#c9a86c;color:#141a24', 'background:var(--gold);color:var(--bg)'); report.append("  打字钮 金底深字 → var(--gold)/var(--bg)")

# 5) 旧 --line（JS 彩带）
sub_count(r'#2b3648', '#33404c', "旧描边 #2b3648 → #33404c")

# 6) 引导页自带旧灰（仅在 v-onboard / ob- 上下文内替换）
sub_count(r'#8b93a7', 'var(--sub)', "引导页哑灰 #8b93a7 → var(--sub)", allow=['v-onboard', 'ob-'])
sub_count(r'#2a2f3a', 'var(--card)', "引导页块底 #2a2f3a → var(--card)", allow=['v-onboard', 'ob-'])

print("\n".join(report))

# 7) 引导页 CTA 胶囊化（与其他按钮统一）
m = re.search(r'(#v-onboard [^{]*?\.?ob-[a-z-]*cta[^{]*\{[^}]*\})', H)
cta = re.search(r'\}[^}]*?padding:16px;font-size:16px;font-weight:700;background:var\(--red\)[^}]*\}', H)
print("\n=== 引导页 CTA 规则 ===")
for mm in re.finditer(r'\{[^{}]*padding:16px;font-size:16px;font-weight:700;background:var\(--red\)[^{}]*\}', H):
    print("  ", re.sub(r'\s+', ' ', mm.group(0)))

open(P, "wb").write(H.encode("utf-8"))
bare = H.count("\n") - H.count("\r\n")
print(f"\n写入完成 | bare LF: {bare} | 净变化: {len(H) - len(orig)} 字符")
print("残留旧洋红:", H.count("#e63946"), "| 残留旧红alpha:", len(re.findall(r'rgba\(230,57,70,', H)),
      "| 残留 #141a24:", H.count("#141a24"), "| 残留 #8b93a7:", H.count("#8b93a7"), "| 残留 #2a2f3a:", H.count("#2a2f3a"))
