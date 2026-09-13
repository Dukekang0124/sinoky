# -*- coding: utf-8 -*-
"""
bump_v02312.py —— v0.23.11 → v0.23.12 版本号六处同步（幂等）。
派生自 bump_v02311.py（两个硬化点保留：① apk.url 比完整期望 URL、② noteEn 按版本前缀去重）。

两条独立版本线（本项目最容易漏的地方）：
  WEB_V  = version.json 顶层 version · index.html APP_VERSION · sw.js CACHE      ← 3 处
  APK_V  = version.json apk.version/url/versionCode · download.html 兜底链接 ×2  ← 4 处
  ⚠️ APK 的 md5/size 由 CI 构建后注入（见 .github/workflows/apk.yml），本脚本不碰。
  ⚠️ www/ 与 android/ 由 CI 临时生成、已 gitignore，**不要手改**。
  ⚠️ APK 的真实版本号来源是 index.html 的 APP_VERSION（apk.yml 用它解析），所以必须一起改。

本版改动只有一个：**开屏字标闪现**（首屏样式「规则晚于元素」）。
所以发版说明写「修缺陷」，不写新特性。

用法：python bump_v02312.py          # 写盘
      python bump_v02312.py --check  # 只报当前状态
"""
import io
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WEB_V = "0.23.12"
APK_V = "0.23.12"
APK_CODE = 2312
DATE = "2026-09-13"

NOTE = ("v0.23.12：修掉一个开屏观感事故 —— 冷启动那一瞬间，满版开屏图上会闪出另一套字标。"
        "现象是：屏幕上先出现「SinoKy」的字标，随后满版开屏图铺上来，但字标并没有消失，而是压在图上继续显示；"
        "因为开屏图本身就自带品牌字标，于是出现两套字标同屏（图左侧能看到 CSS 字标露在外面）。"
        "慢网下实测字标可见 5.7 秒，其中 4.9 秒是「图和字标并存」。"
        "根因是单文件结构的一个经典陷阱：那条「隐藏字标」的规则写在文件的靠后位置（6500 行之后的样式块里），"
        "而开屏元素在 1138 行 —— 浏览器流式解析到元素时还没读到那条规则，于是先按默认值把字标显示了出来，"
        "直到解析到规则才纠正。修法是把启动屏的 7 条规则从两处合并为一处、全部上移到页面头部的样式块（写在元素之前）；"
        "布局参数原样保留，因此画面稳定后与之前完全一致。顺带消掉了首帧的底色跳变，"
        "以及源码里那句「两处规则必须同步」的隐患。本版网页与 APK 同步发布。")

NOTE_EN = ("v0.23.12: fixes a launch-screen glitch - on a cold start a second copy of the wordmark flashed over the "
           "full-bleed splash image. What users saw: the SinoKy wordmark appeared first, then the full-screen artwork "
           "arrived, but the wordmark did not go away - it stayed on top of the image. Because the artwork already "
           "contains the brand wordmark, this put two wordmarks on screen at once (the CSS one visible on the left). "
           "On a slow connection it was measured at 5.7 seconds visible, 4.9 of which had the image and the wordmark "
           "on screen together. The cause is a classic trap in single-file pages: the rule that hides the wordmark sat "
           "in a style block far down the file (past line 6500) while the splash element is at line 1138, so by the "
           "time the browser streamed to the element it had not yet read that rule and rendered the wordmark at its "
           "default value. The seven launch-screen rules are now merged from two places into one and moved up into the "
           "head style block, ahead of the element. The layout values are unchanged, so the settled screen looks "
           "exactly as before. This also removes a first-frame background colour jump and an outdated note in the "
           "source that said two rule sets had to be kept in sync. Web and APK ship together this round.")


def rd(p):
    return io.open(os.path.join(ROOT, p), encoding="utf-8").read()


def wr(p, s):
    io.open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="").write(s)


def main():
    check = "--check" in sys.argv
    jobs = []

    # ---- index.html APP_VERSION（APK 版本号的单一真源）
    s = rd("index.html")
    m = re.search(r"var APP_VERSION = '([\d.]+)';", s)
    jobs.append(("index.html APP_VERSION", m.group(1), WEB_V))

    # ---- sw.js CACHE
    s2 = rd("sw.js")
    m2 = re.search(r"var CACHE = 'sinoky-v([\d.]+)';", s2)
    jobs.append(("sw.js CACHE", m2.group(1), WEB_V))

    # ---- download.html 兜底链接 ×2
    s3 = rd("download.html")
    cur = sorted(set(re.findall(r"apk/Sinoky-v([\d.]+)-release\.apk", s3)))
    jobs.append(("download.html 兜底链接 ×%d" % len(re.findall(r"apk/Sinoky-v([\d.]+)-release\.apk", s3)),
                 ",".join(cur), APK_V))

    # ---- version.json
    import json
    import collections
    vj = json.loads(rd("version.json"), object_pairs_hook=collections.OrderedDict)
    jobs.append(("version.json version", vj["version"], WEB_V))
    jobs.append(("version.json updated", vj.get("updated", ""), DATE))
    jobs.append(("version.json note 首段", (vj.get("note") or "")[:24], NOTE[:24]))
    jobs.append(("version.json apk.version", vj["apk"]["version"], APK_V))
    jobs.append(("version.json apk.versionCode", vj["apk"]["versionCode"], APK_CODE))
    # 🔴 这里必须比**完整期望 URL**，不能比 APK_V —— 曾经写成 APK_V，导致这条永远「需改」，
    # 于是 all(a == b ...) 永远为假、脚本每次都在写盘（幂等 guard 彻底失效）。
    APK_URL = "https://sinoky.pages.dev/apk/Sinoky-v%s-release.apk" % APK_V
    jobs.append(("version.json apk.url", vj["apk"]["url"], APK_URL))
    # 🔴 noteEn 必须**按版本前缀去重**，否则脚本每跑一次就把同一条 NOTE_EN 再插一遍。
    ne_old = [str(x) for x in (vj.get("noteEn") or [])]
    ne_new = [NOTE_EN] + [x for x in ne_old if not x.startswith("v%s:" % WEB_V)][:3]
    jobs.append(("version.json noteEn",
                 "%d 条 / %s" % (len(ne_old), (ne_old[0] if ne_old else "")[:11]),
                 "%d 条 / %s" % (len(ne_new), NOTE_EN[:11])))

    if check or all(a == b for _, a, b in jobs):
        for name, a, b in jobs:
            print("  %-34s %s  →  %s %s" % (name, a, b, "OK" if str(a) == str(b) else "需改"))
        print("\n  （--check 模式或已是目标版本，未写盘）" if check else "\n  已是目标版本，未写盘")
        return

    # ---- 写盘
    s = re.sub(r"var APP_VERSION = '[\d.]+';", "var APP_VERSION = '%s';" % WEB_V, s, count=1)
    wr("index.html", s)
    s2 = re.sub(r"var CACHE = 'sinoky-v[\d.]+';", "var CACHE = 'sinoky-v%s';" % WEB_V, s2, count=1)
    wr("sw.js", s2)
    s3 = re.sub(r"apk/Sinoky-v[\d.]+-release\.apk", "apk/Sinoky-v%s-release.apk" % APK_V, s3)
    wr("download.html", s3)

    vj["version"] = WEB_V
    vj["updated"] = DATE
    vj["note"] = NOTE
    vj["noteEn"] = ne_new          # 已在上面完成「去重 + 截前 4」，不再就地 insert
    vj["apk"]["version"] = APK_V
    vj["apk"]["versionCode"] = APK_CODE
    vj["apk"]["url"] = "https://sinoky.pages.dev/apk/Sinoky-v%s-release.apk" % APK_V
    # md5/size 由 CI 构建后注入，此处保留上一版值并明确标注「待 CI 回填」
    wr("version.json", json.dumps(vj, ensure_ascii=False, indent=2) + "\n")

    print("  已写盘：")
    for name, a, b in jobs:
        print("    %-34s %s  →  %s" % (name, a, b))
    print("\n  ⚠️ version.json 的 apk.md5 / apk.size 仍是上一版值，等 CI 出包后回填。")


if __name__ == "__main__":
    main()
