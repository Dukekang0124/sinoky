# -*- coding: utf-8 -*-
"""v0.23.6 版本号同步（幂等）—— 分享卡二维码（网页线）

本轮**只发网页线**（APK 保持 v0.23.4）：
  · 分享卡是传播出口，本轮让「分享出去的图片自己能被扫」；
  · 存量 App 用户只有 ~27 台设备，出包成本（CI + 核验 + 回填 + 生产验证）
    仍大于覆盖面 ⇒ 建议攒到下次 App 端实质改动一起出；
  · ⚠️ 与 v0.23.5 不同：本改动**对所有用户的分享卡都生效**（不限于新用户），
    所以「要不要出包」是**覆盖 vs 成本**的权衡，不是「收益为零」。
⇒ version.json 的 apk 段**一个字都不动**（已存在的 APK 仍可下载），
   verify-nono-ip.py 对「apk.version < 网页版」只 warn 不 fail，是预期落差。

四处／五处同步：
  ① index.html   var APP_VERSION
  ② sw.js        var CACHE
  ③ version.json 顶层 version + note + noteEn[0]（apk 段不动）
  ④ verify-nono-ip.py  EXPECT_VER（静态验收的唯一版本真值）
  ⑤ download.html 不动（兜底链接仍指 v0.23.4 的真实 APK）

三重闸门（写盘前）：每处精确替换命中数必须 == 1；写盘前 json.loads 必须通过；
行尾原样保持（不把 LF 全量转 CRLF）。

幂等：以「已是 0.23.6」判定，重复运行 0 变化。
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))

OLD = '0.23.5'
NEW = '0.23.6'

NOTE = (
    "v0.23.6：分享卡加二维码 —— 让分享出去的那张卡自己能被扫。"
    "以前分享卡只画一行纯链接文字，老外拿到图还得手打网址，在群里、线下基本传不动；"
    "现在卡片页脚中央画一枚二维码，扫它就直达这张卡指向的同一件事。"
    "① 二维码编码的是分享卡的实时链接（SHARE.link()，含 8 位归因码与主题参数），"
    "不是固定的 /download —— 这样每一次被转发都记在分享者名下，归因才有据可查；"
    "也让扫码者落在他自己的界面语言与那句中文上（句子卡还带 &l=场景:序号）。"
    "② 因此二维码必须在运行时生成（归因码每次随机，无法预生成静态图），"
    "内联 qrcode-generator v1.4.4（MIT，Kazuhiko Arase）在本地算矩阵，零网络请求、零新增 KV 写。"
    "③ 画在页脚中央而非设计稿原定的右下角 —— 右下角自 v0.22.0 起已被诺诺占住；"
    "居中后与左侧字标、右侧印章、右下诺诺三者都不重叠。"
    "④ 可扫性按四条硬约束做：纠错 M、quiet zone 4 模块、模块像素取整（不缩放）、"
    "米白底 + 近黑模块；底板圆角必须小于 quiet zone 的像素宽 —— 实测圆角 18px 会切掉三个定位图案"
    "（finder pattern），二维码「看着完全正常但扫不出」，这是只有独立解码才能发现的坑。"
    "⑤ 无新增文案（6 语言字典不动）、无新增埋点、无新增网络请求与 KV 写；"
    "扫码侧的归因沿用既有 ?s= 通道，不新增统计口径。"
    "本改动对所有用户的分享卡都生效（不限于新用户）。本轮只发网页版；APK 仍为 v0.23.4。"
)

EN0 = (
    "v0.23.6: QR code on the share card - the image you share can now be scanned. "
    "Previously the share card drew only a plain URL string, so anyone receiving the image had to type the "
    "address by hand and it barely travelled in group chats or offline; now a QR code is drawn in the footer "
    "centre, and scanning it opens exactly what that card points to. (1) The code encodes the share card's live "
    "link (SHARE.link(), including the 8-character attribution code and theme parameter), not a fixed /download - "
    "so every forward is credited to the person who shared it and attribution is actually verifiable; it also "
    "lands the scanner on their own interface language and that one Chinese line (sentence cards also carry "
    "&l=scene:index). (2) The code therefore has to be generated at runtime (the attribution code is random each "
    "time, so a pre-baked static image is impossible); qrcode-generator v1.4.4 (MIT, Kazuhiko Arase) is inlined "
    "to compute the matrix locally, with zero network requests and zero new KV writes. (3) It is drawn in the "
    "footer centre rather than the bottom-right corner of the original design, which has been occupied by Nono "
    "since v0.22.0; centred, it overlaps neither the wordmark on the left, the seal on the right, nor Nono. "
    "(4) Scannability follows four hard rules: error correction M, a 4-module quiet zone, integer module pixels "
    "(no scaling), and a cream background with near-black modules; the plate's corner radius must stay below the "
    "quiet zone's pixel width - at 18px it clips three finder patterns and the code becomes \"looks fine but will "
    "not scan\", a class of bug only independent decoding can catch. (5) No new strings (the 6-language "
    "dictionaries are untouched), no new analytics and no new writes; scan-side attribution reuses the existing "
    "?s= channel. This applies to every user's share card, not just new users. Web only this round; the APK "
    "stays at v0.23.4."
)


def read_text(p):
    return io.open(p, 'rb').read().decode('utf-8')


def eol_of(raw):
    return '\r\n' if raw.count('\r\n') > 0 else '\n'


def write_same_eol(p, t_lf, eol):
    out = t_lf if eol == '\n' else t_lf.replace('\r\n', '\n').replace('\n', '\r\n')
    io.open(p, 'w', encoding='utf-8', newline='').write(out)
    return out


def one(t, old, new, tag):
    n = t.count(old)
    if n != 1:
        print('  !! [%s] 命中 %d 次（要求 1）→ 中止' % (tag, n))
        sys.exit(1)
    return t.replace(old, new)


def step_index():
    p = os.path.join(APP, 'index.html')
    raw = read_text(p)
    if ("var APP_VERSION = '%s'" % NEW) in raw:
        print('  [index.html] 已是 %s → 跳过（幂等）' % NEW)
        return False
    t = raw.replace('\r\n', '\n')
    t = one(t, "var APP_VERSION = '%s';" % OLD, "var APP_VERSION = '%s';" % NEW, 'index.html APP_VERSION')
    out = write_same_eol(p, t, eol_of(raw))
    print('  [index.html] APP_VERSION %s → %s' % (OLD, NEW))
    return True


def step_sw():
    p = os.path.join(APP, 'sw.js')
    raw = read_text(p)
    if ("var CACHE = 'sinoky-v%s'" % NEW) in raw:
        print('  [sw.js] 已是 %s → 跳过（幂等）' % NEW)
        return False
    t = raw.replace('\r\n', '\n')
    t = one(t, "var CACHE = 'sinoky-v%s';" % OLD, "var CACHE = 'sinoky-v%s';" % NEW, 'sw.js CACHE')
    write_same_eol(p, t, eol_of(raw))
    print('  [sw.js] CACHE %s → %s' % (OLD, NEW))
    return True


def step_version():
    p = os.path.join(APP, 'version.json')
    raw = read_text(p)
    d = json.loads(raw)
    if d['version'] == NEW:
        print('  [version.json] 已是 %s → 跳过（幂等）' % NEW)
        return False
    eol = eol_of(raw)
    t = raw.replace('\r\n', '\n')

    # ⚠️ 本轮只发网页线：apk 段刻意不动（apk.version 停在 v0.23.4，≠ OLD 0.23.5）。
    # 所以闸门不能拿 OLD 去卡 apk，只能咬「改动前后一字未变」。
    APK_BEFORE = d['apk']['version']

    # 顶层 version：钉死 2 空格缩进（apk 段是 4 空格，不能误伤）
    t, n = re.subn(r'^(  )("version": ")%s(")' % re.escape(OLD), r'\g<1>\g<2>%s\g<3>' % NEW, t, flags=re.M)
    if n != 1:
        print('  !! [version.json] 顶层 version 命中 %d 次（要求 1）→ 中止' % n)
        sys.exit(1)
    print('  [version.json] 顶层 version %s → %s' % (OLD, NEW))

    # note：用「旧值的 JSON 字面形式」精确替换，避免误伤
    t = one(t, json.dumps(d['note'], ensure_ascii=False), json.dumps(NOTE, ensure_ascii=False), 'version.json note')
    # noteEn[0]：只换第一段，后续历史保留
    t = one(t, json.dumps(d['noteEn'][0], ensure_ascii=False), json.dumps(EN0, ensure_ascii=False), 'version.json noteEn[0]')

    d2 = json.loads(t)                                   # 闸门②
    if d2['version'] != NEW:
        print('  !! [version.json] 写盘前 version != %s → 中止' % NEW)
        sys.exit(1)
    if d2['apk']['version'] != APK_BEFORE:
        print('  !! [version.json] apk 段被误改（%s → %s）→ 中止' % (APK_BEFORE, d2['apk']['version']))
        sys.exit(1)
    if len(d2['noteEn']) != len(d['noteEn']):
        print('  !! [version.json] noteEn 长度变化 → 中止')
        sys.exit(1)
    write_same_eol(p, t, eol)
    print('  [version.json] note / noteEn[0] 已更新；apk 段保持 %s（本轮只发网页线）' % APK_BEFORE)
    return True


def step_verify_script():
    p = os.path.join(HERE, 'verify-nono-ip.py')
    raw = read_text(p)
    if ('EXPECT_VER = "%s"' % NEW) in raw:
        print('  [verify-nono-ip.py] EXPECT_VER 已是 %s → 跳过（幂等）' % NEW)
        return False
    t = raw.replace('\r\n', '\n')
    t = one(t, 'EXPECT_VER = "%s"' % OLD, 'EXPECT_VER = "%s"' % NEW, 'verify EXPECT_VER')
    write_same_eol(p, t, eol_of(raw))
    print('  [verify-nono-ip.py] EXPECT_VER %s → %s' % (OLD, NEW))
    return True


print('=== ① index.html ===')
a = step_index()
print('=== ② sw.js ===')
b = step_sw()
print('=== ③ version.json ===')
c = step_version()
print('=== ④ verify-nono-ip.py ===')
d = step_verify_script()
print('=== ⑤ 终检 ===')
raw_index = read_text(os.path.join(APP, 'index.html'))
vj = json.loads(read_text(os.path.join(APP, 'version.json')))
print('  index.html APP_VERSION = %s' % re.search(r"var APP_VERSION = '([^']+)'", raw_index).group(1))
print('  sw.js CACHE            = %s' % re.search(r"var CACHE = '([^']+)'", read_text(os.path.join(APP, 'sw.js'))).group(1))
print('  version.json version   = %s' % vj['version'])
print('  version.json apk.version = %s（本轮只发网页线，保持不动）' % vj['apk']['version'])
print('  version.json apk.url   = %s' % vj['apk']['url'].split('/')[-1])
print('  download.html 兜底链接 = %s'
      % re.search(r'Sinoky-v([0-9.]+)-release\.apk', read_text(os.path.join(APP, 'download.html'))).group(1))
print('改动：index=%s sw=%s version=%s verify=%s' % (a, b, c, d))
