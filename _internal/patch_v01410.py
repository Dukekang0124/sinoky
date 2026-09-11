# -*- coding: utf-8 -*-
"""v0.14.10：摘除主视觉启动屏（回滚到 A8 品牌图）+ 四处版本同步"""
import json, os

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"


def B(s):
    return s.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')


def patch(path, pairs):
    p = os.path.join(APP, path)
    b = open(p, 'rb').read()
    for old, new in pairs:
        o, n = B(old), B(new)
        cnt = b.count(o)
        assert cnt == 1, f"{path}: expected 1 match, got {cnt} for {old[:70]!r}"
        b = b.replace(o, n)
    open(p, 'wb').write(b)
    bare = b.count(b"\n") - b.count(b"\r\n")
    print(f"  patched {path} | bare LF: {bare}")


# —— 1. 摘除主视觉（三处全回滚）——
print("== 摘除主视觉启动屏 ==")
patch("index.html", [
    (
        "#splash{position:fixed;inset:0;z-index:9999;background:#17423D;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.6vh;transition:opacity .45s ease}",
        "#splash{position:fixed;inset:0;z-index:9999;background:#141a24;display:flex;align-items:center;justify-content:center;transition:opacity .45s ease}",
    ),
    (
        "#splash img{width:100%;max-width:430px;height:auto;max-height:70vh;object-fit:contain}\n"
        "#splash .sp-brand{font-family:\"Songti SC\",\"STSong\",\"Noto Serif SC\",\"SimSun\",serif;font-size:30px;font-weight:800;letter-spacing:.6px;color:#F5F1E8;line-height:1}\n"
        "#splash .sp-brand b{color:#D8402F;font-weight:800}",
        "#splash img{width:auto;height:78vh;max-width:92vw;object-fit:contain;border-radius:18px}",
    ),
    (
        '<div id="splash"><div class="sp-brand">Sino<b>k</b>y</div><img src="assets/brand/dragon-nono.svg" alt="Sinoky" onerror="this.parentNode.remove()"></div>',
        '<div id="splash"><img src="assets/splash/a8_9x16.webp" alt="Sinoky" onerror="this.parentNode.remove()"></div>',
    ),
])

# —— 2. 四处版本同步 0.14.9 → 0.14.10 ——
print("== 版本同步 0.14.10 ==")
patch("index.html", [("var APP_VERSION = '0.14.9';", "var APP_VERSION = '0.14.10';")])
patch("sw.js", [("var CACHE = 'sinoky-v0.14.9';", "var CACHE = 'sinoky-v0.14.10';")])
patch("download.html", [
    ("https://sinoky.pages.dev/apk/Sinoky-v0.14.9-release.apk",
     "https://sinoky.pages.dev/apk/Sinoky-v0.14.10-release.apk"),
])

v = {
    "version": "0.14.10",
    "updated": "2026-09-11",
    "note": "v0.14.10：中国风视觉全面落地——全应用「墨韵·朱砂」主题（朱砂/鎏金/竹青三彩、墨底窗格纹、宋体标题）、全部按钮胶囊化、勋章印章化、诺诺聊天框「竹影窗棂」重制（面板限高+独立滚动、按住说话、消息自动滚底，并修复聊天内语音发不出去的问题）、诺诺 AI 鼓励钩子（场景句卡全清 / 复习连对 / 复习清空 / 聊天 5 轮彩蛋）。本版不含新启动屏主视觉。",
    "apk": {
        "versionCode": 1410,
        "version": "0.14.10",
        "url": "https://sinoky.pages.dev/apk/Sinoky-v0.14.10-release.apk",
        "md5": "",
        "size": 0,
    },
    "noteEn": [
        "v0.14.10: Full Chinese-style visual rollout — the 'Ink & Cinnabar' theme app-wide (cinnabar/gold/celadon palette, ink-black base with lattice texture, serif headings), all buttons reshaped to capsules, seal-style badges, the redesigned 'Bamboo Lattice' Nono chat panel (height-capped with its own scrolling, hold-to-speak, auto-scroll, and a fix for voice messages that could not be sent in chat), and Nono's AI encouragement hooks. This build does not include the new splash main visual.",
    ],
}
open(os.path.join(APP, "version.json"), "wb").write(
    json.dumps(v, ensure_ascii=False, indent=2).encode("utf-8") + b"\r\n")
print("  patched version.json")
print("OK")
