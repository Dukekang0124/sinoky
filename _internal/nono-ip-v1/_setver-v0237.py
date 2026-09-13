# -*- coding: utf-8 -*-
"""v0.23.7 版本号同步（幂等）—— Day 1 通关纪念卡（网页线）

本轮**只发网页线**（APK 保持 v0.23.4）：
  · 分享卡是传播出口，本轮补的是「里程碑成就卡」；
  · 存量 App 用户只有 ~27 台设备，出包成本（CI + 核验 + 回填 + 生产验证）
    仍大于覆盖面 ⇒ 建议攒到下次 App 端实质改动一起出；
  · ⚠️ 与 v0.23.5 不同：本改动**对所有用户都生效**（只对「已走完 Day 1 路径」的人显示，
    但不是「只对新用户」），所以「要不要出包」是覆盖 vs 成本的权衡，不是「收益为零」。
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

幂等：以「已是 0.23.7」判定，重复运行 0 变化。
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))

OLD = '0.23.6'
NEW = '0.23.7'

NOTE = (
    "v0.23.7：Day 1 通关纪念卡 —— 学完来华第一天，有东西可晒了。"
    "分享卡原有六个主题（句子 / 连击 / 城市 / 徽章 / 进展 / 起点），没有一个是「里程碑」："
    "用户走完 Day 1 路径（抵达、自我介绍、求助三个场景共 30 句全部说出口）"
    "是产品里第一个真正「我做到了」的时刻，而这一刻此前没有任何东西可晒。"
    "① 新增第 7 个主题 day1，可用条件与埋点里的 day1Done 同口径 —— 三个场景全部句子都说过；"
    "该布尔量早已随 M2 埋点上报，两边不会各说各话（也不另立「走过三步就算」的软定义，那可以注水）。"
    "② 卡面是三枚朱砂印章，中心用各场景的语义汉字（到 / 我 / 急）+ 大标题「来华第一天」"
    "+ 三行场景英文名 + 真实句数（按场景数据现算，不写死）。"
    "③ 不放分数：产品里唯一的持久化分数是声调练习正确率，它属于另一个模块，"
    "与 Day 1 三个对话场景没有因果关系，且多数用户为 0（没做过声调练习）——"
    "放上去会出现空字段，也与「分享卡不放没有数据源支撑的分数」这条线冲突。"
    "本卡只用计数与二元事实（三场景全通 / 30 句），与既有六卡一致。"
    "④ 入池权重 4：高于徽章 / 连击 / 城市 / 进展（1~2），低于「我今天说的那句话」（5）——"
    "里程碑该常被抽到，但不该盖掉日常分享。"
    "⑤ 绘制上不自建整张卡：临时把全局 _stack 换成空函数，让主代码自己画背景、边饰、页脚、"
    "诺诺与二维码，本层只补内容 —— 这样 Day1 卡的边框、印章、页脚与其它六张卡是同一段代码画的，"
    "也不会吃掉已有的诺诺与二维码。"
    "⑥ 无新增文案（6 语言字典不动）、无新增埋点（day1Done 已在埋点里，?t=day1 归因也已存在）、"
    "无新增网络请求与 KV 写。本改动对所有用户生效（只对走完 Day 1 路径的人显示）。"
    "本轮只发网页版；APK 仍为 v0.23.4。"
)

EN0 = (
    "v0.23.7: Day 1 completion card - finishing your first day in China now has something to show. "
    "The share card had six themes (line / streak / city / badge / report / start) and none of them was a "
    "milestone: finishing the Day 1 path (all 30 lines across arrival, self-intro and emergency spoken out "
    "loud) is the first real \"I did it\" moment in the product, and there was nothing to show for it. "
    "(1) A seventh theme, day1, uses the same condition as day1Done in analytics - every line of all three "
    "scenes spoken - a boolean that has been reported with the M2 metrics all along, so the app and the card "
    "can never disagree (and no softer \"walked through the three steps\" definition, which could be padded). "
    "(2) The face carries three cinnabar seals whose centres are the semantic character of each scene "
    "(arrive / me / help), a large \"\u6765\u534e\u7b2c\u4e00\u5929\" title, the three scene names and the real line count "
    "(computed from scene data, never hard-coded). (3) No score: the only persisted score in the product is "
    "tone-drill accuracy, which belongs to a different module and has no causal link to the three Day 1 "
    "conversation scenes, and is 0 for most users (they never did a tone drill) - it would produce an empty "
    "field and conflicts with the rule that the share card never shows a score without a real data source. "
    "The card uses only counts and binary facts (3 of 3 scenes, 30 lines), like the other six. (4) Pool weight "
    "4: above badge / streak / city / report (1~2) and below \"the line I said today\" (5) - a milestone should "
    "come up often without crowding out everyday sharing. (5) It does not build a whole card itself: it swaps "
    "the global _stack for an empty function so the main code draws the background, borders, footer, Nono and "
    "the QR code, and this layer only adds content - so the Day 1 card's frame, seals and footer come from the "
    "same code as the other six, and the existing Nono and QR code are not eaten. (6) No new strings (the "
    "6-language dictionaries are untouched), no new analytics (day1Done is already reported and ?t=day1 "
    "attribution already exists) and no new requests or writes. This applies to all users (shown only to those "
    "who finished the Day 1 path). Web only this round; the APK stays at v0.23.4."
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

    # ⚠️ 本轮只发网页线：apk 段刻意不动（apk.version 停在 v0.23.4，≠ OLD 0.23.6）。
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
