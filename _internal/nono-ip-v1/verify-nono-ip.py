# -*- coding: utf-8 -*-
"""诺诺 IP 接入（v0.22.0 起）—— 独立验收（不依赖落地脚本的自我断言）

换版本号只需改顶部 EXPECT_VER 一处（NKEY 跟着 key 数走）。

跑法：python verify-nono-ip.py
"""
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))
NODE = r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

# 🔴 唯一版本真值：换版本号只改这一处（sw.js CACHE / version.json version / APP_VERSION 都对着它断言）。
# 刻意不把版本号写死在断言里 —— v0.22.0 时硬编码 574 / 0.21.2 各误报过一轮。
EXPECT_VER = "0.23.5"

fails, warns, oks = [], [], []


def ok(m):
    oks.append(m)
    print("  ✓ " + m)


def bad(m):
    fails.append(m)
    print("  ✗ " + m)


def warn(m):
    warns.append(m)
    print("  ! " + m)


def rd(p):
    return open(p, "rb").read()


# ============================================================ A. index.html
print("\n[A] index.html")
b = rd(os.path.join(APP, "index.html"))

# A1 行尾
bare = b.count(b"\n") - b.count(b"\r\n")
(ok if bare == 0 else bad)("行尾：CRLF 完整，裸 LF = %d" % bare)

# A2 注入块位置与唯一性
i_css = b.find(b'id="nono-ip-v1-css"')
i_js = b.find(b'id="nono-ip-v1-js"')
i_body = b.rindex(b"</body>")
if i_css > 0 and i_js > i_css and i_body > i_js:
    ok("注入块存在且顺序正确（css@%d < js@%d < </body>@%d）" % (i_css, i_js, i_body))
else:
    bad("注入块位置异常 css=%d js=%d body=%d" % (i_css, i_js, i_body))
if b.count(b'id="nono-ip-v1-css"') == 1 and b.count(b'id="nono-ip-v1-js"') == 1:
    ok("注入块各出现 1 次（无重复注入）")
else:
    bad("注入块重复：css=%d js=%d" % (b.count(b'id="nono-ip-v1-css"'), b.count(b'id="nono-ip-v1-js"')))

# A3 块后无其它标签（覆盖权证明）
tail = b[i_js:]
j_end = tail.find(b"</script>") + len(b"</script>")
after = tail[j_end:]
(ok if after == b"\r\n</body>\r\n</html>\r\n" else bad)("块后仅剩收尾标签：%r" % after[:60])

# A4 启动屏
if b'src="assets/brand/nono-splash.webp"' in b:
    ok("启动屏已换 nono-splash.webp")
else:
    bad("启动屏未换")
if b"dragon-nono.svg" in b:
    warn("index.html 仍引用 dragon-nono.svg（应为 0）")

# A5 APP_VERSION
m = re.search(rb"var APP_VERSION = '([\d.]+)'", b)
v = m.group(1).decode() if m else "?"
(ok if v == EXPECT_VER else bad)("APP_VERSION = %s" % v)

# A6 语法：抽出注入的 JS 块单独 node --check
css_start = i_css - len(b"<style ")
css_blk = b[css_start:b.find(b"</style>", css_start)]
js_start = i_js - len(b"<script ")
js_blk = b[js_start:b.find(b"</script>", js_start) + len(b"</script>")]
# 去掉外层的 <style ...> / </style> / <script ...> / </script>
js_code = js_blk.split(b">\r\n", 1)[1].rsplit(b"\r\n</script>", 1)[0]
tmp = os.path.join(HERE, "_verify_extract.js")
open(tmp, "wb").write(js_code)
r = subprocess.run([NODE, "--check", tmp], capture_output=True, text=True)
(ok if r.returncode == 0 else bad)("注入 JS 块 node --check：%s" % ("通过" if r.returncode == 0 else r.stderr.strip()[:200]))
os.remove(tmp)

# A7 CSS 块内危险字符
inner_css = css_blk.split(b">", 1)[1]
(ok if b"</style" not in inner_css else bad)("注入 CSS 块内无 </style")

# A8 引用的素材是否都在磁盘上
# ⚠️ 正则必须先匹配长路径再匹配短路径：若只写 icons/xxx，会把 assets/icons/xxx
#    的尾部当成独立路径，产出「文件不存在」的误报（本轮踩过）。
refs = set()
for pat in (rb"assets/[a-zA-Z0-9_]+/[a-zA-Z0-9_.-]+",
            rb"(?<![\w/.])icons/[a-zA-Z0-9_.-]+"):
    refs |= {x.decode() for x in re.findall(pat, b)}
# 只校验静态引用：末段必须带扩展名。JS 里动态拼接的路径（如 'assets/cities/thumb_'+id）
# 末段没有点，会被误报成缺失文件（本轮踩过）。
static = {r for r in refs if "." in r.rsplit("/", 1)[-1]}
dyn = sorted(refs - static)
missing = [r for r in sorted(static) if not os.path.isfile(os.path.join(APP, r))]
if missing:
    bad("index.html 引用了不存在的静态文件：%s" % missing)
else:
    ok("index.html 的 %d 个静态素材引用全部存在（另有 %d 处动态拼接路径已跳过：%s）"
       % (len(static), len(dyn), dyn))

# A9 i18n 用法检查：UI 标签必须走 T()，且只用字典里确有的 key
used_keys = re.findall(rb"T\('([^']+)'\)", js_code)
used_keys = [k.decode("utf-8") for k in used_keys]
zd = json.loads(rd(os.path.join(APP, "langs", "zh.json")).decode("utf-8"))
missing_keys = [k for k in used_keys if k not in zd]
if missing_keys:
    bad("注入块用了字典里没有的 key（会 fallback 成英文）：%s" % missing_keys)
else:
    ok("注入块 %d 处 T() 调用的 key 全部在字典内：%s" % (len(used_keys), used_keys))
# aria-label 必须写英文源文（applyI18n 属性扫描无反向分支）
if b'aria-label="Close"' in js_code:
    ok('aria-label 写英文源文 "Close"（切语言时能被 applyI18n 正向翻译）')
else:
    warn("注入块未见 aria-label=\"Close\"，确认属性 i18n 策略")

# ==================================================== B. manifest / sw / version
print("\n[B] manifest / sw / version")
mani = os.path.join(APP, "manifest.webmanifest")
mb = rd(mani)
j = json.loads(mb.decode("utf-8"))
icons = [i["src"] for i in j["icons"]]
if "icons/icon-512.png" not in icons:
    ok("manifest 已无 icon-512.png")
else:
    bad("manifest 仍含 icon-512.png")
miss = [i for i in icons if not os.path.isfile(os.path.join(APP, i))]
(ok if not miss else bad)("manifest 图标全部存在%s" % ("" if not miss else "，缺：" + str(miss)))
if mb.count(b"\n") - mb.count(b"\r\n") == 0:
    ok("manifest 行尾 CRLF")
else:
    bad("manifest 有裸 LF")

sb = rd(os.path.join(APP, "sw.js"))
if b"icon-512.png" not in sb:
    ok("sw.js 已无死链 icon-512.png")
else:
    bad("sw.js 仍有 icon-512.png（addAll 会让 SW 装不上）")
m = re.search(rb"var CACHE = '([^']+)'", sb)
(ok if m and m.group(1).decode().endswith(EXPECT_VER) else bad)("sw.js CACHE = %s" % (m.group(1).decode() if m else "?"))
paths = re.findall(rb"'\./([^']+)'", sb)
swmiss = [p.decode() for p in paths if p.decode() not in ("",) and not os.path.isfile(os.path.join(APP, p.decode())) and p.decode() != ""]
# 处理 './' 本身（站点根）与目录
swmiss = [p for p in swmiss if not p.endswith("/")]
if swmiss:
    bad("sw.js 预缓存清单含不存在的路径：%s" % swmiss)
else:
    ok("sw.js 预缓存 %d 条路径全部存在（addAll 不会整体失败）" % len(paths))
if sb.count(b"\n") - sb.count(b"\r\n") == 0:
    ok("sw.js 行尾 CRLF")
else:
    bad("sw.js 有裸 LF")

vb = rd(os.path.join(APP, "version.json"))
vj = json.loads(vb.decode("utf-8"))
(ok if vj["version"] == EXPECT_VER else bad)("version.json version = %s" % vj["version"])
# APK 版本段自洽性 —— 不写死具体版本号（编码阶段 APK 常落后于网页版；发版后两者应相等）。
# 2026-09-12 修正：原先硬编码「预期 0.21.2」，APK 发版后必然误报。
_av = vj["apk"]["version"]
_au = vj["apk"]["url"]
if _av == vj["version"]:
    ok("version.json apk.version = %s（与网页版一致，双版本号落差已收敛）" % _av)
elif _av < vj["version"]:
    warn("version.json apk.version = %s < 网页版 %s（APK 落后 → App 用户拿不到最新改动，需出包）"
         % (_av, vj["version"]))
else:
    bad("version.json apk.version = %s > 网页版 %s（APK 不应领先网页版）" % (_av, vj["version"]))
if ("Sinoky-v%s-release.apk" % _av) in _au:
    ok("apk.url 与 apk.version 指向同一版本（%s）" % _av)
else:
    bad("apk.url 与 apk.version 不一致：url=%s version=%s" % (_au, _av))
if EXPECT_VER in vj.get("note", ""):
    ok("version.json note 已更新")
if vb.count(b"\n") - vb.count(b"\r\n") == 0:
    ok("version.json 行尾 CRLF")
else:
    bad("version.json 有裸 LF")

# ============================================================== C. 语言包
print("\n[C] 语言包")
NKEY = 587          # v0.23.5：580（v0.23.0）+ 5（诺诺记得你）+ 2（首访招手邀请）
KEYS = [
    "No worries — try again",                                      # v0.22.0 state 文案
    "Tour", "Show me around",                                      # v0.23.0 导览入口
    "Not sure where to start? Let me show you around.",            # v0.23.0 浮动邀请
    "You've seen the whole place.",                                # v0.23.0 收尾站
    "Finish", "Take me there",                                     # v0.23.0 骨架按钮
    "Practice that line",                                          # v0.23.4 记得你·按钮
    "This line has tripped you up {c} times — today we crack it.",  # v0.23.4 记得你·卡句
    "You last spoke Chinese {d} days ago — let’s pick up where you stopped.",   # v0.23.4 记得你·召回
    "Yesterday this line scored {s}. Beat it today?",              # v0.23.4 记得你·超越
    "Yesterday this line scored {s}. One more try — it will stick.",  # v0.23.4 记得你·再来
    "Say it back to me.",                                          # v0.23.5 招手邀请·邀请句
    "Say it back",                                                 # v0.23.5 招手邀请·按钮
]
LG_SET = None
for lg in ["zh", "es", "ru", "vi", "id", "th"]:
    p = os.path.join(APP, "langs", lg + ".json")
    d = json.loads(rd(p).decode("utf-8"))
    miss = [k for k in KEYS if k not in d or not d[k]]
    if len(d) != NKEY:
        bad("%s.json key 数 = %d（应 %d）" % (lg, len(d), NKEY))
    elif miss:
        bad("%s.json 缺 key %r" % (lg, miss))
    else:
        print("  ✓ %s.json %d key，%d 个关键 key 齐" % (lg, len(d), len(KEYS)))
    # 跨语言一致性：六个文件的 key 集合必须完全相同。
    # 这是「零英文 fallback」的**真实判据** —— 只数总数的话，
    # 「一处多译、另一处漏译」会互相抵消，总数照样对得上。
    s = set(d.keys())
    if LG_SET is None:
        LG_SET = (lg, s)
    elif s != LG_SET[1]:
        bad("%s.json 与 %s.json key 集合不一致（%s 多 %r / %s 多 %r）"
            % (lg, LG_SET[0], LG_SET[0], sorted(LG_SET[1] - s)[:3], lg, sorted(s - LG_SET[1])[:3]))
if LG_SET:
    print("  ✓ 六个语言文件 key 集合完全一致（%d 键）" % len(LG_SET[1]))

# ============================================================ D. landing
print("\n[D] landing")
lb = rd(os.path.join(APP, "landing", "index.html"))
(ok if lb.count(b"\r\n") == 0 else bad)("landing 行尾保持 LF")
if b"../assets/brand/nono-hero.webp" in lb:
    ok("landing hero 引用 ../assets/brand/nono-hero.webp")
else:
    bad("landing hero 未插入")
if lb.count(b"nono-hero-fig") >= 2:
    ok("landing hero 结构 + 样式均已插入")
else:
    bad("landing 样式或结构缺失（nono-hero-fig 出现 %d 次）" % lb.count(b"nono-hero-fig"))
if os.path.isfile(os.path.join(APP, "assets", "brand", "nono-hero.webp")):
    ok("nono-hero.webp 存在（部署后 ../assets/ 解析为 /assets/）")
inner = lb[lb.find(b"<style"):lb.find(b"</style>")]
if b"nono-hero-fig" in inner:
    ok("landing 样式写在自身的 style 块内")
else:
    bad("landing 样式未落在 style 块内")

# ============================================ E. 注入层功能锚点（v0.23.4 / v0.23.5）
# 为什么需要这一段：本仓库自 v0.22.0 起「新增功能主要在注入层」，而主代码里搜不到
# 注入层的实现 —— 2026-09-13 曾因此把「已做完的 3 件事」误判成待办。
# 这里用「patch.js 源 与 index.html 产物**都**含该锚点」作为判据：
# 只查产物 → 分不清是 patch 带的还是历史残留；只查源 → 分不清有没有真的注入。
print("\n[E] 注入层功能锚点")
_pb = rd(os.path.join(HERE, "patch.js"))
ANCHORS = [
    ("11 记得你·入口",          "window.nonoRecall = function"),
    ("11 记得你·冷启动重试",     "if (n < 4) setTimeout(bootRecall, 2800)"),
    ("11 记得你·不查 lockUntil", "故意不检查 NONO.lockUntil"),
    ("12 招手邀请·入口",        "window.nonoWave = function"),
    ("12 招手邀请·wave 姿态",    "pose: 'wave'"),
    ("12 招手邀请·首句出口",     "nonoPracticeKey('arrival#0')"),
    ("12 招手邀请·重试",        "if (waveLeft-- > 0)"),
    ("12 招手邀请·兜底还原",     "if (waveFb && typeof _ncg2 === 'function')"),
    ("8 导览让位·位阶条件",      "v0.23.5 位阶"),
]
_missing = []
for _name, _needle in ANCHORS:
    _nb = _needle.encode("utf-8")
    _in_src, _in_prod = _nb in _pb, _nb in b
    if _in_src and _in_prod:
        pass
    else:
        _missing.append(_name)
        bad("%s 锚点缺失（patch.js=%s / index.html=%s）" % (_name, _in_src, _in_prod))
if not _missing:
    ok("注入层功能锚点 %d/%d 全中（patch 源与 index 产物一致）" % (len(ANCHORS), len(ANCHORS)))

# ============================================================ 汇总
print("\n" + "=" * 62)
print("通过 %d 项，告警 %d 项，失败 %d 项" % (len(oks), len(warns), len(fails)))
if fails:
    print("\n失败明细：")
    for f in fails:
        print("  ✗ " + f)
if warns:
    print("\n告警明细：")
    for w in warns:
        print("  ! " + w)
sys.exit(1 if fails else 0)
