#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sinoky v0.23.8 FIX · 组 3：Service Worker 语法错（本轮最高价值发现）

════════════════════════════════════════════════════════════════════════
问题
════════════════════════════════════════════════════════════════════════
sw.js 的 ASSETS 数组里，v0.22.0「诺诺 IP」那一批新增的 15 条路径**没有加引号**：

    var ASSETS = [
      './', './index.html', ... ,          ← 前面 18 条都有引号
      /* v0.22.0 诺诺 IP：定妆图 + 8 姿态 + 3 空态。 */
      ./icons/logo-header.png,             ← 从这里开始裸路径
      ./assets/brand/nono-splash.webp,
      ...
    ];

JS 里 `./icons/logo-header.png` 不是合法表达式（`.` 会被当作除法/成员访问）
⇒ **整个 sw.js 是语法错误文件**。

════════════════════════════════════════════════════════════════════════
影响（已实测，不是推测）
════════════════════════════════════════════════════════════════════════
index.html L6242：navigator.serviceWorker.register('sw.js').catch(function(){});
                                                        ↑ 空 catch，静默吞掉

所以：**Service Worker 从未注册成功过**，而且失败了 0 报错、0 提示。
连带失效的能力：
  · 离线可用（network-first 回落 app shell）
  · shell 预缓存（install 阶段 addAll(ASSETS)）
  · 换版本时自动清旧 cache（activate 阶段）
  · L5829-5837 那段「先 await serviceWorker.ready，确保模块请求进缓存」的逻辑前提不成立

实测证据：
  git show HEAD:sw.js          → SyntaxError: Unexpected token '.'
  git show 307764a:sw.js       → SyntaxError（v0.23.7）
  … 8ace24d / 113bee8 / 080301a / e05db2d / bcb31bf / f098bcb 全部 SyntaxError
  curl https://sinoky.pages.dev/sw.js → 线上也是坏的（http 200 / 2861 B / L18 同样报错）

⇒ 至少 8 个已发布版本（v0.23.0 → v0.23.7）线上 SW 都是死的。

════════════════════════════════════════════════════════════════════════
为什么没人发现（根因：验收本身有洞）
════════════════════════════════════════════════════════════════════════
_internal/verify_syntax.mjs 只做两件事：
  ① 抽 index.html 的内联 <script> 丢给 vm.Script 解析
  ② JSON.parse 几个 data/*.json
—— **从来没碰过 sw.js，也没碰过 _worker.js**。
一个「语法校验脚本」不校验语法出过错的那些文件，就是假绿。
本组顺带把 sw.js / _worker.js 补进那道闸门（见 patch_verify_syntax.py）。

════════════════════════════════════════════════════════════════════════
安全性
════════════════════════════════════════════════════════════════════════
ASSETS 共 33 条，本地**全部存在**（0 缺失，已逐条 stat 验证）
⇒ 补引号后 install 阶段 c.addAll() 不会因 404 整体 reject。
（addAll 是 all-or-nothing：只要有一条 404，install 就失败、SW 仍然装不上。
  所以「先验证 33 条都在」不是可选项。）
"""
import io
import os
import re
import sys

APP = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SW = os.path.join(APP, 'sw.js')
IDX = os.path.join(APP, 'index.html')

MARK = 'v0.23.8 FIX'


def read(p):
    with io.open(p, encoding='utf-8', newline='') as f:
        s = f.read()
    return s.replace('\r\n', '\n').replace('\r', '\n')   # 项目红线：源文件纯 LF


def write(p, s):
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def fix_assets_quotes(sw):
    """ASSETS 数组里所有裸路径补引号。幂等：补完再无裸路径 ⇒ 第二轮无事可做。"""
    print('SW-1  ASSETS 裸路径补引号')

    m = re.search(r'(var ASSETS = \[)(.*?)(\n\];)', sw, re.S)
    assert m, 'ASSETS 数组区块定位失败'
    head, blk, tail = m.group(1), m.group(2), m.group(3)

    # 已带引号的行：  './x',  /  "./x",
    # 裸路径行：      ./x,
    BARE = re.compile(r"^(\s*)(\./[^\s',\"]+)(,?)\s*$", re.M)
    # 只处理「行首到行尾就是一个裸路径 + 可选逗号」的行；绝不动已带引号的行与注释行

    names = [mm.group(2) for mm in BARE.finditer(blk)]
    if not names:
        print('  [skip] 已无裸路径（共 %d 条已是合法条目）' % blk.count(','))
        return sw

    # ★ 先证明这些文件真的都在，否则 addAll 会 404 ⇒ install 失败 ⇒ 白修
    missing = []
    for n in names:
        p = os.path.join(APP, n[2:].replace('/', os.sep))
        if not os.path.exists(p):
            missing.append(n)
    assert not missing, 'ASSETS 引用的文件不存在，补引号会引发 install 404：%r' % missing
    print('  [ok]   %d 个裸路径，本地 0 缺失' % len(names))

    new_blk = BARE.sub(lambda mm: "%s'%s'%s" % (mm.group(1), mm.group(2), mm.group(3) or ','), blk)
    for n in names:
        print('         + %s' % n)
    return sw[:m.start()] + head + new_blk + tail + sw[m.end():]


def fix_registration_error_logging(idx):
    """register 的空 catch 改成「静默但留痕」。幂等。"""
    print('SW-2  register 失败不再被完全吞掉')
    old = "  navigator.serviceWorker.register('sw.js').catch(function(){});"
    new = ("  /* v0.23.8 FIX：原来是空 catch —— sw.js 语法错导致注册失败时\n"
           "     用户侧、控制台都看不到任何痕迹，这个 bug 因此潜伏了 8 个版本。\n"
           "     改成留一行 warn（仍然不影响主流程，绝不 throw）。 */\n"
           "  navigator.serviceWorker.register('sw.js').catch(function(e){\n"
           "    try { console.warn('[sw] register failed', e && e.message); } catch(_) {}\n"
           "  });")
    if new in idx:
        print('  [skip] 已是新版')
        return idx
    n = idx.count(old)
    assert n == 1, 'register 锚点命中 %d 次' % n
    print('  [ok]')
    return idx.replace(old, new, 1)


if __name__ == '__main__':
    print('APP =', APP)
    sw, idx = read(SW), read(IDX)

    sw = fix_assets_quotes(sw)
    idx = fix_registration_error_logging(idx)

    # 自检：sw.js 里不得再有「行首空白 + ./ + 非引号开头的裸路径」
    left = re.findall(r"^\s*(\./[^\s',\"]+),?\s*$", sw, re.M)
    assert not left, '仍有裸路径残留：%r' % left

    write(SW, sw)
    write(IDX, idx)
    print('\n写盘完成：sw.js %d B | index.html %d B'
          % (len(sw.encode('utf-8')), len(idx.encode('utf-8'))))
