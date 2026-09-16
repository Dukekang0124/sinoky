# -*- coding: utf-8 -*-
"""
bump_v02313.py —— v0.23.12 → v0.23.13 版本号六处同步（幂等）。
派生自 bump_v02312.py（两个硬化点保留：① apk.url 比完整期望 URL、② noteEn 按版本前缀去重）。

两条独立版本线：
  WEB_V  = version.json 顶层 version · index.html APP_VERSION · sw.js CACHE      ← 3 处
  APK_V  = version.json apk.version/url/versionCode · download.html 兜底链接 ×2  ← 4 处
  ⚠️ APK 的 md5/size 由 CI 构建后注入（见 .github/workflows/apk.yml），本脚本不碰。
  ⚠️ www/ 与 android/ 由 CI 临时生成、已 gitignore，**不要手改**。
  🔴 本版必须换 CACHE 名：A 类 16 张图在 sw.js 预缓存里，不改 CACHE 名旧图会一直黏在用户端。

本版改动：配图升级第一轮 —— A 类 16 张修 alpha 抠图 + B 类 6 张「每日一句」换真实场景图。
用法：python bump_v02313.py          # 写盘
      python bump_v02313.py --check  # 只报当前状态
"""
import io
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WEB_V = "0.23.13"
APK_V = "0.23.13"
APK_CODE = 2313
DATE = "2026-09-16"

NOTE = ("v0.23.13：配图升级（第一轮）。① 修复 16 张 3D 诺诺姿态图 / 空态图 / 引导图的抠图缺陷——"
        "这些图边缘原本残留一圈白边（边缘白占比 21%–37%，而同角色定妆稿的基线只有 0.2%），"
        "在深色界面上发灰、显廉价，而且它们全都在首屏预缓存里、每位新用户一打开就缓存。"
        "本轮只重做 alpha 边缘、造型与构图完全冻结（轮廓重合度 ≥97%），边缘白占比降到 ≤1.1%、四角清零。"
        "②「每日一句」的 6 张配图换成新版「诺诺真实场景」——3D 诺诺走进真实的中国生活场景"
        "（早餐、地铁、看医生、朋友聚餐、菜市场、旅行），风格为 Stylized Realism，"
        "尺寸 800×450、体积 44–57KB。本版网页与 APK 同步发布。")

NOTE_EN = ("v0.23.13: artwork upgrade (round one). (1) Fixed the cut-out quality of 16 3D Nono pose / empty-state / "
           "onboarding images - their edges had a ring of residual white fringe (21%-37% near-white on the edge, "
           "versus 0.2% on the character's own key-art baseline), which looked grey and cheap on the dark UI, and "
           "all of them sit in the first-load precache so every new user cached them immediately. This round only "
           "redoes the alpha edge with the pose and composition frozen (silhouette overlap >=97%), bringing edge "
           "near-white down to <=1.1% with all four corners cleared. (2) The six Daily Sentence images are replaced "
           "with a new 'Nono in real scenes' set - the 3D Nono placed in real Chinese everyday scenes (breakfast, "
           "metro, seeing a doctor, friends' hotpot, wet market, travel), in a stylized-realism style, at 800x450, "
           "44-57KB each. Web and APK ship together this round.")


def rd(p):
    return io.open(os.path.join(ROOT, p), encoding="utf-8").read()


def wr(p, s):
    io.open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="").write(s)


def main():
    check = "--check" in sys.argv
    jobs = []

    s = rd("index.html")
    m = re.search(r"var APP_VERSION = '([\d.]+)';", s)
    jobs.append(("index.html APP_VERSION", m.group(1), WEB_V))

    s2 = rd("sw.js")
    m2 = re.search(r"var CACHE = 'sinoky-v([\d.]+)';", s2)
    jobs.append(("sw.js CACHE", m2.group(1), WEB_V))

    s3 = rd("download.html")
    cur = sorted(set(re.findall(r"apk/Sinoky-v([\d.]+)-release\.apk", s3)))
    jobs.append(("download.html 兜底链接 ×%d" % len(re.findall(r"apk/Sinoky-v([\d.]+)-release\.apk", s3)),
                 ",".join(cur), APK_V))

    import json
    import collections
    vj = json.loads(rd("version.json"), object_pairs_hook=collections.OrderedDict)
    jobs.append(("version.json version", vj["version"], WEB_V))
    jobs.append(("version.json updated", vj.get("updated", ""), DATE))
    jobs.append(("version.json note 首段", (vj.get("note") or "")[:24], NOTE[:24]))
    jobs.append(("version.json apk.version", vj["apk"]["version"], APK_V))
    jobs.append(("version.json apk.versionCode", vj["apk"]["versionCode"], APK_CODE))
    APK_URL = "https://sinoky.pages.dev/apk/Sinoky-v%s-release.apk" % APK_V
    jobs.append(("version.json apk.url", vj["apk"]["url"], APK_URL))
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

    s = re.sub(r"var APP_VERSION = '[\d.]+';", "var APP_VERSION = '%s';" % WEB_V, s, count=1)
    wr("index.html", s)
    s2 = re.sub(r"var CACHE = 'sinoky-v[\d.]+';", "var CACHE = 'sinoky-v%s';" % WEB_V, s2, count=1)
    wr("sw.js", s2)
    s3 = re.sub(r"apk/Sinoky-v[\d.]+-release\.apk", "apk/Sinoky-v%s-release.apk" % APK_V, s3)
    wr("download.html", s3)

    vj["version"] = WEB_V
    vj["updated"] = DATE
    vj["note"] = NOTE
    vj["noteEn"] = ne_new
    vj["apk"]["version"] = APK_V
    vj["apk"]["versionCode"] = APK_CODE
    vj["apk"]["url"] = "https://sinoky.pages.dev/apk/Sinoky-v%s-release.apk" % APK_V
    wr("version.json", json.dumps(vj, ensure_ascii=False, indent=2) + "\n")

    print("  已写盘：")
    for name, a, b in jobs:
        print("    %-34s %s  →  %s" % (name, a, b))
    print("\n  ⚠️ version.json 的 apk.md5 / apk.size 仍是上一版值，等 CI 出包后回填。")


if __name__ == "__main__":
    main()
