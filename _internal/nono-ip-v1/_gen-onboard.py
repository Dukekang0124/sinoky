#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成首启引导（onboard）插画 —— 把 5 张人类男性插画换成诺诺熊猫。

背景（康哥 2026-09-12 决策 3）：assets/onboard/ 原为「人类男性」插画（1 张 3D 渲染感 +
4 张扁平矢量），与产品吉祥物不符，统一替换为诺诺熊猫。

关键约束（决定实现方式）：
  · main.webp   显示 280px 宽（CSS `.ob-il img{width:min(74vw,280px)}`）⇒ 保持 800×600，
    大图下比例协调，且该处是页面主视觉，改比例会挤压首屏。
  · step1~4     显示 96px 宽（CSS `.ob-steps img{width:23%;max-width:96px}`，**只给宽不给高**）
    ⇒ 原 800×600（4:3）在 96px 下只渲染 96×72；改用 **1:1 方图** 后渲染 96×96，
      主体可见尺寸提升约 33%，且四张并排等高、更整齐。`.ob-screen` 有 overflow:auto 兜底。
  · 原 4 张横图压到 96px 时细节全糊 —— 这正是「画风混用」观感的来源。

姿态映射（都取自 assets/mascot/，同一批 3D 定妆 ⇒ 画风天然统一）：
  main        → wave    （挥手欢迎）
  step1-pinyin→ point   （指着教拼音）
  step2-listen→ listen  （戴着耳机听）
  step3-speak → cheer   （开口说，欢呼鼓励）
  step4-score → like    （点赞，评分通过）

用法：python _gen-onboard.py [--check]
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

BG = (20, 26, 36)          # #141a24 品牌深青黑
GLOW = (138, 184, 178)     # #8ab8b2 品牌青绿（副色，柔和光晕）

MAP = [
    ('main.webp',          'wave.webp',   (800, 600)),
    ('step1-pinyin.webp',  'point.webp',  (512, 512)),
    ('step2-listen.webp',  'listen.webp', (512, 512)),
    ('step3-speak.webp',   'cheer.webp',  (512, 512)),
    ('step4-score.webp',   'like.webp',   (512, 512)),
]

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OB = os.path.join(REPO, 'assets', 'onboard')
MASCOT = os.path.join(REPO, 'assets', 'mascot')


def compose(src: str, size) -> Image.Image:
    """把诺诺贴到品牌底上（青绿柔和光晕 + 居中），画布尺寸由 size 指定。"""
    W, H = size
    base = Image.new('RGBA', (W, H), BG + (255,))

    gl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(gl).ellipse(
        [-W * 0.10, -H * 0.25, W * 1.10, H * 1.05], fill=GLOW + (58,))
    gl = gl.filter(ImageFilter.GaussianBlur(int(min(W, H) * 0.15)))
    base = Image.alpha_composite(base, gl)

    m = Image.open(src).convert('RGBA')
    lim = int(min(W, H) * 0.92)
    m.thumbnail((lim, lim), Image.LANCZOS)
    base.alpha_composite(m, ((W - m.width) // 2, (H - m.height) // 2))
    return base.convert('RGB')


def main() -> int:
    check = '--check' in sys.argv
    acts, bad = [], []
    for out_name, src_name, size in MAP:
        src = os.path.join(MASCOT, src_name)
        dst = os.path.join(OB, out_name)
        if not os.path.exists(src):
            bad.append('姿态素材缺失: %s' % src)
            continue
        if check:
            acts.append('CHECK %-20s ← %-12s %s' % (out_name, src_name, size))
            continue
        compose(src, size).save(dst, 'WEBP', quality=92, method=6)
        acts.append('%-20s ← %-12s %6d B  %s'
                    % (out_name, src_name, os.path.getsize(dst), Image.open(dst).size))

    print('\n'.join('  ' + a for a in acts))
    if bad:
        print('\n'.join('  ✗ ' + b for b in bad))
        return 1
    print('\n%s：%d 张' % ('校验通过' if check else '已生成', len(acts)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
