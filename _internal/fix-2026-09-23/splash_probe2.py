# -*- coding: utf-8 -*-
"""
splash_probe2.py —— 定位字标带的上下边界（找与角色之间的「空白谷」），并把字标裁出来存 PNG 供目视。
"""
import numpy as np
from PIL import Image

P = r"D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/assets/splash/a8_9x16.webp"
OUT = r"D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app/_internal/fix-2026-09-23/_probe_lockup.png"

im = Image.open(P).convert("RGB")
a = np.asarray(im, dtype=np.int16)
H, W, _ = a.shape
r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
mx, mn = a.max(axis=2), a.min(axis=2)
teal = ((g - r) > 6) & (b > r)
red = ((r - b) > 22) & ((r - g) > 12) & (r > 60)
white = (mn > 170) & ((mx - mn) < 55)
lock = (red | white) & ~teal

print("=== 逐行「红|白 非青瓷」像素数（每 10 行）y=0..1020 ===")
rows = lock.sum(axis=1)
for y in range(0, 1020, 10):
    n = int(rows[y])
    print(" %4d %5d %s" % (y, n, "#" * min(70, n // 12)))
