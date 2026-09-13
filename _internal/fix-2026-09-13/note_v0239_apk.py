#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
note_v0239_apk.py —— 把 v0.23.9 的更新说明从「只发网页版」改为「网页 + APK 同步发布」，
并把本轮自检顺带修掉的「设置页标签被挤成竖排」补进说明。

为什么要改：note 原结尾写着「本版只发网页版，APK 仍为 v0.23.4。」
—— 一旦出了 APK，线上这句就自相矛盾（说明说没发、实际发了）。

纪律（SOP §1.5）：**文本级逐条精确替换 + 三重断言**，绝不用 json.dump
（它会重排缩进、把中文转义成 \\uXXXX，产生整文件无意义 diff）。

幂等：命中 0 次 = 已替换过 ⇒ skip；命中 >1 次 = 目标串有歧义 ⇒ 中止。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, '..', '..', 'version.json')

CN_OLD = '本版只发网页版，APK 仍为 v0.23.4。'
CN_NEW = ('④ 顺手修了一处只在中文界面才显形的排版：设置页的左侧标签（如「界面语言」「关于」）'
          '会被右侧长文本挤成竖排，已改为不被压缩。本版网页与 APK 同步发布，APK 从 v0.23.4 升到 v0.23.9。')

EN_OLD = 'Web only this round; the APK stays at v0.23.4.'
EN_NEW = ('(4) A layout fix that only appeared in the Chinese UI: in Settings the left-hand labels '
          'were squeezed into a vertical stack by the long text on the right; they can no longer be '
          'compressed. Web and APK ship together this round, and the APK jumps from v0.23.4 to v0.23.9.')

# ⚠️ 这句英文在 noteEn 里出现 3 次（v0.23.9 / v0.23.8 / v0.23.7 —— 历史上都「只发网页线」，
#    结尾都是同一句）。所以不能全文替换，必须**只改第一次出现**（= noteEn[0]）。
#    断言：改完剩下的次数必须正好是 2。
EN_OCCURRENCES = 3

EDITS = [(CN_OLD, CN_NEW, 'note', 1), (EN_OLD, EN_NEW, 'noteEn[0]', EN_OCCURRENCES)]


def main():
    raw = open(P, 'rb').read()
    # ⚠️ version.json 本身就是**混合行尾**（既有 CRLF 也有裸 LF，实测 18 个）。
    #    所以判据不能是「裸 LF == 0」，只能是「改动前后裸 LF 数不变」
    #    —— 断言必须咬住「我有没有破坏它」，而不是「我以为它长什么样」。
    lf_before = raw.count(b'\n') - raw.count(b'\r\n')
    hit = {}

    for old, new, tag, expect in EDITS:
        ob, nb = old.encode('utf-8'), new.encode('utf-8')
        # 幂等判据必须是「**新串**是否已存在」，不能是「旧串是否还在」——
        # 后者在 EN_OLD 这种「历史条目里也有同款句子」的情况下会误判成「还没改」，
        # 于是第二轮去替换 noteEn[1]（v0.23.8）的结尾，破坏历史说明。
        if raw.count(nb) >= 1:
            print('  [skip] %s 已是新版说明（新串已在）' % tag)
            hit[tag] = 'skip'
            continue
        n = raw.count(ob)
        if n == 0:
            print('  !! %s 既无旧串也无新串 ⇒ 中止' % tag)
            sys.exit(1)
        # 只替换**第一次**出现（历史条目里有同款句子，不能连坐）
        i = raw.find(ob)
        raw = raw[:i] + nb + raw[i + len(ob):]
        left = raw.count(ob)
        assert left == expect - 1, '%s 替换后剩余 %d 次（预期 %d）⇒ 可能改错了条目' % (tag, left, expect - 1)
        hit[tag] = '1 of %d' % n

    # ① 命中数
    print('  命中：', hit)

    # ② 行尾没被破坏（本脚本按字节替换，不改任何行尾 ⇒ 裸 LF 数必须与改动前相同）
    lf_after = raw.count(b'\n') - raw.count(b'\r\n')
    assert lf_after == lf_before, '裸 LF 数从 %d 变成 %d ⇒ 行尾被破坏' % (lf_before, lf_after)

    # ③ 写盘前必须能 parse（note 里写错引号会让整个 JSON 非法 ⇒ 应用内更新链路全断）
    j = json.loads(raw.decode('utf-8'))
    assert j['version'] == '0.23.9', '顶层版本号意外变成 %s' % j['version']
    assert j['apk']['version'] == '0.23.4', 'apk 段不该被动到（应由 CI 回写），实为 %s' % j['apk']['version']

    open(P, 'wb').write(raw)
    print('  ✓ version.json 已更新（%d B）' % len(raw))
    print('  ✓ 顶层 version=%s · apk.version=%s（待 CI 回写为 0.23.9）' % (j['version'], j['apk']['version']))


if __name__ == '__main__':
    main()
