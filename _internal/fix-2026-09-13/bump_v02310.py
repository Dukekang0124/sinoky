# -*- coding: utf-8 -*-
"""
bump_v02310.py —— v0.23.9 → v0.23.10 版本号六处同步（幂等）。

两条独立版本线（本项目最容易漏的地方）：
  WEB_V  = version.json 顶层 version · index.html APP_VERSION · sw.js CACHE      ← 3 处
  APK_V  = version.json apk.version/url/versionCode · download.html 兜底链接 ×2  ← 4 处
  ⚠️ APK 的 md5/size 由 CI 构建后注入（见 .github/workflows/apk.yml），本脚本不碰。
  ⚠️ www/ 与 android/ 由 CI 临时生成、已 gitignore，**不要手改**。
  ⚠️ APK 的真实版本号来源是 index.html 的 APP_VERSION（apk.yml 用它解析），所以必须一起改。

用法：python bump_v02310.py          # 写盘
      python bump_v02310.py --check  # 只报当前状态
"""
import io
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WEB_V = "0.23.10"
APK_V = "0.23.10"
APK_CODE = 2310
DATE = "2026-09-13"

NOTE = ("v0.23.10：修两处「用户一眼能看见」的问题，外加一次全站体检。"
        "① 语速按钮点第二次会吐出一串 HTML 源码（`<svg class=\"play-icon-sm\" viewBox=\"0 0 24 24\" …`）。"
        "根因很典型：这个按钮**首次渲染**走 innerHTML，图标正常显示；但**点切换**时用的是 textContent 写回，"
        "浏览器会把标签转义成纯文本直接吐在按钮上 —— 所以第一次点看不出问题，第二次点才暴雷。"
        "已改成与首帧同一条路径（innerHTML）。"
        "② 品牌形象不一致：Me 页底部横幅卡、Web Share 分享图等 8 张素材仍是**旧版红卫衣**诺诺，"
        "而产品内其它位置（浮标、引导、空态）早已是 Sep-12 定妆的新版白卫衣诺诺。8 张全部换成新版，版式不动。"
        "③ 触控目标：全站有 9 处控件小于 24×24（首页「句子收藏 / 场景」分段切换、页脚 Privacy / Share 等内联链接、"
        "诺诺面板「–」收起键），手机上点不中。已在不改版式的前提下把可点区扩到 ≥24px。"
        "④ 顺手补上第 4 类自动体检：全站自检脚本新增「裸 HTML 标记泄漏」「内容残缺（undefined/NaN/未填占位）」"
        "「触控目标过小」「装饰层被裁切」四类探针 —— 第①项这类问题以后在提交前就会被拦下。"
        "本版网页与 APK 同步发布，APK 从 v0.23.9 升到 v0.23.10。")

NOTE_EN = ("v0.23.10: two things you can see at a glance, plus a full-app sweep. "
           "(1) The playback-speed button printed raw HTML on its second tap "
           "(`<svg class=\"play-icon-sm\" viewBox=\"0 0 24 24\" ...`). The cause is a classic: the button is "
           "first drawn with innerHTML, so the icon renders correctly, but the tap handler wrote the new label "
           "back with textContent, and the browser escapes markup into plain text - which is why the first tap "
           "looked fine and only the second one broke. It now uses the same path as the first paint, innerHTML. "
           "(2) Brand consistency: eight images still showed the old red-hoodie Nono, including the banner card at "
           "the bottom of the Me screen and the image attached by Web Share, while every other place in the app "
           "(the floating button, onboarding, empty states) already used the new white-hoodie Nono defined on "
           "Sep 12. All eight now use the new artwork, with the layouts untouched. "
           "(3) Tap targets: nine controls were smaller than 24x24 - the segmented \"Saved sentences / Scenes\" "
           "toggle on Home, inline footer links such as Privacy and Share, and the \"-\" minimise button on the "
           "Nono panel - which are hard to hit on a phone. Their hit areas are now at least 24px without changing "
           "the layout. (4) The whole-app self-check gained four more probes: raw HTML leaking into the interface, "
           "incomplete content (undefined / NaN / unfilled placeholders), undersized tap targets, and clipped "
           "decorative layers - so problems like (1) are now caught before they ship. "
           "Web and APK ship together this round; the APK goes from v0.23.9 to v0.23.10.")


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
