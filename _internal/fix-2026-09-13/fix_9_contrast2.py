#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_9_contrast2.py —— 全局低对比度扫描抓出的另外 3 处（同一类根因的两个变体）

`test_contrast.mjs` 的**逐视图全局扫描**（不是只查康哥截图那一处）在修完 `--fg` 后
又抓出 3 处对比度 <3.0 的可见文字。两处是同一根因的不同表现：
**「没写作者样式 ⇒ 落到浏览器 UA 默认色」，而 UA 默认色是为浅色页面设计的。**

### 缺陷 A：页脚两个裸 `<a>` 落到 UA 默认链接色（1.86:1）
`<div class="foot">… · <a href="privacy.html">Privacy</a> · <a href="#" onclick="openShare()">Share</a> · …</div>`
- `.foot a` 没有任何规则（`.foot details.attr a{color:var(--sub)}` 只覆盖鸣谢块内部那个）；
- 于是 Privacy / Share 用 UA 默认 `rgb(0,0,238)` = `#0000EE`；
- 底色 `--bg` = `#161a20` ⇒ **1.86 : 1** —— 深色主题下**等于看不见**。
- 注意 `:visited` 的 UA 默认是紫色 `#551A8B`，同样要一起管住，否则点过一次之后更难认。
- 实测（Chrome）：`v-home · A — rgb(0,0,238) on rgb(22,26,32) = 1.86:1 「隐私」「分享」`。

### 缺陷 B：「已完成」步骤圆标 = 白字压青底（2.19:1）
`.day1-step.done .num{background:var(--teal)}`、`.dayitem.done .num{background:var(--teal)}`。
圆标底色在「未完成」时是品牌红（白字 3.09:1，约定俗成、可接受），
切到「已完成」态换成 `--teal`（#8ab8b2，一支**很亮**的青），而字色仍是 `color:#fff`。
亮青 + 白 ⇒ **2.19 : 1**，比修之前那处还糟。
- 实测：`v-home · num — rgb(255,255,255) on rgb(138,184,178) = 2.19:1 「1」`。
- 修法不是换底色（teal = 本项目的「完成/正确」语义色，动它破坏语义），
  而是**在亮青底上改深墨字**：`#141a24`（品牌深青黑）⇒ **7.83 : 1**。
  这也符合本项目「亮底配墨字、暗底配白字」的既有做法。

不动的地方（说明一下，免得下一轮又被"发现"一次）：
- `.day1-step .num` / `.dayitem .num` 的**未完成**态（白字压品牌红 3.09:1）——
  这是全站通行的按钮写法，且已达大字门槛，**不属缺陷**。
- 扫描报出的 104 处 3.0–4.5 的项（白字压 `--red` 4.17:1 等）——同上，是既定设计语言。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(ROOT, '..', '..'))
P = os.path.join(APP, 'index.html')

EDITS = [
    # (旧串, 新串, 期望命中次数, 说明)
    (
        '.day1-step.done .num{background:var(--teal)}',
        '.day1-step.done .num{background:var(--teal);color:#141a24}',
        1, 'A 首页 Day-1「已完成」圆标：白字压亮青 → 改深墨字（2.19 → 7.83:1）',
    ),
    (
        '.dayitem.done .num{background:var(--teal)}',
        '.dayitem.done .num{background:var(--teal);color:#141a24}',
        1, 'B 14 天路径「已完成」圆标：同上',
    ),
    (
        '*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}',
        '*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}\n'
        '/* v0.23.9：裸 <a> 的作者色。不写的话 Privacy / Share 会落到 UA 默认 #0000EE，\n'
        '   在 --bg(#161a20) 上只有 1.86:1 —— 深色主题下等于看不见；:visited 的 UA 默认\n'
        '   紫 #551A8B 同理。这条只兜底，任何更具体的规则（如 .foot details.attr a）照常覆盖。 */\n'
        'a{color:var(--teal)}a:visited{color:var(--teal)}',
        1, 'C 页脚 Privacy / Share 裸链接：补作者色（1.86 → 7.84:1）',
    ),
]


def main():
    s0 = io.open(P, encoding='utf-8').read()
    print('修复前 index.html：%d 字节' % len(s0.encode('utf-8')))
    s = s0
    for old, new, expect, label in EDITS:
        # 🔴 幂等判据必须是「新串是否已存在」，**不能**用「旧串是否还在」：
        # 本脚本三条的 new 都是 old 的**超串**（在原规则后面追加属性 / 追加规则块），
        # 于是 old 永远还在 ⇒ 每跑一轮就把新内容再插一遍。
        # （第一版就是这么写的，实测第二轮把链接色规则插了 2 次、文件涨了 361 字节。
        #   本系列 fix_2_ux.py 也栽在同一个坑上 —— 这是 append-only 打补丁的通病。）
        if new in s:
            print('  [skip] %s（新串已存在）' % label)
            continue
        n = s.count(old)
        # 🔴 命中数不对就停：静默改错位置比不改更糟
        assert n == expect, '%s：锚点命中 %d 次，期望 %d 次（上下文已变，先人工核对）' % (label, n, expect)
        s = s.replace(old, new)
        print('  [ok]   %s' % label)

    if s == s0:
        print('  未发生任何改动（已是最新）')
    else:
        io.open(P, 'w', encoding='utf-8', newline='').write(s)
        print('✅ 已写回 index.html：%d → %d 字节' % (len(s0.encode('utf-8')), len(s.encode('utf-8'))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
