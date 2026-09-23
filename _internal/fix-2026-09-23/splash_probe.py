# -*- coding: utf-8 -*-
"""
splash_probe.py —— 换底前的一次性实测：量出现开屏的
  ① 背景逐行底色（判断是「纯色 / 竖向渐变 / 有横向结构」）
  ② 品牌字标（红钥匙标 + Sinoky 字组）的精确 bbox
  ③ 熊猫角色区域 bbox
不写盘，只打印。
"""
import numpy as np
from PIL import Image

P = r"D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/assets/splash/a8_9x16.webp"
im = Image.open(P).convert("RGB")
a = np.asarray(im, dtype=np.int16)
H, W, _ = a.shape
r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
mx, mn = a.max(axis=2), a.min(axis=2)

print("尺寸 %dx%d" % (W, H))

print("\n=== ① 背景逐行底色（取左margin x=20..120 与 右margin x=%d..%d 的中位数）===" % (W - 120, W - 20))
print("   y | 左margin RGB        | 右margin RGB        | 左右一致性 Δ")
for y in range(0, H, 120):
    L = np.median(a[y, 20:120], axis=0)
    R = np.median(a[y, W - 120:W - 20], axis=0)
    print(" %4d | %-19s | %-19s | %.0f" % (y, tuple(L.astype(int)), tuple(R.astype(int)),
                                            float(np.abs(L - R).max())))
y = H - 1
L = np.median(a[y, 20:120], axis=0); R = np.median(a[y, W - 120:W - 20], axis=0)
print(" %4d | %-19s | %-19s | %.0f" % (y, tuple(L.astype(int)), tuple(R.astype(int)), float(np.abs(L - R).max())))

print("\n=== ② 横向结构检查：y=300 这一行（字标之上）逐 60px 取样 ===")
print("  " + "  ".join("%4d" % x for x in range(0, W, 60)))
for y in (60, 300, 1800):
    print("y=%4d " % y + "  ".join("%4d" % a[y, x].max() for x in range(0, W, 60)))

teal = ((g - r) > 6) & (b > r)
red = ((r - b) > 22) & ((r - g) > 12) & (r > 60)
white = (mn > 170) & ((mx - mn) < 55)

def bbox(mask, ylim=None, xlim=None, tag=""):
    m = mask.copy()
    if ylim:
        m[:ylim[0]] = False; m[ylim[1]:] = False
    if xlim:
        m[:, :xlim[0]] = False; m[:, xlim[1]:] = False
    ys, xs = np.where(m)
    if xs.size == 0:
        print("  %s: 空" % tag); return None
    bb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    print("  %-28s bbox=%s  w=%d h=%d  像素=%d" % (tag, bb, bb[2] - bb[0], bb[3] - bb[1], int(xs.size)))
    return bb

print("\n=== ③ 品牌字标 bbox（只在 y<800 内找 红/白 且非青瓷）===")
lock = (red | white) & ~teal
bb_lock = bbox(lock, ylim=(0, 800), tag="lockup(red|white)")
# 分开：红钥匙标 vs 白字
bbox(red & ~teal, ylim=(0, 800), tag="  其中 红")
bbox(white & ~teal, ylim=(0, 800), tag="  其中 白")

print("\n=== ④ 角色 bbox（y>760 的 红/白/黑 且非青瓷/非薄荷）===")
mint = ((g - r) > 12) & (mn > 140)
dark = mx < 70
char = (red | white | dark) & ~(teal | mint)
bbox(char, ylim=(760, H), tag="角色(粗)")

print("\n=== ⑤ 装饰元素统计（云纹/回纹 = 青瓷描线）===")
print("  teal 像素占比 %.2f%%" % (100.0 * teal.mean()))
print("  red  像素占比 %.2f%%" % (100.0 * red.mean()))
print("  white像素占比 %.2f%%" % (100.0 * white.mean()))
