# -*- coding: utf-8 -*-
"""审计 Step1：抓线上 index.html，对 CSS 层做静态核验（方案 V4 逐项）"""
import re, ssl, urllib.request

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
req = urllib.request.Request("https://sinoky.pages.dev/?audit=" + str(__import__("time").time()),
                             headers={"User-Agent": "Mozilla/5.0 audit"})
H = urllib.request.urlopen(req, timeout=60, context=ctx).read().decode("utf-8", "replace")
print(f"index.html bytes={len(H)}\n")


def show(label, cond, detail=""):
    print(f"{'[有]' if cond else '[无]'} {label}" + (f"  -> {detail}" if detail else ""))


print("=== §2 色彩系统 ===")
root = re.search(r':root\{(.*?)\}', H, re.S).group(1)
show("2.1 --red 朱砂", "--red:#c2362b" in root.replace(" ", ""), re.search(r'--red:\s*([^;]+)', root).group(1))
show("2.1 --gold 鎏金", "--gold:" in root, (re.search(r'--gold:\s*([^;]+)', root) or ["", "n/a"])[1])
show("2.1 --teal 竹青", "--teal:" in root, re.search(r'--teal:\s*([^;]+)', root).group(1))
for v in ["--paper", "--gold-dim", "--ink", "--zhu"]:
    show(f"2.2 新增变量 {v}", v + ":" in root)

print("\n=== §3 字体 ===")
serif = re.search(r'h1,h2[^{]*\{([^}]*)\}', H)
show("3.1 标题衬线栈", bool(serif and "serif" in serif.group(1)), (serif.group(1)[:110] if serif else ""))
show("3.2 拉丁前置 Georgia", "Georgia" in (serif.group(1) if serif else ""))
body = re.search(r'body\{([^}]*)\}', H)
show("3.1 正文无衬线栈", bool(body and "-apple-system" in body.group(1)))
show("3.1 拼音/数字 tabular-nums", "tabular-nums" in H)
show("3.3 书法用 SVG 而非字体", "言" in H, f"index 内含「言」字 {H.count('言')} 处")

print("\n=== §4 布局与组件 ===")
wrap = re.search(r'\.wrap\{([^}]*)\}', H)
show("4.1 .wrap 520px/16px/90px", bool(wrap and "520px" in wrap.group(1) and "16px" in wrap.group(1) and "90px" in wrap.group(1)), (wrap.group(1) if wrap else ""))
print(f"     4.2 胶囊 border-radius:99px 规则数 = {H.count('border-radius:99px')}")
show("4.2 主按钮胶囊", bool(re.search(r'\.btn\{[^}]*border-radius:99px', H)))
show("4.3 卡片**雕花角花**(data-URI SVG)", "background-image:url(\"data:image/svg+xml" in H.replace("'", '"') and "corner" in H.lower())
show("4.3 回纹分隔线", "meander" in H or "回纹" in H)
show("4.3 导航选中祥云托底", "祥云" in H or bool(re.search(r'nav button\.on::?[a-z]*\{[^}]*background-image', H)))
show("4.2 按钮内嵌金环(inset)", "inset 0 0 0 1px var(--gold)" in H or "inset 0 0 0 1px" in H)
show("4.2 输入框金线", bool(re.search(r'input[^{]*\{[^}]*border[^}]*gold', H)))
show("4.2 诺诺/用户气泡尖角圆角", bool(re.search(r'14px 14px 14px 4px', H)))
badge = re.search(r'\.badge\{([^}]*)\}', H)
print(f"     4.2 .badge 现样式: {badge.group(1)[:150] if badge else 'n/a'}")
show("4.2 徽章=圆形44px印章+2px金环（方案要求）",
     bool(badge and "border-radius:50%" in badge.group(1) and "44px" in badge.group(1)),
     "实为胶囊式小标签 → 偏差")

print("\n=== §5 图标 ===")
nav = re.search(r'<nav>(.*?)</nav>', H, re.S).group(1)
imgs = len(re.findall(r'<img', nav)); emo = len(re.findall(r'class="ic"', nav))
show("5.1 底部导航 5 个中式线稿图标（方案要求）", emo == 0, f"现为 {imgs} 个 SVG + {emo} 个 emoji")
show("5.2 新增 practice/explore/me 三个线稿", all(x in H for x in ["nav-practice\" ><img", "nav-explore\" ><img", "nav-me\" ><img"]))
print(f"     assets/icons 现有: cards/home/progress/read/sentences/tones（6 个，均为卡片入口用）")

print("\n=== §6 IP 形象体系 ===")
mas = sorted(set(re.findall(r'assets/mascot/([a-z]+)\.webp', H)))
print(f"     6.2 表情资产被引用: {mas}（共 {len(mas)} 张，方案要求 12 张）")
show("6.1/6.2 辰辰（幼龙）IP", "辰辰" in H)
show("6.1 龙鳞进度条", "龙鳞" in H)
show("6.1 跃龙门毕业页", "跃龙门" in H)

print("\n=== §7 诺诺场景钩子 ===")
for k, label in [("sceneCheer", "句卡全清祝贺"), ("chat5", "聊天 5 轮彩蛋"),
                 ("rvStreak", "复习连对"), ("clearAll", "复习清空当日")]:
    print(f"     [{'有' if k in H else '无'}] {label} (key={k})  出现 {H.count(k)} 次")
views = sorted(set(re.findall(r'id="(v-[a-z]+)"', H)))
nono = H.count("nono(") + H.count("nonoShow(")
print(f"     视图总数 {len(views)}: {views}")
print(f"     nono 调用点 {nono} 处（覆盖到哪些视图需运行期核验）")

print("\n=== §8 图片视觉设计 ===")
show("8.1 P1 启动屏主视觉", "dragon-nono" in H, "已按指示摘除；资产仍存 assets/brand/")
show("8.1 P2 首页 hero 插画/龙纹页眉", "hero-illu" in H or "龙纹" in H)
show("8.1 P5 龙鳞进度条（30 鳞）", "scale" in H.lower() and "龙" in H)
show("8.1 P6 毕业/分享页", "毕业" in H)
print(f"     8.2 素材：mascot {len(mas)} 张 / splash 1 张 / 新增品牌 SVG 1 个（未引用）")

print("\n=== §9 分期 ===")
print("     二期项实施情况（逐项）：")
for k, label in [("角花", "卡片雕花角花"), ("回纹", "回纹分隔线"), ("祥云", "导航祥云"),
                 ("inset 0 0 0 1px", "按钮内嵌金环"), ("nav-practice", "导航图标统一")]:
    print(f"       {'已做' if k in H else '未做'}  {label}")
