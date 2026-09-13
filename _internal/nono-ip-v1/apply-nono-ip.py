# -*- coding: utf-8 -*-
"""v0.22.0 诺诺 IP 产品内接入 —— 落地脚本（可重复执行，幂等）

改动清单（共 5 个文件）：
  1. index.html          启动屏换定妆图 + APP_VERSION 升 0.22.0 + 注入 patch.css/patch.js
  2. manifest.webmanifest icon-512.png → icon-512.webp（含 maskable 两项）
  3. sw.js               CACHE 版本号 + 修已删图标的死链 + 预缓存新素材
  4. landing/index.html  hero 加诺诺 + 一句可跟读中文
  5. version.json        version 0.22.0 + note

铁律（照 single-file-pwa-append-only-patch / build-manifest-integrity-gate）：
  · 全程 'rb' 读 / 'wb' 写，绝不用 text 模式（默认换行转换会让行数翻倍）
  · 每个文件保持自己的原始行尾（index.html/sw.js/manifest/version/langs = CRLF，
    landing = LF），注入块先归一化，写完断言裸 LF == 0
  · 注入块落在 </body> 之前，写完断言「自己的 style/script 是最后一个」
  · 幂等：标记已存在则跳过对应步骤
  · 依赖闭包：sw.js 预缓存清单里每个路径先断言磁盘上存在（addAll 全有全无，
    任一 404 → SW 直接装不上 → 整站离线能力失效）
"""
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))
PATCH_CSS = os.path.join(HERE, "patch.css")
PATCH_JS = os.path.join(HERE, "patch.js")

NEW_VER = "0.23.1"
OLD_VER = "0.23.0"

log = []


def p(*a):
    print(*a)
    log.append(" ".join(str(x) for x in a))


def rd(path):
    return open(path, "rb").read()


def wr(path, data):
    open(path, "wb").write(data)


def to_crlf(b):
    return re.sub(rb"(?<!\r)\n", b"\r\n", b)


def assert_no_bare_lf(b, name):
    n = b.count(b"\n") - b.count(b"\r\n")
    assert n == 0, "%s 写入后出现 %d 个裸 LF" % (name, n)


# ---------------------------------------------------------------- 1. index.html
CSS_ID = b'id="nono-ip-v1-css"'
JS_ID = b'id="nono-ip-v1-js"'


def step_index():
    path = os.path.join(APP, "index.html")
    b = rd(path)
    orig_len = len(b)
    assert b.count(b"</body>") == 1, "</body> 不唯一"
    assert_no_bare_lf(b, "index.html(原)")

    # --- 1a. 启动屏：龙标 SVG → 诺诺定妆图 ---
    if b'src="assets/brand/nono-splash.webp"' in b:
        p("  [1a] 启动屏已是定妆图，跳过")
    else:
        old = b'src="assets/brand/dragon-nono.svg"'
        assert b.count(old) == 1, "dragon-nono.svg 引用数异常：%d" % b.count(old)
        b = b.replace(old, b'src="assets/brand/nono-splash.webp"')
        p("  [1a] 启动屏 → assets/brand/nono-splash.webp")

    # --- 1b. APP_VERSION（三处同步铁律之一）---
    oldv = ("var APP_VERSION = '%s';" % OLD_VER).encode()
    newv = ("var APP_VERSION = '%s';" % NEW_VER).encode()
    if oldv in b:
        assert b.count(oldv) == 1
        b = b.replace(oldv, newv)
        p("  [1b] APP_VERSION %s → %s" % (OLD_VER, NEW_VER))
    else:
        assert newv in b, "APP_VERSION 既不是 %s 也不是 %s" % (OLD_VER, NEW_VER)
        p("  [1b] APP_VERSION 已是 %s，跳过" % NEW_VER)

    # --- 1c. 注入 patch.css / patch.js ---
    anchor = b"</body>"
    MARK = b"<!-- ===== v0.22.0 Nono IP"
    css = to_crlf(rd(PATCH_CSS))
    js = to_crlf(rd(PATCH_JS))
    # 标签字面量守卫：块内出现 </style / </script 会提前闭合；
    # 出现 <style / <script 会让「自己是最后一个」的位置断言失效（本轮踩过）
    for name, blob in (("patch.css", css), ("patch.js", js)):
        for bad in (b"</style", b"</script", b"<style", b"<script"):
            assert bad not in blob, "%s 含标签字面量 %r" % (name, bad)

    # ⚠️ 块首**不带**前导 \r\n：b.rindex(MARK) 定位到 "<!--" 本身、不含它前面的换行，
    #    若块自带前导 \r\n 且它已存在，每跑一次就多一个空行（+2 B，非幂等）。
    #    v0.23.3 修：原写法带 \r\n，只有在「首次注入」时才正确，重跑会持续膨胀。
    blk = (b"<!-- ===== v0.22.0 Nono IP \xe6\x8e\xa5\xe5\x85\xa5\xe5\xb1\x82"
           b"\xef\xbc\x88\xe7\xba\xaf\xe8\xbf\xbd\xe5\x8a\xa0\xef\xbc\x89"
           b" ===== -->\r\n"
           b'<style ' + CSS_ID + b">\r\n" + css + b"\r\n</style>\r\n"
           b'<script ' + JS_ID + b">\r\n" + js + b"\r\n</script>\r\n")

    i = b.rindex(anchor)
    if MARK in b:
        s = b.rindex(MARK)
        assert s < i, "注入块标记出现在 </body> 之后，文件结构异常"
        old = b[s:i]
        assert b"</script>" in old and b"</style>" in old, "旧块不完整"
        b = b[:s] + blk + b[i:]
        p("  [1c] 替换既有注入块（旧 %d B → 新 %d B）" % (len(old), len(blk)))
    else:
        b = b[:i] + blk + b[i:]
        p("  [1c] 注入 patch.css(%d B) + patch.js(%d B) @ </body> 之前" % (len(css), len(js)))

    # --- 断言：块尾到文件末之间只剩收尾标签，且自己的位置在最后 ---
    tail = b[b.rindex(anchor):]
    assert tail == b"</body>\r\n</html>\r\n", "块后有多余内容：%r" % tail[:80]
    assert b.count(CSS_ID) == 1 and b.count(JS_ID) == 1, "注入块重复"
    assert b.index(CSS_ID) < b.index(JS_ID) < b.rindex(anchor), "注入块顺序异常"
    # tail 断言已经足够强：注入块之后不存在任何其它标签（含 style/script），
    # 故本层在 source order 上必然最后 → 同名函数/选择器的覆盖必然生效。
    assert b.rindex(b"</body>") == b.rindex(anchor)
    assert_no_bare_lf(b, "index.html(新)")
    wr(path, b)
    p("  [1c] ✓ 断言通过：patch 是最后一个 style/script；%d → %d B" % (orig_len, len(b)))


# --------------------------------------------------- 2. manifest.webmanifest
def step_manifest():
    path = os.path.join(APP, "manifest.webmanifest")
    b = rd(path)
    if b"icon-512.webp" in b:
        p("  [2] manifest 已更新，跳过")
        return
    old = b'icons/icon-512.png'
    assert b.count(old) == 2, "manifest 里 icon-512.png 引用数 = %d（应为 2）" % b.count(old)
    b = b.replace(old, b"icons/icon-512.webp")
    b = b.replace(b'"src": "icons/icon-512.webp", "sizes": "512x512", "type": "image/png"',
                  b'"src": "icons/icon-512.webp", "sizes": "512x512", "type": "image/webp"')
    j = json.loads(b.decode("utf-8"))
    assert sum(1 for i in j["icons"] if i["src"].endswith(".webp")) == 2
    assert all(i["type"] == "image/webp" for i in j["icons"] if i["src"].endswith(".webp"))
    assert_no_bare_lf(b, "manifest")
    wr(path, b)
    p("  [2] manifest：icon-512.png → icon-512.webp ×2（any + maskable），type → image/webp")


# ------------------------------------------------------------------- 3. sw.js
PRECACHE = [
    "./icons/logo-header.png",
    "./assets/brand/nono-splash.webp",
    "./assets/brand/nono-hero.webp",
    "./assets/brand/nono-share.webp",
    "./assets/mascot/like.webp",
    "./assets/mascot/cheer.webp",
    "./assets/mascot/think.webp",
    "./assets/mascot/listen.webp",
    "./assets/mascot/sorry.webp",
    "./assets/mascot/point.webp",
    "./assets/mascot/wave.webp",
    "./assets/mascot/note.webp",
    "./assets/empty/general.webp",
    "./assets/empty/network.webp",
    "./assets/empty/study.webp",
]


def step_sw():
    path = os.path.join(APP, "sw.js")
    b = rd(path)

    # 3a. 依赖闭包前置断言：每个预缓存路径必须真实存在
    for rel in PRECACHE:
        assert rel.startswith("./"), rel
        fp = os.path.join(APP, rel[2:].replace("/", os.sep))
        assert os.path.isfile(fp), "预缓存路径不存在（addAll 会整体失败）：%s" % rel

    if b"sinoky-v%s" % NEW_VER.encode() in b:
        p("  [3] sw.js 已更新，跳过")
        return

    # 3b. 死链修复：icon-512.png 已删，留在 addAll 里会让 SW 装不上
    old_icon = b"'./icons/icon-512.png',"
    assert b.count(old_icon) == 1, "sw.js 死链引用数 = %d" % b.count(old_icon)
    b = b.replace(old_icon, b"'./icons/icon-512.webp',")

    # 3c. CACHE 版本号
    oldc = ('var CACHE = \'sinoky-v%s\';' % OLD_VER).encode()
    if oldc in b:
        assert b.count(oldc) == 1
        b = b.replace(oldc, ('var CACHE = \'sinoky-v%s\';' % NEW_VER).encode())

    # 3d. 追加预缓存（插在 favicon 行之后）
    anchor = b"'./icons/favicon-32.png',"
    assert b.count(anchor) == 1
    add = (b"\r\n  /* v0.22.0 \xe8\xaf\xba\xe8\xaf\xba IP\xef\xbc\x9a\xe5\xae\x9a\xe5\xa6\x86\xe5\x9b\xbe + 8 \xe5\xa7\xbf\xe6\x80\x81 + 3 \xe7\xa9\xba\xe6\x80\x81"
           b"\xe3\x80\x82\xe5\x85\xa8\xe9\x83\xa8\xe6\x9c\xac\xe5\x9c\xb0\xe8\xb5\x84\xe6\xba\x90\xef\xbc\x8c\xe6\x8e\xa5\xe5\x9c\xb0\xe5\x8d\xb3\xe7\x94\xa8"
           b"\xe3\x80\x82 */\r\n  "
           + b",\r\n  ".join(x.encode() for x in PRECACHE) + b",")
    b = b.replace(anchor, anchor + add)

    assert b.count(b"icon-512.png") == 0, "sw.js 仍残留 icon-512.png"
    assert_no_bare_lf(b, "sw.js")
    wr(path, b)
    p("  [3] sw.js：CACHE %s→%s，死链 icon-512.png→webp，预缓存 +%d 项（均已断言存在）"
      % (OLD_VER, NEW_VER, len(PRECACHE)))


# --------------------------------------------------------- 4. landing/index.html
LANDING_CSS = """
/* ---------- hero: Nono（v0.22.0）----------
   Edify Gate：诺诺每多出场一次，就要多换来一句中文 —— 这里换的是「你好」。 */
.nono-hero{display:flex; align-items:center; justify-content:center; gap:clamp(10px,3vw,32px);
  margin:28px auto 0; max-width:680px; flex-wrap:wrap}
.nono-hero-fig{width:clamp(148px,25vw,224px); height:auto; display:block;
  filter:drop-shadow(0 18px 34px rgba(0,0,0,.55))}
.nono-say{text-align:left; min-width:196px}
.ns-lb{display:block; font-size:11.5px; font-weight:700; letter-spacing:.09em;
  text-transform:uppercase; color:var(--teal); margin-bottom:7px}
.ns-hz{display:block; font-size:clamp(30px,5.2vw,44px); font-weight:800; line-height:1.1}
.ns-py{display:block; font-size:15px; font-weight:700; color:var(--red); margin-top:3px; letter-spacing:.02em}
.ns-en{display:block; font-size:13.5px; color:var(--sub); margin-top:7px}
@media(max-width:560px){.nono-say{text-align:center}.nono-hero{gap:4px; margin-top:22px}}
"""

LANDING_HTML = """
      <!-- v0.22.0 诺诺 IP：hero 角色 + 一句可跟读中文 -->
      <div class="nono-hero">
        <img class="nono-hero-fig" src="../assets/brand/nono-hero.webp" width="480" height="600"
             alt="Nono, the Sinoky panda, in a cream hoodie" loading="eager" decoding="async">
        <div class="nono-say">
          <span class="ns-lb">Nono says</span>
          <span class="ns-hz">你好</span>
          <span class="ns-py">nǐ hǎo</span>
          <span class="ns-en">= hello. Now say it out loud.</span>
        </div>
      </div>
"""


def step_landing():
    path = os.path.join(APP, "landing", "index.html")
    b = rd(path)
    assert b.count(b"\r\n") == 0, "landing 原本是 LF，出现 CRLF 了"
    if b"nono-hero-fig" in b:
        p("  [4] landing 已更新，跳过")
        return

    # 4a. 素材存在性（landing 用 ../assets/，部署后 www/ 下与 assets/ 同级）
    fp = os.path.join(APP, "assets", "brand", "nono-hero.webp")
    assert os.path.isfile(fp), fp

    # 4b. CSS 插在 </style> 之前
    i = b.index(b"</style>")
    b = b[:i] + LANDING_CSS.encode("utf-8") + b[i:]

    # 4c. 结构插在 .sub 段之后、.cta 之前
    anchor = b'      <div class="cta">'
    assert b.count(anchor) == 1, ".cta 锚点数 = %d" % b.count(anchor)
    b = b.replace(anchor, LANDING_HTML.encode("utf-8")[1:] + anchor)

    assert b"nono-hero-fig" in b and b"../assets/brand/nono-hero.webp" in b
    assert b.count(b"\r\n") == 0, "landing 写完出现 CRLF"
    wr(path, b)
    p("  [4] landing：hero 加诺诺定妆图 + 「你好 / nǐ hǎo」跟读行")


# --------------------------------------------------------------- 5. version.json
# 历史留档：v0.22.0 那一次发版的 version.json note 原文。
# 现已改由发版 SOP 撰写（§1 四处同步），本脚本**不再写入 note**。
NOTE_V0220_HISTORY = (
    "v0.22.0：诺诺 IP 产品内接入 —— 「墨韵·朱砂」米白真龙盘字卫衣定妆版上线（基准资产 "
    "nono-looklocked-D-quarter-1024x1024.png）。"
    "① 全站形象收口：启动屏 / 分享卡 / App 图标 / 三张空态 / 浮标 / 面板六处全部换成同一张 "
    "3D 定妆资产，消除「App 内手绘 2D 描边 + 品牌位 3D 软渲染」两套诺诺并存的分裂。"
    "② 姿态 4 张 → 8 张（like/cheer/think/sorry/listen/point/wave/note），每姿绑一句中文 —— "
    "Edify Gate：诺诺每多出现一次，就要多换来一句中文。"
    "③ 主练习页(v-scene) 与阅读打分(v-scenes-read) 首次有诺诺出场，走新增的「边角胶囊」通道："
    "不展开 340px 面板、不消耗每日 4 次主动气泡配额，主视觉仍然让给句子（主路径诺诺只占边角）。"
    "④ 失败态语义修正：原 sorry 状态文案「Nono 在帮你…」与实际触发位（录音失败 / 麦克风被拦 / "
    "打分 acc<70）不符，改为「No worries — try again」。"
    "⑤ 打分结果绑「Practice again」动作条，点一下回到同一句重录（原先只有气泡、没有下一步动作）。"
    "⑥ 分享卡补诺诺 —— 原先纯 Canvas 合成、零 IP，是唯一的社交传播出口。"
    "⑦ App 图标 151.5KB → 31.9KB：3D 柔和渐变下 PNG 量化压不到 60KB（64 色仍 69.6KB 且失真），"
    "改 WebP q88。"
    "⑧ 语言包 6 语言各 +1 key（'No worries — try again'），仍保持 574 key 全覆盖、零英文 fallback。"
    "⑨ sw.js 预缓存同步：原先引用的 icons/icon-512.png 已删，而 caches.addAll 是全有全无 —— "
    "任一 404 会让 SW 整个装不上、整站离线能力失效；一并修掉并补入新素材。"
    "⑩ 落地页 hero 加诺诺 + 一句可跟读中文（你好 / nǐ hǎo）。"
    "网页版 v0.22.0；APK 未重出，apk.version 仍为 v0.21.2。"
)


def step_version():
    path = os.path.join(APP, "version.json")
    b = rd(path)
    j = json.loads(b.decode("utf-8"))
    if j.get("version") != OLD_VER:
        # 🔴 版本号与发布注记归发版 SOP（§1 四处同步）统一管理。
        # 本脚本只在「确实是 OLD_VER → NEW_VER 那一次」才动 version.json，
        # 其余一切情况跳过 —— 否则会把当前版本的发布注记覆盖成历史文案
        # （原 NOTE 是 v0.22.0 文案，已改名 NOTE_V0220_HISTORY，不再写盘）。
        p("  [5] version.json = %s（非 %s），跳过（版本号归发版 SOP 管）"
          % (j.get("version"), OLD_VER))
        return
    j["version"] = NEW_VER
    j["updated"] = "2026-09-12"
    out = json.dumps(j, ensure_ascii=False, indent=2)
    out = to_crlf(out.encode("utf-8"))
    assert_no_bare_lf(out, "version.json")
    wr(path, out)
    # 双版本号体系：确认 apk 段没被碰
    j2 = json.loads(rd(path).decode("utf-8"))
    assert j2["apk"]["version"] == OLD_VER, "APK 段被误改"
    p("  [5] version.json：version %s → %s（apk.version 保持 %s 未动）" % (OLD_VER, NEW_VER, OLD_VER))


def main():
    p("=== 诺诺 IP 接入：落地 / 重跑（幂等，v0.23.0）===")
    step_index()
    step_manifest()
    step_sw()
    step_landing()
    step_version()
    p("=== 全部完成 ===")


if __name__ == "__main__":
    main()
