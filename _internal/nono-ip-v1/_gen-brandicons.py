#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成品牌红字标图标（PWA + APK 全密度）—— 权威源 = 04-品牌设计/assets/第二轮/sinoky-图标-平齿主选.svg

为什么手绘而不用 SVG 渲染器：本机无 cairosvg；而该 SVG 的全部图形只有 4 个 rect +
1 个 polygon + 1 个 evenodd 圆环，坐标已完全确定，用 Pillow 按同坐标重绘等价且零依赖。
4x 超采样保证圆角/斜边边缘干净。

素材身份（红线）：品牌字标 ≠ 吉祥物。本脚本只产「红字标」，绝不产熊猫。
  - 背景 rect 0,0,1024,1024 rx=228  fill=#141a24  （深青黑）
  - 4 个 rect（门形：左柱 + 上梁 + 右柱上下两截=锁孔）
  - 1 个 polygon（平齿钥匙）
  - 1 个 evenodd 圆环（匙弓，中心 900,502 / 外 82 / 内 32）
  - 全部前景色 fill=#e63946（朱砂红）

用法：python _gen-brandicons.py            # 生成全部
      python _gen-brandicons.py --check    # 只校验尺寸/存在性，不写
"""
import os
import sys
import shutil
from PIL import Image, ImageDraw

# ---------- 权威几何（直接抄自 sinoky-图标-平齿主选.svg，勿改） ----------
VB = 1024
BG = (20, 26, 36, 255)        # #141a24
RED = (230, 57, 70, 255)      # #e63946
BG_RADIUS = 228
RECTS = [                      # x, y, w, h, rx
    (232, 232, 112, 560, 46),  # 门 · 左柱
    (232, 232, 512, 112, 46),  # 门 · 上梁
    (684, 232, 112, 222, 46),  # 门 · 右柱上半
    (684, 566, 112, 226, 46),  # 门 · 右柱下半（与上半之间 = 锁孔）
]
KEY_PATH = [                   # 平齿钥匙（x,y 顺序与 SVG 一致）
    (356, 468), (812, 468), (812, 536), (472, 536), (472, 564),
    (426, 564), (426, 540), (388, 540), (388, 576), (356, 576),
]
BOW = (900, 502, 82, 32)       # 匙弓：cx, cy, r_outer, r_inner
# 前景图形包围盒（由上面几何推出，用于居中）
FBOX = (232, 232, 982, 792)    # 右缘 900+82=982；下缘 232+560=792

SS = 4                         # 超采样倍数

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BRAND = os.path.join(os.path.dirname(REPO), '04-品牌设计', 'assets', '第二轮')
DENSITIES = [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216),
             ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]


def _draw(bg: bool, size: int = VB, ss: int = SS) -> Image.Image:
    """在 size² 的 RGBA 画布上按 SVG 坐标重绘。bg=True 画深青黑底，False 只画红图形（透明底）。"""
    S = size * ss
    k = S / VB
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bg:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=BG_RADIUS * k, fill=BG)

    for (x, y, w, h, rx) in RECTS:
        d.rounded_rectangle([x * k, y * k, (x + w) * k - 1, (y + h) * k - 1],
                            radius=rx * k, fill=RED)
    d.polygon([(px * k, py * k) for (px, py) in KEY_PATH], fill=RED)

    cx, cy, ro, ri = BOW
    cx, cy, ro, ri = cx * k, cy * k, ro * k, ri * k
    d.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], fill=RED)
    # 匙弓镂空：整图版露出底色，前景版挖成透明（Pillow 直写像素，不做 alpha 混合）
    d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=BG if bg else (0, 0, 0, 0))

    return img.resize((size, size), Image.LANCZOS)


def _circle_mask(size: int, ss: int = SS) -> Image.Image:
    m = Image.new('L', (size * ss, size * ss), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size * ss - 1, size * ss - 1], fill=255)
    return m.resize((size, size), Image.LANCZOS)


def _foreground(size: int, fill_ratio: float = 0.60) -> Image.Image:
    """红图形（透明底），按包围盒居中缩放到 fill_ratio × 画布宽。"""
    master = _draw(bg=False, size=VB * SS, ss=1)          # 直接高位图画
    S = VB * SS
    k = S / VB
    box = (int(FBOX[0] * k), int(FBOX[1] * k), int(FBOX[2] * k), int(FBOX[3] * k))
    crop = master.crop(box)
    tw = int(size * fill_ratio)
    th = max(1, int(tw * crop.height / crop.width))
    crop = crop.resize((tw, th), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(crop, ((size - tw) // 2, (size - th) // 2), crop)
    return out


def main() -> int:
    check = '--check' in sys.argv
    icons_dir = os.path.join(REPO, 'icons')
    apk_dir = os.path.join(REPO, 'apk-icons')
    actions, problems = [], []

    # ---------- A. PWA 图标：直接取品牌源，保证与品牌设计逐字节同源 ----------
    # 🔴 PNG 必须 shutil.copyfile 逐字节复制，不可用 Pillow 重新编码
    #    （Pillow 会把 4,989 B 的品牌源重编码成 4,302 B，md5 变化 ⇒ 违反红线）
    #    WebP 因品牌源无 webp，只能转码；但尺寸/画面必须与 PNG 源一致。
    pairs = [
        (os.path.join(BRAND, 'sinoky-图标-192.png'), os.path.join(icons_dir, 'icon-192.png'), 'copy'),
        (os.path.join(BRAND, 'sinoky-图标-512.png'), os.path.join(icons_dir, 'icon-512.webp'), 'webp'),
    ]
    for src, dst, how in pairs:
        if not os.path.exists(src):
            problems.append('品牌源缺失 %s' % src)
            continue
        if check:
            actions.append('CHECK %s ← %s [%s]' % (os.path.basename(dst), os.path.basename(src), how))
            continue
        if how == 'copy':
            shutil.copyfile(src, dst)
        else:
            Image.open(src).convert('RGB').save(dst, 'WEBP', quality=92, method=6)
        actions.append('%s ← %s (%d B)' % (os.path.basename(dst), os.path.basename(src), os.path.getsize(dst)))

    # ---------- B. APK 图标：按密度全量重绘 ----------
    for dens, launcher, fg in DENSITIES:
        d_dir = os.path.join(apk_dir, 'mipmap-%s' % dens)
        if not os.path.isdir(d_dir):
            problems.append('密度目录缺失 %s' % d_dir)
            continue
        if check:
            actions.append('CHECK mipmap-%-8s launcher=%d fg=%d' % (dens, launcher, fg))
            continue

        base = _draw(bg=True, size=launcher)
        base.save(os.path.join(d_dir, 'ic_launcher.png'), 'PNG', optimize=True)

        rnd = _draw(bg=True, size=launcher)
        rnd.putalpha(_circle_mask(launcher))
        rnd.save(os.path.join(d_dir, 'ic_launcher_round.png'), 'PNG', optimize=True)

        bgim = Image.new('RGB', (fg, fg), BG[:3])
        bgim.save(os.path.join(d_dir, 'ic_launcher_background.png'), 'PNG', optimize=True)

        _foreground(fg).save(os.path.join(d_dir, 'ic_launcher_foreground.png'), 'PNG', optimize=True)
        actions.append('mipmap-%-8s launcher=%d bg/fg=%d' % (dens, launcher, fg))

    print('\n'.join('  ' + a for a in actions))
    if problems:
        print('\n'.join('  ✗ ' + p for p in problems))
        return 1
    print('\n%s：%d 项' % ('校验通过' if check else '已生成', len(actions)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
