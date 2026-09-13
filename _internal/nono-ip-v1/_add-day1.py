#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sinoky v0.23.7 —— 追加 §14 Day1 通关纪念卡（幂等 / 可重放）

做的事：
  ① 新增第 7 个分享卡主题 `day1`：Day 1 路径三个场景（arrival/self-intro/emergency）
     全部句子都说过时，生成一张里程碑成就卡
  ② 扩展 window.SHARE.pool()：全通才入池，权重 4
  ③ 设置 window.SHARE.TNAME.day1（面板主题名）
  ④ 包装 window.SHARE.draw：theme==='day1' 时接管绘制
     （未全通则落回主代码，画原有的 start 卡）
  ⑤ 包装 window.SHARE.text：day1 主题给一条贴题的分享文案
  ⑥ 行尾归一化 + 硬约束断言

核心手法（见 TAIL 里 drawDay1 的注释）：
  让**主代码自己**画框架/边饰/页脚/诺诺(§5)/二维码(§13) —— 临时把全局 `_stack`
  换成空函数，主代码的 else 分支照样构建 items 只是画不出来；随后用真 _stack 画本层内容。

跑法：python _add-day1.py             幂等（已存在则跳过）
      python _add-day1.py --reapply   删掉旧 §14 块再重新写入（脚本迭代时用）
"""
import io
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
PJ = os.path.join(BASE, 'patch.js')

MARK = '14. Day1 通关纪念卡'

# ---------------------------------------------------------------- §14 前缀（说明 + IIFE 开头）
HEAD = u"""  /* ---------- 14. Day1 通关纪念卡：「学完来华第一天」晒出去（P0 · 传播出口） ----------
     现状：分享卡有 line / streak / city / badge / report / start 六个主题，
       **没有一个是里程碑**。用户走完 Day 1 路径（arrival 5 句 + self-intro 11 句
       + emergency 14 句 = 30 句；句数随场景迭代会变，本层不硬编码、按 SCENES 现算）
       是产品里第一个真正「我做到了」的时刻 —— 而这个时刻没有任何东西可晒。
       招募手册 §7 第 2 项要的就是这张卡。

     ⚠️ 与规划稿有两处差异，都是查证代码后改的（依据见交付验收文档）：

       ① **口径**：手册写「学完来华第一天三步」。代码里 day1 的**权威定义**是
          `buildStat().day1Done` = 三个 day1 场景**全部句子都说过**，而且这个布尔量
          **已经在 M2 埋点里上报**。本层复用同一口径，绝不另立「走过三步就算」的软定义 ——
          两边算法不一致会让「App 说没通、卡片说通了」自相矛盾；而且软定义可以注水，
          晒出去没有说服力。

       ② **不放分数**（手册原话是「带分数的成就卡」）。三条理由：
          - 产品里唯一的持久化「分数」是 Tone Gym 正确率 `S.tone{right,total}`，
            它属于**另一个模块**，与 Day 1 三个对话场景没有因果关系 ——
            放到这张卡上是拼数据，不是成就；
          - 该分数**多数用户为 0**（没做过 Tone Gym）⇒ 卡片会出现空字段，
            而分享卡的设计原则是「绝不出空卡」（主代码 start 分支即为此存在）；
          - 故本卡只用**计数与二元事实**（3 场景全通 / 30 句），与既有六张卡
            「全部只用真实计数」的做法一致，也守住「不放没有数据源支撑的分数」红线。

     零新增：无文案键（分享卡文案是对外展示语，与既有六卡一致硬编码英文）、
       无埋点（day1Done 已在 buildStat 上报，`?s=&t=day1` 归因也已存在）、
       无 KV 写、无网络请求。

     不引入 drawImage：卡面只有文字、线条与印章。
  */
  (function () {
    if (typeof window.SHARE === 'undefined' || typeof window.SHARE.draw !== 'function') return;

    var C = window.SHARE.C, SANS = window.SHARE.SANS, SERIF = window.SHARE.SERIF;

    /* ---------- 判据：与主代码 buildStat() 的 day1Done 同口径 ----------
       主代码那段是 IIFE 内局部函数，注入层取不到，故按同一算法重算一遍。
       ⚠️ 改这里必须同步改主代码 buildStat()，否则两边会不一致。 */
    function day1Info() {
      try {
        var scs = (window.SCENES || []).filter(function (x) { return x && x.day1; });
        if (!scs.length) return null;
        var ph = (typeof S !== 'undefined' && S && S.phrases) || {};
        var rows = [], total = 0, ok = true;
        for (var i = 0; i < scs.length; i++) {
          var sc = scs[i];
          var all = (sc.phrases || []).length;
          var have = (ph[sc.id] || []).length;
          if (!all || have < all) ok = false;
          total += all;
          /* title 形如 "Arrival · First hours" ⇒ 取 " · " 前的部分（与主代码 litCity 同一手法） */
          rows.push({ id: sc.id, en: String(sc.title || '').split(' \\u00b7 ')[0] });
        }
        return ok ? { rows: rows, total: total } : null;
      } catch (e) { return null; }
    }
"""

# ---------------------------------------------------------------- §14 后缀（绘制 + 接入）
TAIL = u"""
    /* ---------- 唯一的自写原语：多字印章 ----------
       主代码 _seal(ctx,x,y,s) 的中心字**硬编码为「诺」**，本层要画另外三个字，
       故按同一参数（圆角 0.2s / 内框 0.13s / 字号 0.5s / 纸色字）重写一份。
       ⚠️ 若主代码 _seal 外观改了，这里要同步 —— 这是本层唯一需要盯的视觉漂移点。
       （其余视觉一律由主代码自己画，见下。） */
    function sealOf(ctx, ch, x, y, s) {
      var r = Math.round(s * 0.2);
      ctx.save();
      ctx.fillStyle = C.red;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, s, s, r); else ctx.rect(x, y, s, s);
      ctx.fill();
      ctx.strokeStyle = 'rgba(245,241,232,.5)'; ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x + s*0.13, y + s*0.13, s*0.74, s*0.74, r*0.55);
      else ctx.rect(x + s*0.13, y + s*0.13, s*0.74, s*0.74);
      ctx.stroke();
      ctx.fillStyle = C.paper; ctx.font = '600 ' + Math.round(s*0.5) + 'px ' + SERIF;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ch, x + s/2, y + s/2 + 1);
      ctx.restore();
    }

    /* ---------- 绘制整卡 ----------
       手法：**让主代码自己画框架 / 边饰 / 页脚 / 诺诺(§5) / 二维码(§13)**，本层只补内容。
       临时把全局 `_stack` 换成空函数 —— theme='day1' 不匹配主代码任何主题，天然落 else
       分支，它照样构建 items，只是画不出来；随后用真 _stack 画本层内容。

       为什么不用另外两条路（都实测踩过或推演过）：
         ✗ 自己画整张卡（用全局 _corner/_hui/_brand/_seal/_stack）：
           ① 视觉要重写一遍，主代码改外观就会漂移；
           ② 更致命 —— §5 的诺诺与 §13 的二维码都是**包装在 SHARE.draw 链上**的，
              本层若 return 自建 canvas，两个包装都不会执行。实测确认：第一版这么写，
              Day1 卡**缺诺诺、缺二维码**（探针在 x>820,y>840 抓到 6481 px 差异）。
         ✗ 先让主代码画 start 卡、再涂掉内容区重画：
           start 内容的包围盒与诺诺 / 二维码有交叠，覆盖范围取大取小都可能切到诺诺 ——
           而「让它根本没被画出来」是零风险的做法。
       ⚠️ _stack 是全局函数声明 ⇒ window._stack 的替换会影响主代码的标识符解析（已实测）。
          替换期间是同步的，没有别的调用者。 */
    function drawDay1(fmt) {
      var info = day1Info();
      if (!info) return null;                     /* 未全通：不接管，交回主代码 */
      fmt = (fmt === 'story') ? 'story' : (fmt === 'square' ? 'square' : window.SHARE.FMT);

      var realStack = window._stack;
      var blocked = 0;
      var cv = null;
      try {
        /* 主代码「画了但没画」。计数不是装饰：它是验收里唯一能证明
           「主代码的 start 内容确实没被画出来」的判据 —— 像素层比不出这件事
           （start 内容与 Day1 内容同在 [TOP,BOT] 内，差异永远存在）。
           变异测试：把这里改回 window._stack = window._stack（不拦截），
           __day1Blocked 不增长 ⇒ 验收当场变红。 */
        window._stack = function () { blocked++; };
        cv = _drawPrev.call(this, fmt);           /* 框架 + 页脚 + 诺诺 + 二维码 */
      } finally {
        window._stack = realStack;
        window.__day1Blocked = (window.__day1Blocked || 0) + blocked;
      }
      if (!cv) return cv;
      var ctx = cv.getContext('2d');
      if (!ctx) return cv;

      var W = 1080, PAD = 84, h = cv.height;
      var TOP = (fmt === 'story') ? 340 : 176;
      var BOT = (fmt === 'story') ? (h - 470) : 806;
      var maxW = W - PAD * 2 - 40;
      var sealS = (fmt === 'story') ? 116 : 96;
      var sealGap = (fmt === 'story') ? 30 : 26;
      var nick = (typeof window.SHARE.nick === 'function') ? window.SHARE.nick() : '';
      /* 每场景一枚印章，中心用该场景的语义汉字（与主代码 SHARE.BADGE 同手法） */
      var CH = { arrival: '\\u5230', 'self-intro': '\\u6211', emergency: '\\u6025' };

      var items = [];
      items.push({ t: 'DAY 1 COMPLETE', size: 26, font: SANS, color: C.goldDim, gap: 30 });
      if (nick) items.push({ t: nick, size: 26, font: SANS, color: 'rgba(245,241,232,.55)', gap: 24 });
      /* ⚠️ _stack 对 hook 项**不累加 gap**，故把间距并进 h */
      items.push({ h: sealS + 38, hook: function (c, cc, y) {
        var n = info.rows.length;
        var total = n * sealS + (n - 1) * sealGap;
        var x0 = cc - total / 2;
        for (var i = 0; i < n; i++) {
          var ch = CH[info.rows[i].id] || '\\u2713';   /* 兜底：对勾（场景增删时不至于空着） */
          sealOf(c, ch, Math.round(x0 + i * (sealS + sealGap)), Math.round(y), sealS);
        }
      } });

      var zi = '\\u6765\\u534e\\u7b2c\\u4e00\\u5929';   /* 来华第一天 */
      var big = _fit(ctx, zi, maxW, (fmt === 'story') ? 124 : 108, 60, SERIF, '600');
      items.push({ t: zi, size: big, font: SERIF, weight: '600', color: C.paper, gap: 34 });

      items.push({ t: info.rows.map(function (r) { return r.en; }).join(' \\u00b7 '),
                   size: 28, font: SANS, color: 'rgba(245,241,232,.62)', gap: 24 });
      items.push({ t: info.total + ' phrases said out loud',
                   size: 26, font: SANS, color: 'rgba(245,241,232,.46)', gap: 0 });

      _stack(ctx, W / 2, items, TOP, BOT);
      return cv;
    }
    window.__day1Draw = drawDay1;    /* 验收脚本用（只读，不参与渲染） */
    window.__day1Info = day1Info;

    /* ---------- 接入 ①：入池 ---------- */
    if (window.SHARE.TNAME) window.SHARE.TNAME.day1 = 'Day 1 complete';

    if (typeof window.SHARE.pool === 'function') {
      var _pool = window.SHARE.pool;
      window.SHARE.pool = function () {
        var p = _pool.apply(this, arguments) || [];
        try {
          var has = false;
          for (var i = 0; i < p.length; i++) if (p[i] && p[i].id === 'day1') has = true;
          /* 权重 4：高于 badge(1)/streak(2)/city(2)/report(2)，低于 line(5)。
             line 是「我今天说的那句话」，日常分享主力；Day 1 卡是里程碑，
             该经常被抽到、但不该盖掉日常卡。全通用户其它主题权重和 9~12，
             故本卡概率约 25%~31% —— 存在感明确，且 Shuffle 一按就换。 */
          if (!has && day1Info()) p.push({ id: 'day1', w: 4 });
        } catch (e) {}
        return p;
      };
    }

    /* ---------- 接入 ②：分享文案 ---------- */
    if (typeof window.SHARE.text === 'function') {
      var _text = window.SHARE.text;
      window.SHARE.text = function () {
        var info = (window.SHARE.theme === 'day1') ? day1Info() : null;
        if (!info) return _text.apply(this, arguments);
        /* 与卡片同一口径：只陈述真实句数与场景数，不编造、不提分数 */
        return 'I finished Day 1 of spoken Chinese \\u2014 ' + info.total +
               ' phrases out loud across ' + info.rows.length +
               ' real-life scenes. Learning with Sinoky (free) \\u2192 ' + window.SHARE.link();
      };
    }

    /* ---------- 接入 ③：接管绘制 ---------- */
    var _drawPrev = window.SHARE.draw;
    window.SHARE.draw = function (fmt) {
      if (window.SHARE.theme === 'day1') {
        var cv = drawDay1(fmt);
        if (cv) return cv;                        /* 未全通 → 落回主代码（画原有 start 卡） */
      }
      return _drawPrev.apply(this, arguments);
    };
  })();
"""

LINE_END = '\n  })();\n'


def remove_block(pj):
    """删掉已存在的 §14 块（含其前导换行）。返回 (新文本, 是否删过)。"""
    p = pj.find(MARK)
    if p < 0:
        return pj, False
    s = pj.rfind('\n', 0, p) + 1
    e = pj.find(LINE_END, p)
    if e < 0:
        raise RuntimeError('§14 块收尾（\\n  })();\\n）找不到，patch.js 结构异常')
    e += len(LINE_END)
    return pj[:s] + pj[e:], True


def main():
    reapply = '--reapply' in sys.argv
    pj = io.open(PJ, encoding='utf-8', newline='').read()
    before = len(pj.encode('utf-8'))

    if MARK in pj:
        if not reapply:
            print('[skip] §14 已存在（幂等）。要更新请用 --reapply')
            return 0
        pj, ok = remove_block(pj)
        print('[0] --reapply：移除旧 §14 块（%d → %d B）'
              % (before, len(pj.encode('utf-8'))))

    block = HEAD + TAIL

    # 硬约束：注入块不得含 HTML 标签字面量（否则位置断言会静默失效）
    for bad in ('</style', '</script', '<style', '<script'):
        if bad in block:
            print('[ERR] §14 片段含标签字面量 %r' % bad)
            return 2

    # 定位主 IIFE 的收尾（最后一个 })(); —— §12/§13 各有一个，故取 rindex）
    stripped = pj.rstrip()
    assert stripped.endswith('})();'), 'patch.js 尾部结构变了，需人工确认'
    i = stripped.rindex('})();')

    new = pj[:i] + block + pj[i:]

    # 行尾归一化：patch.js 本体为 LF
    new = new.replace('\r\n', '\n')
    assert new.count('\r\n') == 0, '不该出现 CRLF'

    io.open(PJ, 'w', encoding='utf-8', newline='').write(new)

    print('[1] §14 写入完成：patch.js %d → %d B（%+d）'
          % (before, len(new.encode('utf-8')),
             len(new.encode('utf-8')) - before))
    print('[2] 断言：MARK 命中数 = %d（应为 1）' % new.count(MARK))
    print('    断言：无 HTML 标签字面量 = %s'
          % (not any(b in new for b in ('</style', '</script', '<style', '<script'))))
    print('    断言：主 IIFE 收尾仍唯一 = %s' % (new.count('\n})();') == 1))
    print('    断言：无 CRLF = %s' % (new.count('\r\n') == 0))
    onlySeal = (all(('function %s(' % n) not in new
                    for n in ('corner', 'hui', 'brand', 'stack', 'fit'))
                and new.count('function sealOf(') == 1)
    print('    断言：自写原语只有 sealOf = %s' % onlySeal)
    print('    断言：接管手法是「换空 _stack」= %s'
          % ('window._stack = function () { blocked++; }' in new))
    return 0


if __name__ == '__main__':
    sys.exit(main())
