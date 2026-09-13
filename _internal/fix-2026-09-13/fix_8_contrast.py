#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_8_contrast.py —— 修「文字看不清」的根因：CSS 变量被引用但从未定义

康哥 2026-09-13 报的截图：Smart review 卡里英文 "My phone is lost." 是**黑的**，
压在深色底上看不清（同卡中文是浅青色，正常）。

## 根因（已在真机浏览器上实测确认）

`.rv-en{color:var(--fg)}`，而 `--fg` **在整份 index.html 里定义 0 次、使用 5 次**。
其余设计变量（--txt/--sub/--bg/--card/--red/--teal/--gold/--line/--bg2/--paper/--gold-dim/t1-t4）
全部正好定义 1 次 —— 只有 `--fg` 是凭空写出来的名字。

`var()` 无 fallback 且变量未定义 ⇒ 该声明 **invalid at computed-value time**
⇒ `color` 退化为 `unset`（color 是继承属性 ⇒ 等于 `inherit`）
⇒ 从最近的、真正带颜色的祖先继承。

实测（Chrome，`test_contrast.mjs`）：
  .rv-en     → rgb(0,0,0) on rgb(29,35,44) = **1.33 : 1**  ❌ 完全看不清
  .rv-hz     → rgb(138,184,178)             =  7.21 : 1  ✅（走 --teal，本来就有定义）
  其余 7 处   → rgb(238,242,247) = --txt（**靠偶然的继承链**撞对了，不是设计意图）

⚠️ 关键洞察：**这 8 处里 7 处看起来「没事」纯属侥幸** ——
它们分别是 button / span / small，父链上恰好有人把 color 设成了浅色。
只有 `.rv-en` 的父链第一个带颜色的祖先是 `<button class="rv-line">`，
而按钮没有作者样式设 color ⇒ 继承 UA 的 `buttontext` ⇒ **黑色**。
换句话说：**同一个 bug，只有一处显形，另外 7 处是定时炸弹。**

## 修法：收敛到既有规范名，不引入新名字

不用「补一个 --fg 的定义」来遮，因为那样会留下 `--fg` / `--txt` 两个同义名，
违背本项目「v0.23.2 起品牌红只有一支」的单一命名纪律。
改为把 8 处一次性换成既有规范 token：

  var(--fg)       → var(--txt)    5 处（primary text，与全文件其余 6000 行一致）
  var(--text)     → var(--txt)    2 处（同上；--text 同样是凭空名字）
  var(--text-sec) → var(--sub)    1 处（secondary text，与 .card p.desc 同一 token）

不动 `var(--accent,…)` / `var(--border,…)` —— 它们**永远带 fallback**，
fallback 就是 CSS 变量合法的逃生舱，不是缺陷。

## 幂等

判据用「旧串是否还在」而不是「新串是否已存在」——
因为 `var(--txt)` 原本就有几百处，拿它当判据会永远判定"已完成"。
（本系列脚本第一版就在这个坑上翻过车：`new` 是 `old` 的超串时判据恒真。）
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(ROOT, '..', '..'))
P = os.path.join(APP, 'index.html')

# (旧串, 新串, 期望命中次数, 说明)
EDITS = [
    ('var(--fg)', 'var(--txt)', 5, 'primary text 收敛到 --txt（含 Smart review 英文那处）'),
    ('var(--text)', 'var(--txt)', 2, 'primary text 收敛到 --txt（fc-level-btn / fc-pending-zh）'),
    ('var(--text-sec)', 'var(--sub)', 1, 'secondary text 收敛到 --sub（Settings About 小字）'),
]

USE_RE = re.compile(r'var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])')
DEF_RE = re.compile(r'(--[a-zA-Z0-9_-]+)\s*:')


def violations(s):
    """无 fallback 且未定义的 var() —— 这才是真缺陷；带 fallback 的合法。"""
    defined = set(DEF_RE.findall(s))
    bad = {}
    for m in USE_RE.finditer(s):
        name, tail = m.group(1), m.group(2)
        if tail == ',' or name in defined:
            continue
        bad[name] = bad.get(name, 0) + 1
    return bad


def main():
    if not os.path.exists(P):
        print('❌ 找不到 %s' % P); return 1
    s0 = io.open(P, encoding='utf-8').read()
    before = violations(s0)
    print('修复前 index.html：%d 字节' % len(s0.encode('utf-8')))
    print('  未定义且无 fallback 的变量：%s' % (before if before else '无'))

    s = s0
    for old, new, expect, label in EDITS:
        n = s.count(old)
        if n == 0:
            print('  [skip] %s（已无 %s）' % (label, old))
            continue
        # 🔴 必须断言命中数：静默改错地方比不改更糟
        assert n == expect, '%s：%s 命中 %d 次，期望 %d 次（上下文已变，先人工核对）' % (label, old, n, expect)
        s = s.replace(old, new)
        print('  [ok]   %s（%s ×%d）' % (label, old, n))

    after = violations(s)
    # 自校验：改完必须零违规，否则这脚本本身是错的
    assert not after, '修完仍有未定义变量：%r' % after

    if s == s0:
        print('  未发生任何改动（已是最新）')
    else:
        io.open(P, 'w', encoding='utf-8', newline='').write(s)
        print('✅ 已写回 index.html：%d → %d 字节' % (len(s0.encode('utf-8')), len(s.encode('utf-8'))))
    print('   未定义且无 fallback 的变量：%s' % (after if after else '无 ✅'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
