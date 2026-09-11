# -*- coding: utf-8 -*-
"""v0.14.9 发版：四处版本号同步 + version.json 重写"""
import json, os

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"


def patch(path, old, new):
    p = os.path.join(APP, path)
    b = open(p, "rb").read()
    o = old.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')
    n = new.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')
    cnt = b.count(o)
    assert cnt == 1, f"{path}: expected 1 got {cnt} for {old[:60]!r}"
    b = b.replace(o, n)
    open(p, "wb").write(b)
    print("patched", path, "| bare LF:", b.count(b"\n") - b.count(b"\r\n"))


patch("index.html", "var APP_VERSION = '0.14.8';", "var APP_VERSION = '0.14.9';")
patch("sw.js", "var CACHE = 'sinoky-v0.14.8c';", "var CACHE = 'sinoky-v0.14.9';")
patch("download.html",
      "https://sinoky.pages.dev/apk/Sinoky-v0.14.8-release.apk",
      "https://sinoky.pages.dev/apk/Sinoky-v0.14.9-release.apk")

v = {
    "version": "0.14.9",
    "updated": "2026-09-11",
    "note": "v0.14.9：中国风视觉全面落地——启动屏换「金龙盘诺诺」主视觉（鎏金中国龙盘绕怀抱青竹的诺诺，鹿角/鬃毛/龙须/鳞节，红连帽卫衣熊猫形象与 App 原型完全一致），全应用墨韵朱砂主题（朱砂/鎏金/竹青三彩、窗格纹底、宋体标题）、按钮全面胶囊化、卡片雕花角、导航图标统一为中式线稿、诺诺 AI 场景鼓励钩子。",
    "apk": {
        "versionCode": 1409,
        "version": "0.14.9",
        "url": "https://sinoky.pages.dev/apk/Sinoky-v0.14.9-release.apk",
        "md5": "",
        "size": 0,
    },
    "noteEn": [
        "v0.14.9: Full Chinese-style visual rollout — new 'Golden Dragon & Nono' splash screen (a gilded Chinese dragon coiling around Nono the panda in a red hoodie, with antlers, mane, whiskers and scales), the Ink & Cinnabar theme app-wide (cinnabar/gold/celadon palette, lattice texture, serif headings), fully capsule-shaped buttons, carved corner ornaments on cards, unified Chinese line-art nav icons, and Nono AI encouragement hooks.",
    ],
}
open(os.path.join(APP, "version.json"), "wb").write(
    json.dumps(v, ensure_ascii=False, indent=2).encode("utf-8") + b"\r\n")
print("patched version.json")
