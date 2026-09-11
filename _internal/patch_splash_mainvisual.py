# -*- coding: utf-8 -*-
"""把「金龙盘诺诺」主视觉接进启动屏：深青品牌底 + 主视觉 SVG + Sino<k>y 字标"""
import os

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
    print(f"patched {path} | bare LF: {bare}")


patch("index.html", [
    (
        "#splash{position:fixed;inset:0;z-index:9999;background:#141a24;display:flex;align-items:center;justify-content:center;transition:opacity .45s ease}",
        "#splash{position:fixed;inset:0;z-index:9999;background:#17423D;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.6vh;transition:opacity .45s ease}",
    ),
    (
        "#splash img{width:auto;height:78vh;max-width:92vw;object-fit:contain;border-radius:18px}",
        "#splash img{width:100%;max-width:430px;height:auto;max-height:70vh;object-fit:contain}\n"
        "#splash .sp-brand{font-family:\"Songti SC\",\"STSong\",\"Noto Serif SC\",\"SimSun\",serif;font-size:30px;font-weight:800;letter-spacing:.6px;color:#F5F1E8;line-height:1}\n"
        "#splash .sp-brand b{color:#D8402F;font-weight:800}",
    ),
    (
        '<div id="splash"><img src="assets/splash/a8_9x16.webp" alt="Sinoky" onerror="this.parentNode.remove()"></div>',
        '<div id="splash"><div class="sp-brand">Sino<b>k</b>y</div><img src="assets/brand/dragon-nono.svg" alt="Sinoky" onerror="this.parentNode.remove()"></div>',
    ),
])

patch("sw.js", [
    ("var CACHE = 'sinoky-v0.14.8b';", "var CACHE = 'sinoky-v0.14.8c';"),
])
print("OK")
