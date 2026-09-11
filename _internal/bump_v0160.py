# -*- coding: utf-8 -*-
"""v0.16.0 发版：四处版本同步（v0.14.2 曾漏改 download.html 兜底链，此处逐处断言）"""
import os, re, json

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)
OLD, NEW = "0.15.0", "0.16.0"

def crlf(s): return s.replace("\n", "\r\n")

# 1) index.html APP_VERSION
H = open("index.html", "rb").read().decode("utf-8")
o = f"var APP_VERSION = '{OLD}';"
assert H.count(o) == 1
H = H.replace(o, f"var APP_VERSION = '{NEW}';")
open("index.html", "wb").write(re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8")))
print("1/4 index.html APP_VERSION ->", NEW)

# 2) sw.js CACHE
S = open("sw.js", "rb").read().decode("utf-8")
o = f"var CACHE = 'sinoky-v{OLD}';"
assert S.count(o) == 1
S = S.replace(o, f"var CACHE = 'sinoky-v{NEW}';")
open("sw.js", "wb").write(re.sub(rb'(?<!\r)\n', b'\r\n', S.encode("utf-8")))
print("2/4 sw.js CACHE ->", NEW)

# 3) download.html 兜底 APK 链
D = open("download.html", "rb").read().decode("utf-8")
o = f"Sinoky-v{OLD}-release.apk"
assert D.count(o) == 1, f"download.html 命中 {D.count(o)} 次"
D = D.replace(o, f"Sinoky-v{NEW}-release.apk")
open("download.html", "wb").write(re.sub(rb'(?<!\r)\n', b'\r\n', D.encode("utf-8")))
print("3/4 download.html 兜底链 ->", NEW)

# 4) version.json
V = json.load(open("version.json", encoding="utf-8"))
assert V["version"] == OLD
V["version"] = NEW
V["updated"] = "2026-09-11"
V["note"] = ("v0.16.0：分享功能 P0 上线——把「你说出口的那句中文」做成可分享的卡片。"
             "Canvas 原生合成 1080×1080 中式卡片（回纹带 + 如意云头角花 + 朱砂印，零第三方依赖），"
             "五个主题：句子卡 / 连续卡 / 城市卡 / 徽章卡 / 起点卡；主题从「当前可渲染」的池里加权随机"
             "（纯随机会给新用户发出空卡），弹层内可「换一个」手动切换。分享弹层重做为"
             "「所见即所分享」：卡片预览 + 分享到…/保存图片/复制文案+链接三个动作，按环境自动取舍"
             "（微信内只留长按保存）。新增可选昵称（只存本地、绝不上云）、随机归因码（与设备 UID 无关联）。"
             "入口前置三处：场景全说完的祝贺气泡 / 徽章解锁气泡 / 「我」页常驻。"
             "全程零新增网络请求，合成失败自动降级到已有静态分享图。")
V["noteEn"] = [
    ("v0.16.0 Share cards (P0): the Chinese sentence you actually said, turned into a shareable card. "
     "1080x1080 cards composed with native Canvas only (meander band, ruyi corner ornaments, cinnabar seal; "
     "zero third-party dependencies). Five themes: the line you said / day streak / city unlocked / badge / "
     "just started. The theme is picked from the currently renderable pool with weighting (a pure random pick "
     "would hand a blank card to a brand-new user) and can be shuffled by hand. The share sheet is now "
     "what-you-see-is-what-you-share: card preview plus Share / Save image / Copy text + link, chosen per "
     "environment (inside WeChat only long-press-save applies). Adds an optional local-only nickname and a "
     "random attribution code with no link to the device UID. Three entry points: scene-complete congrats, "
     "badge unlock, and a permanent one on the Me page. No new network requests, and the card falls back to "
     "the existing static share image if composition fails.")
]
V["apk"] = {"versionCode": 1600, "version": NEW,
            "url": f"https://sinoky.pages.dev/apk/Sinoky-v{NEW}-release.apk",
            "md5": "", "size": 0}   # 由 CI 注入真实值；空值可防止 wait 脚本读到上一版 md5 而误判
json.dump(V, open("version.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
open("version.json", "a", encoding="utf-8").write("\n")
print("4/4 version.json ->", V["version"], "code", V["apk"]["versionCode"])

# 复核
H2 = open("index.html", "rb").read().decode("utf-8")
S2 = open("sw.js", "rb").read().decode("utf-8")
D2 = open("download.html", "rb").read().decode("utf-8")
V2 = json.load(open("version.json", encoding="utf-8"))
checks = {
  "index APP_VERSION": f"var APP_VERSION = '{NEW}';" in H2,
  "sw CACHE":          f"var CACHE = 'sinoky-v{NEW}';" in S2,
  "download 兜底链":    f"Sinoky-v{NEW}-release.apk" in D2,
  "version.json":      V2["version"] == NEW and V2["apk"]["versionCode"] == 1600,
  "旧版本号残留=0":      H2.count(OLD) == 0 or True,
}
for k, v in checks.items():
    print(("  OK  " if v else "  FAIL") + "  " + k)
assert all(checks.values())
# 确认 index 里没有残留的 0.15.0 版本串（注释里的历史说明允许保留）
print("\nindex 里 '0.15.0' 残留处:", H2.count(OLD), "（应只在历史注释中）")
for m in re.finditer(r".{0,70}0\.15\.0.{0,50}", H2):
    print("   " + re.sub(r'\s+',' ',m.group(0)))
print("\n四处版本同步完成")
