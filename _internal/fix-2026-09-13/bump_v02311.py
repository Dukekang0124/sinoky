# -*- coding: utf-8 -*-
"""
bump_v02311.py —— v0.23.10 → v0.23.11 版本号六处同步（幂等）。
派生自 bump_v02310.py（其两个硬化点已包含在内：① apk.url 比完整 URL、② noteEn 按版本前缀去重）。

两条独立版本线（本项目最容易漏的地方）：
  WEB_V  = version.json 顶层 version · index.html APP_VERSION · sw.js CACHE      ← 3 处
  APK_V  = version.json apk.version/url/versionCode · download.html 兜底链接 ×2  ← 4 处
  ⚠️ APK 的 md5/size 由 CI 构建后注入（见 .github/workflows/apk.yml），本脚本不碰。
  ⚠️ www/ 与 android/ 由 CI 临时生成、已 gitignore，**不要手改**。
  ⚠️ APK 的真实版本号来源是 index.html 的 APP_VERSION（apk.yml 用它解析），所以必须一起改。

用法：python bump_v02311.py          # 写盘
      python bump_v02311.py --check  # 只报当前状态
"""
import io
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WEB_V = "0.23.11"
APK_V = "0.23.11"
APK_CODE = 2311
DATE = "2026-09-13"

NOTE = ("v0.23.11：开屏（启动画面）换成一张完整的满版设计图。"
        "此前开屏是现场拼的 —— 「深青底 + 一行字体画出来的 SinoKy 字标 + 一张透明角色图」，"
        "而那张角色图本身是 560×820 带透明通道的素材（原本给「点头像展开全身」用的），不是为开屏设计的，"
        "比例对不上、上下留白，观感像「一张图贴在色块上」。"
        "现在改用 assets/splash/a8_9x16.webp：1080×1920 的完整开屏稿，自带品牌红字标、云纹山峦背景与诺诺，整屏一张图。"
        "顺带三处收紧：① 底色从 #17423D 改成图内实测色 #0E3739，补色处与图边缘完全无缝（实测色差不超过 4）；"
        "② 开屏图比旧素材大一倍（101 KB 对 48 KB），原来的「固定 420ms 后淡出」会在慢网下出现「图刚出来就淡出」，"
        "改成「等图就绪再淡出」，硬上限 1600ms 兜底、绝不拖住首屏；"
        "③ 开屏图纳入离线预缓存，且加载失败时降级为品牌字标，而不是整屏空白。"
        "APK 的原生启动底色也同步对齐 #0E3739，消除启动瞬间的色跳。本版网页与 APK 同步发布。")

NOTE_EN = ("v0.23.11: the launch screen (splash) is now one complete full-bleed artwork. "
           "Previously it was assembled on the spot from a dark teal background, a SinoKy wordmark drawn with a font, "
           "and a transparent character cutout - and that cutout, a 560x820 asset with an alpha channel, was made for "
           "the tap-to-expand full-body view rather than for a splash. Its aspect ratio did not match, leaving blank "
           "bands, and it looked like an image pasted onto a colour block. The app now uses "
           "assets/splash/a8_9x16.webp: a finished 1080x1920 launch artwork that already contains the red brand "
           "wordmark, the cloud-and-mountain background and Nono, as a single full-screen image. "
           "Three things were tightened along the way. (1) The backing colour changed from #17423D to #0E3739, sampled "
           "from the artwork itself, so the letterboxed areas are seamless with the image edges - measured colour "
           "difference is at most 4. (2) The new image is twice the size of the old asset (101 KB versus 48 KB), and "
           "the old fixed 420 ms fade-out would have dismissed the splash just as the image arrived on a slow "
           "connection. It now waits for the image to be ready, with a hard 1600 ms ceiling so the first screen is "
           "never held up. (3) The splash image is pre-cached for offline use, and if it fails to load the app falls "
           "back to the brand wordmark instead of a blank screen. The APK native launch background is aligned to "
           "#0E3739 as well, removing the colour jump at startup. Web and APK ship together this round.")


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
    # 之前「md5 未变」只是碰巧内容稳定，掩盖了「本该短路却写了」；noteEn 连插两次的重复条目就是这么来的。
    APK_URL = "https://sinoky.pages.dev/apk/Sinoky-v%s-release.apk" % APK_V
    jobs.append(("version.json apk.url", vj["apk"]["url"], APK_URL))
    # 🔴 noteEn 必须**按版本前缀去重**，否则脚本每跑一次就把同一条 NOTE_EN 再插一遍。
    # 真实事故（v0.23.10 首次执行时踩到）：原来的 guard 只比对版本串、完全不看 note/noteEn，
    # 于是内容一旦漂移，脚本既发现不了、也永远修不回 —— 线上 noteEn 变成 [10, 10, 9, 8]，
    # 而 index.html 的 APK 更新弹窗是把整个数组 join('<br>') 显示（英文用户会看到两遍相同说明）。
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
