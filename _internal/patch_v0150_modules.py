# -*- coding: utf-8 -*-
"""v0.15.0 实施：中式模块层 M1-M10 + 5 枚导航图标 + 主视觉接回 + 四处版本同步"""
import json, os, re

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
P = os.path.join(APP, "index.html")
H = open(P, "rb").read().decode("utf-8", "replace")
GOLD = "#c9a86c"


def uri(svg):
    """内联 SVG → data-URI（只编码必要字符）"""
    s = svg.replace("\n", "").replace("  ", " ")
    s = s.replace("#", "%23").replace("<", "%3C").replace(">", "%3E").replace('"', "'")
    return "data:image/svg+xml," + s


def corner(dx, dy):
    """如意云头角花：dx/dy 控制朝向（1=正向 -1=镜像）"""
    def X(v):  # 相对 22 网格做水平镜像
        return v if dx > 0 else 22 - v

    def Y(v):
        return v if dy > 0 else 22 - v
    a = f"M{X(1)},{Y(21)} V{Y(13)} C{X(1)},{Y(6)} {X(6)},{Y(1)} {X(13)},{Y(1)} H{X(21)}"
    b = f"M{X(4)},{Y(21)} V{Y(15)} C{X(4)},{Y(9)} {X(9)},{Y(4)} {X(15)},{Y(4)} H{X(21)}"
    return uri(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"><g fill="none" stroke="{GOLD}" stroke-width="1.3" stroke-linecap="round" opacity="0.5"><path d="{a}"/><path d="{b}" opacity="0.6"/></g></svg>')


HUI = uri(f'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="7" viewBox="0 0 8 7"><path d="M1,6 V1 H7 V6 H3 V3 H5" fill="none" stroke="{GOLD}" stroke-width="0.9" stroke-linejoin="round"/></svg>')
CLOUD = uri(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 12"><g fill="none" stroke="{GOLD}" stroke-width="2.1" stroke-linecap="round"><path d="M2,11 H28"/><circle cx="10" cy="6.4" r="4.4"/><circle cx="20" cy="5.6" r="5.4"/></g></svg>')
SCALE = uri(f'<svg xmlns="http://www.w3.org/2000/svg" width="11" height="7" viewBox="0 0 11 7"><g fill="none" stroke="{GOLD}" stroke-width="1.1"><path d="M0,7 A5.5,5.5 0 0 1 11,7"/><path d="M-5.5,3 A5.5,5.5 0 0 1 5.5,3 M5.5,3 A5.5,5.5 0 0 1 16.5,3"/></g></svg>')

CSS = """
/* ===== 中式模块层 v1（M1-M10）· v0.15.0 ===== */
:root{--gold-dim:#8a7448;--paper:#f5f1e8}

/* M1 卡片：四角如意云头 + 底边回纹带（纹样只在边缘，中央留白） */
.hub,.card{position:relative;background-color:var(--card);border-color:var(--line);
  background-repeat:no-repeat;
  background-image:url("__CTL__"),url("__CTR__"),url("__CBL__"),url("__CBR__");
  background-position:7px 7px,calc(100% - 7px) 7px,7px calc(100% - 7px),calc(100% - 7px) calc(100% - 7px);
  background-size:20px 20px}
.hub::after,.card::after{content:"";position:absolute;left:14px;right:14px;bottom:7px;height:7px;
  background-image:url("__HUI__");background-repeat:repeat-x;background-size:8px 7px;opacity:.3;pointer-events:none}

/* M3 按钮：内嵌金环（雕刻感来自双层线，不加纹理） */
.btn{box-shadow:inset 0 0 0 1px rgba(201,168,108,.42)}
.btn.ghost{background:none;box-shadow:inset 0 0 0 1px var(--gold-dim)}
.record{box-shadow:inset 0 0 0 1px rgba(201,168,108,.34)}

/* M10 表单与分段器 */
input,textarea{border-radius:99px;box-shadow:inset 0 0 0 1px rgba(201,168,108,.24)}
textarea{min-height:110px;border-radius:18px}
.seg button{border-radius:99px}
.seg button.on{box-shadow:inset 0 0 0 1px rgba(201,168,108,.5)}

/* M4 底部导航：金线 + 回纹收尾 + 选中项祥云托底 + 图标随选中态变色 */
body>nav{background:rgba(22,26,32,.94);border-top:1px solid rgba(201,168,108,.42)}
body>nav::after{content:"";position:absolute;right:12px;top:6px;width:36px;height:7px;
  background-image:url("__HUI__");background-repeat:repeat-x;background-size:8px 7px;opacity:.32;pointer-events:none}
body>nav button{position:relative}
body>nav button.on::before{content:"";position:absolute;top:1px;left:50%;width:28px;height:9px;margin-left:-14px;
  background-image:url("__CLOUD__");background-repeat:no-repeat;background-size:contain;opacity:.9;pointer-events:none}
.navico{display:block;width:22px;height:22px;background-color:currentColor;margin-bottom:1px;
  -webkit-mask-position:center;-webkit-mask-repeat:no-repeat;-webkit-mask-size:contain;
  mask-position:center;mask-repeat:no-repeat;mask-size:contain}
__MASKURLS__

/* M7 徽章印章化：圆形 + 金环 + 外圈淡金晕 */
.badge-cell img{border-radius:50%;box-shadow:0 0 0 2px var(--gold),0 0 0 7px rgba(201,168,108,.1)}
.badge-cell:not(.on) img{box-shadow:0 0 0 2px var(--gold-dim),0 0 0 7px rgba(138,116,72,.08)}

/* M6 龙鳞进度（进度＝奖励＝鎏金，替换旧红渐变） */
.pbar{height:9px;background-color:var(--bg2);background-image:url("__SCALE__");background-repeat:repeat-x;background-size:11px 7px}
.pbar i{background:linear-gradient(90deg,var(--gold),var(--paper))}

/* M5 页头：回纹收边 */
header{position:relative;padding-bottom:16px}
header::after{content:"";position:absolute;left:0;right:0;bottom:0;height:7px;
  background-image:url("__HUI__");background-repeat:repeat-x;background-size:8px 7px;opacity:.28}

/* 启动屏：主视觉接回（深青品牌底 + Sino<k>y 衬线字标） */
#splash{background:#17423D;flex-direction:column;gap:1.6vh}
#splash img{width:100%;max-width:430px;height:auto;max-height:70vh;border-radius:0}
#splash .sp-brand{font-family:"Songti SC","STSong","Noto Serif SC","SimSun",serif;font-size:30px;font-weight:800;letter-spacing:.6px;color:#F5F1E8;line-height:1}
#splash .sp-brand b{color:var(--red);font-weight:800}
"""

MASK = "\n".join(
    f'.navico-{n}{{-webkit-mask-image:url(assets/icons/nav-{n}.svg);mask-image:url(assets/icons/nav-{n}.svg)}}'
    for n in ["home", "practice", "explore", "prog", "me"])

CSS = (CSS.replace("__CTL__", corner(1, 1)).replace("__CTR__", corner(-1, 1))
          .replace("__CBL__", corner(1, -1)).replace("__CBR__", corner(-1, -1))
          .replace("__HUI__", HUI).replace("__CLOUD__", CLOUD).replace("__SCALE__", SCALE)
          .replace("__MASKURLS__", MASK))

# ---------- 1. 注入 CSS（插到 </head> 前，确保 source order 最后） ----------
assert H.count("</head>") == 1
H = H.replace("</head>", f'<style id="cn-modules">{CSS}</style>\r\n</head>')

# ---------- 2. 导航图标统一为中式线稿（mask，随 currentColor） ----------
old_nav = re.search(r'<nav>.*?</nav>', H, re.S).group(0)
new_nav = ('<nav>'
           '<button id="nav-home" class="on" onclick="go(\'home\')"><span class="navico navico-home"></span>Home</button>'
           '<button id="nav-practice" onclick="go(\'practice\')"><span class="navico navico-practice"></span>Practice</button>'
           '<button id="nav-explore" onclick="go(\'explore\')"><span class="navico navico-explore"></span>Explore</button>'
           '<button id="nav-prog" onclick="go(\'prog\')"><span class="navico navico-prog"></span>Progress</button>'
           '<button id="nav-me" onclick="go(\'me\')"><span class="navico navico-me"></span>Me</button>'
           '</nav>').replace("\n", "\r\n")
H = H.replace(old_nav, new_nav)

# ---------- 3. 启动屏接回主视觉 ----------
old_sp = '<div id="splash"><img src="assets/splash/a8_9x16.webp" alt="Sinoky" onerror="this.parentNode.remove()"></div>'
assert H.count(old_sp) == 1
H = H.replace(old_sp, '<div id="splash"><div class="sp-brand">Sino<b>k</b></div><img src="assets/brand/dragon-nono.svg" alt="Sinoky" onerror="this.parentNode.remove()"></div>')

# ---------- 4. 四处版本同步 → 0.15.0 ----------
def one(old, new, label):
    global H
    assert H.count(old) == 1, f"{label}: {H.count(old)} matches"
    H = H.replace(old, new)


one("var APP_VERSION = '0.14.11';", "var APP_VERSION = '0.15.0';", "APP_VERSION")
one("var CACHE = 'sinoky-v0.14.11';", "var CACHE = 'sinoky-v0.15.0';", "SW CACHE") if False else None
open(P, "wb").write(H.encode("utf-8"))
print("index.html written | bare LF:", H.count("\n") - H.count("\r\n"))

# sw.js
sw = open(os.path.join(APP, "sw.js"), "rb").read().decode("utf-8", "replace")
assert sw.count("var CACHE = 'sinoky-v0.14.11';") == 1
open(os.path.join(APP, "sw.js"), "wb").write(sw.replace("var CACHE = 'sinoky-v0.14.11';", "var CACHE = 'sinoky-v0.15.0';").encode("utf-8"))

# download.html
dl = open(os.path.join(APP, "download.html"), "rb").read().decode("utf-8", "replace")
assert dl.count("Sinoky-v0.14.11-release.apk") == 1
open(os.path.join(APP, "download.html"), "wb").write(dl.replace("Sinoky-v0.14.11-release.apk", "Sinoky-v0.15.0-release.apk").encode("utf-8"))

# version.json
v = {
    "version": "0.15.0",
    "updated": "2026-09-11",
    "note": "v0.15.0：中式模块化设计落地——按《中式模块化设计规范 v1》实施：卡片四角如意云头 + 底边回纹带、按钮内嵌金环、底部导航统一为五枚中式线稿图标（回纹门楼/竹简与笔/祥云罗盘/龙鳞阶/朱砂印，随选中态变色）+ 顶部金线与祥云托底、输入框胶囊化 + 内嵌金线、勋章印章化（圆形金环）、进度条改鎏金龙鳞（进度即奖励）、页头回纹收边；新增 --gold-dim / --paper 变量；启动屏上线「金龙盘诺诺」主视觉（鎏金中国龙盘绕怀抱青竹的诺诺）。",
    "apk": {"versionCode": 1500, "version": "0.15.0",
            "url": "https://sinoky.pages.dev/apk/Sinoky-v0.15.0-release.apk", "md5": "", "size": 0},
    "noteEn": ["v0.15.0: Chinese modular design system rollout — ruyi corner ornaments and meander bands on cards, inset gold rings on buttons, five Chinese line-art nav icons (gate/panda-bamboo-slip/compass/scale-steps/seal) that follow the selected state, gold hairline and cloud topper on the tab bar, capsule inputs with inset gold rules, seal-style badges, a gilded scale progress bar, and meander page-header rules. New theme variables --gold-dim and --paper. The 'Golden Dragon & Nono' splash is now live."],
}
open(os.path.join(APP, "version.json"), "wb").write(json.dumps(v, ensure_ascii=False, indent=2).encode("utf-8") + b"\r\n")

print("版本四处同步 → 0.15.0")
print("  APP_VERSION:", re.search(r"APP_VERSION = '[^']*'", H).group(0))
print("  SW:", re.search(r"var CACHE = '[^']*'", open(os.path.join(APP,'sw.js'),encoding='utf-8').read()).group(0))
print("  download:", re.search(r'Sinoky-v[0-9.]+-release\.apk', open(os.path.join(APP,'download.html'),encoding='utf-8').read()).group(0))
print("  version.json:", v["version"], v["apk"]["versionCode"])
