#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sinoky v0.23.6 —— 追加 §13 分享卡二维码（幂等）

做的事：
  ① 把 qrcode-generator v1.4.4（MIT，Kazuhiko Arase）内联进 patch.js 主 IIFE
  ② 新增 qrOf/roundRect/drawInto：在 Canvas 上画「米白底板 + 近黑模块」
  ③ 包装 window.SHARE.draw（在 §5 之后 ⇒ 画在最上层），把 SHARE.link() 画成二维码
  ④ 行尾归一化 + 硬约束断言

跑法：python _add-qr.py
"""
import io
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
PJ = os.path.join(BASE, 'patch.js')
QJS = 'D:/wbtmp/q.js'

MARK = '13. 分享卡二维码'

# ---------------------------------------------------------------- §13 前缀（说明 + 内联头）
HEAD = u"""  /* ---------- 13. 分享卡二维码：「一张图就能传出去」（P0 · 传播出口） ----------
     现状：分享卡只能「复制文本 + 链接」，**图片本身没有可点的入口** ——
       老外把卡片图发到微信 / Discord / 群里，接收者只看到一行域名文字，
       想用还得手打。这正是「让每个用户自带传播」缺的最后一环。

     做法：在分享卡**页脚中央**合成二维码，编码 **SHARE.link() 本身**
       （即带归因码 `?s=xxxxxxxx` 与主题/句子参数的那条链接）。
       不编一个固定的 /download，理由三条：
         ① 归因是这个改动**唯一能被验证**的依据（否则做完也不知道有没有用）；
         ② 扫码的是**接收者**，多为 iPhone —— 落到能立刻用的首页（PWA 免安装）
            比落到「下载 APK」页更好（iOS 装不了 APK，等于把人挡在门外）；
         ③ 句子卡带 `&l=场景:序号` ⇒ 接收者打开就看到朋友说的那一句（已有 pendingLine 机制）。

     ⚠️ 位置与规划稿不同：2026-09-11 设计方案 E3 写的是「右下角」，
       但 v0.23.x 起 §5 已把**诺诺**放在右下角 ⇒ 改到**页脚中央**
       （页脚两端分别是「字标 + URL」与印章，中间是唯一稳定空白，且各主题卡都成立）。

     可靠性三件（缺一就可能「看着像二维码但扫不出」）：
       ① **每模块整数像素**：scale = floor(size/(模块数+8))，real = scale×(模块数+8)
          —— 子像素缩放让模块边缘发虚，是屏幕扫码失败的头号原因；
       ② **quiet zone 4 模块**（含在底板内，规范下限）；
       ③ **米白底 + 近黑模块**（不用透明、不用深底反色：扫码器对反色支持不保证）。

     零新增请求、零新增存储：矩阵在内存里算，画完即弃；不写任何 localStorage。
  */
  (function () {
    /* --- 内联 qrcode-generator v1.4.4 · MIT · Copyright (c) 2009 Kazuhiko Arase ---
       不自己手写：QR 编码含 Reed-Solomon 纠错与掩码评估，手写极易产出
       「语法全对、就是扫不出」的隐性错误。该库纯函数、无 DOM 依赖、久经生产验证。
       许可：MIT（允许商用与内联），原始版权声明保留在下方源码首部。 */
"""

# ---------------------------------------------------------------- §13 后缀（绘制 + 包装）
TAIL = u"""
    /* ---------- 绘制：整数像素 + 规范 quiet zone ---------- */
    var QR_EC = 'M';                 /* 15% 纠错；链接 ≤62 字符时版本稳定在 v4 */
    var QUIET = 4;                   /* quiet zone 模块数（规范下限） */
    var INK = '#12161d';             /* 模块色：近黑（扫描可靠优先于纯度） */
    var BG = '#f5f1e8';              /* 底板：品牌米白（与纯白的扫描对比度等价） */

    function qrOf(text) {
      var qr = qrcode(0, QR_EC);     /* 0 = 按内容自动选版本 */
      qr.addData(text);
      qr.make();
      return qr;
    }

    function roundRect(c, x, y, w, h, r) {
      if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, r); return; }
      c.beginPath();
      c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r); c.closePath();
    }

    /* 把 text 画成二维码，水平居中于 W，顶边 = y。
       返回 {real,scale,n} 供验收读取（不画任何东西以外的副作用）。 */
    function drawInto(ctx, W, text, y, size) {
      var qr = qrOf(text), n = qr.getModuleCount();
      var unit = n + QUIET * 2;
      var scale = Math.floor(size / unit);
      if (scale < 2) scale = 2;                    /* 保底：绝不画成不可扫的尺寸 */
      var real = scale * unit;
      var x = Math.round((W - real) / 2);

      ctx.save();
      ctx.fillStyle = BG;
      /* 圆角 12px（< quiet zone 像素宽 QUIET*scale，这里 ≥20）。
         ⚠️ 实测更正（2026-09-13，改用 zxing 复测后）：本层最初以为「圆角 > quiet 宽 ⇒
         二维码扫不出」，据此把 18px 改成 12px（当时 OpenCV 系检测器确实从 18/18 掉到 8/18）。
         但用 zxing（安卓同源，真实场景代理）复测：圆角 12 与 18 在 scale=4/5 下得分
         **完全相同**（scale5 36/36、scale4 30/36）⇒ 圆角不是可扫性的决定项。
         真正有影响的是**模块尺寸**：同圆角下 size 205（scale5，每模块 5px）比 176
         （scale4，4px）多 6/36 通过 —— 这才是把 size 提到 205 的依据。
         12px 保留为更保守的余量，不是「必须」。 */
      roundRect(ctx, x, y, real, real, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(201,168,108,.45)'; ctx.lineWidth = 2; ctx.stroke();

      ctx.fillStyle = INK;
      var off = QUIET * scale;
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          if (!qr.isDark(r, c)) continue;
          ctx.fillRect(x + off + c * scale, y + off + r * scale, scale, scale);
        }
      }
      ctx.restore();
      return { real: real, scale: scale, n: n, x: x, y: y };
    }
    window.__qrDrawInto = drawInto;   /* 验收脚本用（只读，不参与渲染） */

    /* ---------- 包装 SHARE.draw（本层在 §5 之后 ⇒ 画在最上层） ---------- */
    if (typeof window.SHARE === 'undefined' || typeof window.SHARE.draw !== 'function') return;
    var _drawQR = window.SHARE.draw;
    window.SHARE.draw = function (fmt) {
      var cv = _drawQR.apply(this, arguments);
      if (!cv) return cv;
      try {
        var ctx = cv.getContext('2d');
        if (!ctx) return cv;
        var link = (typeof window.SHARE.link === 'function') ? window.SHARE.link() : '';
        if (!link) return cv;
        /* 页脚锚定 H_。顶边 = H-254（方图 826 / 竖版 1666），让 41 单位能取到
           scale=5（real 205px）—— 模块越大，被外部工具重采样后越不容易失真。
           横向居中后 x≈438..643，与右下诺诺（x≥700）、右侧印章、左侧字标都不重叠。 */
        drawInto(ctx, cv.width, link, cv.height - 254, 205);
      } catch (e) {}
      return cv;
    };
  })();
"""


def main():
    pj = io.open(PJ, encoding='utf-8', newline='').read()
    if MARK in pj:
        print('[skip] §13 已存在（幂等）')
        return 0
    if not os.path.exists(QJS):
        print('[ERR] 缺少 %s' % QJS)
        return 2

    qjs = io.open(QJS, encoding='utf-8', newline='').read()

    # 硬约束：内联内容不得含 HTML 标签字面量（否则注入块的位置断言静默失效）
    for bad in ('</style', '</script', '<style', '<script'):
        if bad in qjs:
            print('[ERR] q.js 含标签字面量 %r' % bad)
            return 2
        if bad in HEAD or bad in TAIL:
            print('[ERR] §13 片段含标签字面量 %r' % bad)
            return 2

    # 定位主 IIFE 的收尾（最后一个 })(); ——  §12 也有一个，故取 rindex）
    stripped = pj.rstrip()
    assert stripped.endswith('})();'), 'patch.js 尾部结构变了，需人工确认'
    i = stripped.rindex('})();')

    block = HEAD + qjs.rstrip('\n') + '\n' + TAIL
    new = pj[:i] + block + pj[i:]

    # 行尾归一化：patch.js 本体为 LF
    new = new.replace('\r\n', '\n')
    lone = new.count('\n') - new.count('\r\n')
    assert lone == new.count('\n'), '不该出现 CRLF'

    io.open(PJ, 'w', encoding='utf-8', newline='').write(new)

    print('[1] §13 追加完成：patch.js %d → %d B（+%d）'
          % (len(pj.encode('utf-8')), len(new.encode('utf-8')),
             len(new.encode('utf-8')) - len(pj.encode('utf-8'))))
    print('    q.js 内联 %d B' % len(qjs.encode('utf-8')))
    print('[2] 断言：MARK 命中数 = %d（应为 1）' % new.count(MARK))
    print('    断言：无 HTML 标签字面量 = %s' % (not any(b in new for b in ('</style', '</script', '<style', '<script'))))
    print('    断言：主 IIFE 收尾仍唯一 = %s' % (new.count('\n})();') == 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
