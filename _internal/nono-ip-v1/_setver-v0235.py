# -*- coding: utf-8 -*-
"""v0.23.5 版本号同步（幂等）—— 首访招手邀请（网页线）

本轮**只发网页线**，APK 保持 v0.23.4：
  · 首访改动只影响「新用户第一次打开」，而新用户从网页进入（招募帖发网页链接）；
  · 出包成本（CI 3 分钟 + 核验 + 回填 + 生产验证）换来的覆盖≈0；
  · 等下次有 App 端实质改动再一起出。
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

幂等：以「已是 0.23.5」判定，重复运行 0 变化。
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))

OLD = '0.23.4'
NEW = '0.23.5'

NOTE = (
    "v0.23.5：首访招手邀请 —— 把新用户的第一句话从「自我介绍 + 派作业」换成「我先说，你回我一句」。"
    "旧文案（实测原文）是 \"Hi, I'm Nono 🐼 Your first line today: 你好。Tap it and say it out loud.\" "
    "—— 这句是关于诺诺的：介绍自己、再要求开口，占掉首屏却换不来开口。"
    "现在首访 8 秒后，诺诺用 wave 姿态先说中文「你好！(nǐ hǎo)」，紧接着「Say it back to me. 说给我听」"
    "与「回一句」按钮 → 直接进入这句的跟读（SCENES 首场景首句，你好），不选场景、不走教程。"
    "第一秒就建立「我说 → 你说」的对话节律，为后续「我问你答」铺路 —— 而首句开口率是这个产品唯一的北极星。"
    "① 只对一句都没说过的人发（已开口的用户完全不受打扰），每天最多一次，首启引导卡没过时不抢。"
    "② 与既有「诺诺带你认识产品」的导览邀请定了位阶：零开口用户先收招手邀请，"
    "导览邀请等「已开口 或 今天已被邀请过」再出现 —— 两个邀请都在首页、都在启动后 8 秒，"
    "不定先后就会在首屏叠两层浮层。"
    "③ 冷启动补枪带重试（8 秒起、每 2.5 秒一次、约 90 秒窗口），覆盖「打开 App 就停在首页」"
    "这条不经过 go() 的路径；窗口用尽仍发不出就交还原分支，"
    "保证「首访一定有一句问候」这条底线不因为本层而破。"
    "④ 允许覆盖「非用户占用」的面板：主代码的今日句会先占住面板，"
    "而对一句都没说过的人，那句随机句恰恰是该被这条邀请替换掉的东西。"
    "⑤ 新增 S.feat.nonoWave 本地计数（复用 v0.3.36 功能级统计通道，零新增 KV 写）；"
    "新增 2 条文案 × 6 语言入 langs/*.json（零英文 fallback 验收线不动）。"
    "本轮只发网页版；APK 仍为 v0.23.4（本次改动只影响新用户首次打开，而新用户从网页进入）。"
)

EN0 = (
    "v0.23.5: First-visit wave invitation - a brand-new user's first line changes from "
    "\"introduce myself + assign homework\" to \"let me go first, you say it back\". "
    "The old copy (verbatim) was \"Hi, I'm Nono [panda] Your first line today: nihao. Tap it and say it out loud.\" "
    "- that sentence is about Nono: it introduces itself and then asks you to speak, taking over the first "
    "screen without producing an opening. Now, 8 seconds into a first visit, Nono waves and says the Chinese "
    "first - \"你好！(nǐ hǎo)\" - then \"Say it back to me. 说给我听\" with a \"Say it back\" button that goes "
    "straight into repeating that line (the first line of the first scene, nihao), with no scene picker and no "
    "tutorial. The \"I speak, you answer\" rhythm is established in the first second, paving the way for "
    "question-and-answer practice later - and first-line speak rate is this product's only north star. "
    "(1) It only fires for someone who has never said a single line (users who have already spoken are left "
    "completely alone), at most once a day, and stays away while the first-run guide card is still up. "
    "(2) It is ranked against the existing \"let me show you around\" tour invite: a zero-speech user gets the "
    "wave invitation first, and the tour invite appears once they have spoken or were already invited today - "
    "both live on Home and both fire 8 seconds after boot, so without an order they would stack two overlays on "
    "the first screen. (3) The cold-start top-up retries (from 8s, every 2.5s, ~90s window) to cover the common "
    "path of opening the app and staying on Home without going through go(); if the window runs out it hands "
    "back to the original branch, so a first visit always gets at least one greeting. (4) It may overwrite a "
    "panel that is not in use by the user: the main code's daily line grabs the panel first, and for someone "
    "who has never spoken that random line is exactly what this invitation should replace. (5) A new local "
    "counter, S.feat.nonoWave (reusing the v0.3.36 feature-stats channel; zero new KV writes), and two new "
    "strings in 6 languages (the zero-English-fallback line is untouched). Web only this round; the APK stays "
    "at v0.23.4, since this change only affects a brand-new user's first open, and new users arrive via the web."
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
    if d2['apk']['version'] != OLD:
        print('  !! [version.json] apk 段被误改（%s）→ 中止' % d2['apk']['version'])
        sys.exit(1)
    if len(d2['noteEn']) != len(d['noteEn']):
        print('  !! [version.json] noteEn 长度变化 → 中止')
        sys.exit(1)
    write_same_eol(p, t, eol)
    print('  [version.json] note / noteEn[0] 已更新；apk 段保持 %s（本轮只发网页线）' % OLD)
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
print('  version.json apk.version = %s（预期仍是 %s）' % (vj['apk']['version'], OLD))
print('  version.json apk.url   = %s' % vj['apk']['url'].split('/')[-1])
print('  download.html 兜底链接 = %s'
      % re.search(r'Sinoky-v([0-9.]+)-release\.apk', read_text(os.path.join(APP, 'download.html'))).group(1))
print('改动：index=%s sw=%s version=%s verify=%s' % (a, b, c, d))
