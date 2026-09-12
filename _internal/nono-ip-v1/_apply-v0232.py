#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v0.23.2 改版（康哥 4 条决策中的 2、4 条，均在 index.html）

① splash 补漏字：L1125 品牌文字是 `Sino<b>k</b>` ⇒ 渲染为 "Sinok"（漏末尾 y）
   改为 `Sino<b>k</b>y`（`<b>` 高亮 "k" 的意图保留，品牌红）。

② 统一品牌红：字标 #e63946 与界面 --red #c2362b 两种红混用 ⇒ 统一为更鲜艳的 #e63946。
   改动点（全部来自实测 grep）：
     - `--red:#c2362b`                                  定义
     - `--t1:#c2362b`                                   声调 1（保持红系，随品牌红统一）
     - `rgba(194,54,43,α)`  ×41                         #c2362b 的 RGB 半透明用法
     - `.nc-bub.nc-you` 渐变 `#e85a5a,#c2362b`          配套亮变体 + 基色
     - `.nctrl-mic` 渐变 `#c2362b,#a12a21`              基色 + 配套暗变体
     - `strokeColor:'#c2362b'`                          HanziWriter 笔顺（不接受 CSS 变量，必须字面值）
     - `SHARE.C.red:'#c2362b'`                          Canvas 分享卡
   #c2362b = RGB(194,54,43)   #e63946 = RGB(230,57,70)
   渐变配套色按同一明度关系平移：亮 #e85a5a→#f0655f / 暗 #a12a21→#c22a35。

不写版本号（那是 _setver 的职责），只做上述两类内容改动。
用法：python _apply-v0232.py [--check]
"""
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
IDX = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'index.html')

# (旧, 新, 期望命中次数)
RULES = [
    # ---- ① splash 补漏字 ----
    ('<div class="sp-brand">Sino<b>k</b></div>',
     '<div class="sp-brand">Sino<b>k</b>y</div>', 1),
    # ---- ② 统一品牌红 ----
    ('--red:#c2362b;', '--red:#e63946;', 1),
    ('--t1:#c2362b;', '--t1:#e63946;', 1),
    ('linear-gradient(180deg,#e85a5a,#c2362b)', 'linear-gradient(180deg,#f0655f,#e63946)', 1),
    ('linear-gradient(180deg,#c2362b,#a12a21)', 'linear-gradient(180deg,#e63946,#c22a35)', 1),
    ("strokeColor: '#c2362b'", "strokeColor: '#e63946'", 1),
    ("red:'#c2362b'", "red:'#e63946'", 1),
    ('rgba(194,54,43,', 'rgba(230,57,70,', 41),
    # 历史遗留的第三种红 #d94a3c（不在原 grep 清单里，靠色系扫描发现）：
    #   .ob-btn 正常态用 var(--red)、hover 却硬编码 #d94a3c ⇒ 换成新红的亮变体
    #   .d-line.you 的边框已用 rgba(230,57,70)、拼音字色却还是 #d94a3c ⇒ 换回基色
    ('#v-onboard .ob-btn:hover{background:#d94a3c}',
     '#v-onboard .ob-btn:hover{background:#f0655f}', 1),
    ('#v-dialog .d-line.you .py{color:#d94a3c}',
     '#v-dialog .d-line.you .py{color:#e63946}', 1),
]
# 注意：.s-slang 的 rgba(216,90,48)/#F0997B 是「俚语」标签的橙色分类色，不是品牌红，刻意不动。


def main() -> int:
    check = '--check' in sys.argv
    src = open(IDX, encoding='utf-8', newline='').read()
    out = src
    total, bad, skipped = 0, [], 0
    for old, new, want in RULES:
        n = out.count(old)
        # 幂等：已应用过的规则（旧串 0 命中 + 新串已在位）直接跳过，不视为异常
        if n == 0 and out.count(new) >= 1:
            skipped += 1
            print('  · %-52s 已应用，跳过' % old[:50])
            continue
        if n != want:
            bad.append('命中 %d 次（期望 %d）：%s' % (n, want, old[:64]))
            continue
        out = out.replace(old, new)
        total += n
        print('  ✓ %-52s ×%d' % (old[:50].replace('\n', ' '), n))

    if bad:
        print('\n✗ 命中数异常，未写盘：')
        for b in bad:
            print('   ' + b)
        return 1

    # 残留断言：改完不应再有旧红
    leftovers = out.count('c2362b') + out.count('194,54,43') + out.count('e85a5a') \
        + out.count('a12a21') + out.count('d94a3c')
    if leftovers:
        print('\n✗ 仍有旧红残留 %d 处，未写盘' % leftovers)
        return 1

    if check:
        print('\n校验通过：本次替换 %d 处，跳过已应用 %d 条，无残留（未写盘）' % (total, skipped))
        return 0

    open(IDX, 'w', encoding='utf-8', newline='').write(out)
    print('\n已写盘：本次替换 %d 处，跳过已应用 %d 条 | index.html %d B'
          % (total, skipped, os.path.getsize(IDX)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
