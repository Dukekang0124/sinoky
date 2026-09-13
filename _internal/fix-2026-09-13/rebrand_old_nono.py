# -*- coding: utf-8 -*-
"""
rebrand_old_nono.py —— 把仍是「旧版红卫衣诺诺」的 8 张素材，就地换成新版白卫衣诺诺。

背景（2026-09-13 康哥真机报障）：
  产品里 mascot/brand/onboard/empty 全是 Sep-12 定妆的新版 3D 诺诺（白卫衣），
  但 Sep-10 那批 banner/ share/ splash/ 里还是**旧版红卫衣**形象。
  实测这 8 张里只有 2 张被引用（index.html:3110 Me 页 banner、index.html:6281 Web Share），
  另 6 张零引用（含 sw.js 预缓存清单）——一并重制以绝后患（下次有人引用时不会又冒出旧形象）。

两种底板，两套抹除算法：
  【深色底板 6 张】底板是**竖向阳离子渐变**（实测 上 rgb(28,36,49) → 下 rgb(45,58,78)）
    ⇒ 逐列线性插值即可近乎完美抹除，且完全不碰角色之外的像素
      （斜切、云纹环、气泡、分享卡的文本圆角框全部原样保留）。
  【浅色底板 2 张】⚠️ 底板**不是**渐变，是「平色圆角卡片 + 深绿描边 + 平色奶油背景」的拼版
    ⇒ 竖向插值必然把「卡片底边框（水平线）」和「卡片右描边（竖直线）」糊掉 ⇒ 竖向拖影。
       改走**结构重建**：量出卡片圆角矩形 + 描边色 + 卡内色 + 背景色，
       把角色所占矩形整体重画成「卡片 / 描边 / 背景」三选一，再贴新角色。
       几何用「干净列探针」实测，并由 `--verify` 的差图自检（非角色区 mean|Δ| 必须 ≈0）。

⚠️ 踩过的坑（都写进代码注释，别再踩）：
  ① `column_runs` 只取「最长连续段」⇒ **耳朵那段短 run 被丢掉** ⇒ 旧耳朵从新角色背后露出。
     改成「所有长度 ≥ min_run 的 run 取首尾并集」。
  ② `erase()` 的下锚点 `yb+pad+1` 在**角色触到图片底边**时会落回角色自身像素
     ⇒ 白→红渐变。改成「锚点有效性判定 + 斜率外推」。
  ③ 浅色底板的掩码不能按「白 = 角色」（底板本身就是浅色，会把整幅吃掉）；
     也不能按「与原图大半径模糊的高频差异」（被大白卡片 + 描边 + 圆角结构撑满整图）。
     浅色底板直接**按矩形重建**，根本不需要精确掩码。

幂等：写盘前把产物 md5 记进 .rebrand_state.json；重跑时若当前文件 md5 == 记录值则跳过。

用法：
  python rebrand_old_nono.py --debug      # 只出 before/after 联络表，不写盘
  python rebrand_old_nono.py --verify     # 出结构重建自检差图，不写盘
  python rebrand_old_nono.py --only assets/share/dark-square.webp   # 只处理一张
  python rebrand_old_nono.py              # 正式写盘
"""
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HERE = os.path.dirname(os.path.abspath(__file__))
DBG = os.path.join(HERE, "tmp", "rebrand")
STATE = os.path.join(HERE, ".rebrand_state.json")

CHAR = os.path.join(APP, "assets", "brand", "nono-splash.webp")   # 新版全身（透明底，560x820）

# 8 张仍是旧形象的素材
TARGETS = [
    "assets/banner/square.webp",
    "assets/banner/horizontal.webp",
    "assets/banner/vertical.webp",
    "assets/share/dark-square.webp",
    "assets/share/dark-vertical.webp",
    "assets/share/light-square.webp",
    "assets/share/light-vertical.webp",
    "assets/splash/a8_9x16.webp",
]

# 浅色底板（走结构重建）
LIGHT_PLATES = {"assets/share/light-square.webp", "assets/share/light-vertical.webp"}

# 浅色底板参数：y_probe = 落在卡片竖直中段且**左右都不被角色挡住**的一行；
#             x_clean = 卡片内侧、**上下都不被角色挡住**的一列（用来探上下描边）。
#             两个数都是实测值（probe_light_geo / analyze_light 可复现）。
LIGHT_SPEC = {
    "assets/share/light-square.webp":   dict(y_probe=539, x_clean=200,
                                             search=(430, 600, 1080, 1080)),
    "assets/share/light-vertical.webp": dict(y_probe=300, x_clean=894,
                                             search=(120, 960, 860, 1900)),
}


# ---------------------------------------------------------------- 掩码 / bbox
def char_mask(im):
    """角色像素 = 红卫衣 / 白毛白卫衣 / 黑毛；先排除薄荷绿气泡、青绿底板、品牌红 logo。"""
    a = np.asarray(im.convert("RGB"), dtype=np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx, mn = a.max(axis=2), a.min(axis=2)
    mint = ((g - r) > 12) & (mn > 140)                 # 薄荷气泡
    teal = ((g - r) > 6) & (b > r) & (mx < 200)         # 青绿底板 / 文本圆角框
    red = ((r - b) > 22) & ((r - g) > 12) & (r > 60)     # 红卫衣含暗红阴影
    white = (mn > 170) & ((mx - mn) < 55)               # 白毛 / 白卫衣 / 浅灰
    dark = mx < 70                                      # 黑毛
    return (red | white | dark) & ~(mint | teal)


def char_mask_strong(im):
    """浅色底板专用：只认**红卫衣 + 黑毛**（奶油底板永不含这两种色）。"""
    a = np.asarray(im.convert("RGB"), dtype=np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    red = ((r - b) > 22) & ((r - g) > 12) & (r > 60)
    dark = a.max(axis=2) < 70
    return red | dark


def biggest_cluster(mask, gw=40, gh=40, thr=0.18):
    """粗网格 + 4 邻域 flood fill 找最大连通块 ⇒ 抗「零星误判像素把 bbox 撑大」。"""
    H, W = mask.shape
    ye = np.linspace(0, H, gh + 1).astype(int)
    xe = np.linspace(0, W, gw + 1).astype(int)
    g = np.zeros((gh, gw))
    for j in range(gh):
        for i in range(gw):
            blk = mask[ye[j]:ye[j + 1]:3, xe[i]:xe[i + 1]:3]
            g[j, i] = blk.mean() if blk.size else 0.0
    cells = {(i, j) for j in range(gh) for i in range(gw) if g[j, i] >= thr}
    best, seen = [], set()
    for c in cells:
        if c in seen:
            continue
        stack, comp = [c], []
        seen.add(c)
        while stack:
            i, j = stack.pop()
            comp.append((i, j))
            for nb in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if nb in cells and nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        if len(comp) > len(best):
            best = comp
    if not best:
        return None
    xs = [i for i, _ in best]
    ys = [j for _, j in best]
    x0, x1 = min(xs) * xe[1], min(W, (max(xs) + 1) * xe[1])
    y0, y1 = min(ys) * ye[1], min(H, (max(ys) + 1) * ye[1])
    sy, sx = np.where(mask[y0:y1, x0:x1])
    if sx.size == 0:
        return None
    return (x0 + int(sx.min()), y0 + int(sy.min()),
            x0 + int(sx.max()) + 1, y0 + int(sy.max()) + 1)


def column_runs(mask, box, W, min_run=6, gap=4):
    """逐列取**所有达标 run 的首→尾并集**。

    ⚠️ 坑①：只取「最长连续段」会**丢掉耳朵那段短 run** ⇒ 旧耳朵从新角色背后露出。
       改成并集后：耳朵(≈40px)与卫衣都保住，卡片描边/手机线稿这类 1~3px 细线仍被滤掉。"""
    x0, y0, x1, y1 = box
    cols = {}
    for x in range(x0, min(x1, W)):
        idx = np.where(mask[y0:y1, x])[0]
        if idx.size == 0:
            continue
        runs, start, prev = [], int(idx[0]), int(idx[0])
        for k in idx[1:]:
            k = int(k)
            if k - prev <= gap:
                prev = k
                continue
            runs.append((start, prev))
            start = prev = k
        runs.append((start, prev))
        keep = [r for r in runs if r[1] - r[0] + 1 >= min_run]
        if keep:
            cols[x] = (y0 + keep[0][0], y0 + keep[-1][1])
    return cols


def cols_bbox(cols):
    if not cols:
        return None
    xs = sorted(cols)
    return (xs[0], min(cols[x][0] for x in xs),
            xs[-1] + 1, max(cols[x][1] for x in xs) + 1)


def _grow_within(seed, allowed, scale=4, iters=18, size=9):
    """测地膨胀（grow within allowed）：只保留**与 seed 连通**的 allowed 像素。

    为什么需要它：角色的白毛/白卫衣与底板上的白色装饰（语音气泡的白描边、浅色光带）
    在颜色上完全一样，纯颜色掩码区分不了。但角色白毛**与角色核心（红卫衣/黑毛）相连**，
    底板装饰是孤立块 ⇒ 用「从核心出发、只在白∪核心内生长」就能干净分开。
    在 1/4 分辨率上跑（MaxFilter(9) 每步长 4px≈16px 原始像素），18 步≈288px，够用且快。
    """
    H, W = seed.shape

    def down(m):
        im = Image.fromarray((m * 255).astype(np.uint8), "L").resize(
            (max(1, W // scale), max(1, H // scale)), Image.NEAREST)
        return np.asarray(im) > 127

    g, al = down(seed), down(allowed)
    for _ in range(iters):
        gi = Image.fromarray((g * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(size))
        g2 = (np.asarray(gi) > 127) & al
        if np.array_equal(g2, g):
            break
        g = g2
    up = Image.fromarray((g * 255).astype(np.uint8), "L").resize((W, H), Image.NEAREST)
    return np.asarray(up) > 127


def char_mask_dark(im):
    """深色底板专用掩码：核心 = 红卫衣 + 近黑毛；白色只在**与核心连通**时才算角色。

    ⚠️ 坑⑨：直接用 `char_mask`（含 white）会把底板上的白色装饰一起抹掉并糊掉 ——
       实测 banner/vertical 语音气泡的白描边被抹成一团模糊。
       `dark` 阈值也要收紧到 mx<45：底板深蓝 (28,36,49) 的 mx=49 会被 mx<70 误纳
       （它的 (g-r)=8 仅比 teal 阈值 6 高一点点，很脆）。
    """
    a = np.asarray(im.convert("RGB"), dtype=np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx, mn = a.max(axis=2), a.min(axis=2)
    mint = ((g - r) > 12) & (mn > 140)
    teal = ((g - r) > 6) & (b > r) & (mx < 200)
    red = ((r - b) > 22) & ((r - g) > 12) & (r > 60)
    dark = mx < 45
    white = (mn > 170) & ((mx - mn) < 55)
    core = (red | dark) & ~(mint | teal)
    white_ok = white & _grow_within(core, white | core)
    return (core | white_ok) & ~(mint | teal)


# ---------------------------------------------------------------- 深色底板：逐列插值
def _strip_med(a, yc, offs, valid, W, H):
    """逐列取 yc+offs 这几行的**中位数**当锚点色。单像素取色会被抗锯齿晕圈带偏。"""
    idx = np.clip(yc[None, :] + np.asarray(offs)[:, None], 0, H - 1)
    med = np.median(a[idx, np.arange(W)[None, :]], axis=0)
    return np.where(valid[:, None], med, 0.0)


def _hmed(v, valid, W, half=10):
    """沿 x 做 ±half 列的中位数平滑（只用有效列）——消掉逐列跳变、保住横向大结构。"""
    out = np.zeros_like(v)
    for x in range(W):
        lo, hi = max(0, x - half), min(W, x + half + 1)
        m = valid[lo:hi]
        out[x] = np.median(v[lo:hi][m], axis=0) if m.any() else v[x]
    return out


def erase(im, cols, pad=6):
    """逐列填掉角色：上/下锚点用**中位数 + 水平平滑**取，再按该列局部斜率外推。

    ⚠️ 坑②：`yb+pad+1` 在**角色触到图片底边**时会落回角色自身像素（实测 banner/horizontal
       616 列、share/dark-square 351 列都触底）⇒ 白→红渐变。改成先判锚点有效性。
    ⚠️ 坑④：别用「全局中位数斜率」——短岛列（爪/耳那种几十像素的小掩码块，实测 dark-square
       x=583 跨度仅 31px）跨边界算出 ~0.4/px 的假斜率，外推 374px ⇒ 整块提亮 +180。
    ⚠️ 坑⑤：**单像素取锚**也不行。角色是白毛 + 深色描边，抗锯齿晕圈逐列剧烈跳变，
       实测 banner/vertical x=548 的「上锚」取到 (253,254,247) 纯白、dark-square x=581 取到
       (168,172,162)，逐列外推就成了**一列根竖向玻璃条带**（视觉上像碎玻璃）。
       ⇒ 锚点改「9 行中位数」+「±10 列中位数平滑」，斜率同理从两段平滑锚算出并钳位。
    """
    W, H = im.size
    a = np.asarray(im.convert("RGB"), dtype=np.float64)
    ya = np.full(W, -1, dtype=int)
    yb = np.full(W, -1, dtype=int)
    for x, (p, q) in cols.items():
        ya[x], yb[x] = p, q
    hav = ya >= 0
    ta = np.where(hav, np.maximum(0, ya - pad - 1), 0)
    tb = np.where(hav, np.minimum(H - 1, yb + pad + 1), 0)
    ok_t = hav & (ta < ya)                    # 上锚确实在角色之上
    ok_b = hav & (tb > yb)                    # 下锚确实在角色之下
    # ---- 锚点色：9 行中位数 + ±10 列中位数平滑（抗晕圈噪声）
    ctop = _hmed(_strip_med(a, ta, range(-8, 1), ok_t & (ta - 8 >= 0), W, H), ok_t, W)
    cbot = _hmed(_strip_med(a, tb, range(0, 9), ok_b & (tb + 8 < H), W, H), ok_b, W)
    cup = _hmed(_strip_med(a, ta, range(-48, -39), ok_t & (ta - 48 >= 0), W, H), ok_t, W)
    # ---- 局部背景斜率（上锚之上 40px 的差商），钳位防个别列踩到横向边缘
    sl_s = np.clip((ctop - cup) / 40.0, -0.10, 0.10)
    rows = np.arange(H)[:, None]
    y_lo = np.where(ok_t, ta, -1)             # 参与填充的 y 区间 (y_lo, y_hi)
    y_hi = np.where(ok_b, tb, H)
    inside = hav[None, :] & (rows > y_lo[None, :]) & (rows < y_hi[None, :])
    if not inside.any():
        return im
    t = np.clip((rows - ta[None, :]) / np.maximum(1, (tb - ta)[None, :]), 0, 1)
    fill_both = ctop[None, :, :] + (cbot - ctop)[None, :, :] * t[:, :, None]
    fill_slope = ctop[None, :, :] + (rows - ta[None, :])[:, :, None] * sl_s[None, :, :]
    fill = np.where(ok_b[None, :, None], fill_both, fill_slope)
    fill = np.where(ok_t[None, :, None], fill, cbot[None, :, :])
    a[inside] = np.round(fill[inside])
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


# ---------------------------------------------------------------- 多尺度扩散修复
def _sl(axis, s, nd):
    t = [slice(None)] * nd
    t[axis] = s
    return tuple(t)


def _box1d(a, r, axis):
    """沿 axis 做半径 r 的盒式模糊（边缘复制）。用前缀和，O(n)，float 精度安全。"""
    if r < 1:
        return a
    n = a.shape[axis]
    k = 2 * r + 1
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r, r)
    ap = np.pad(a, pad, mode="edge")
    z = np.zeros_like(np.take(ap, [0], axis=axis))
    c = np.concatenate([z, np.cumsum(ap, axis=axis)], axis=axis)      # 前缀和，前补 0
    hi = c[_sl(axis, slice(k, k + n), a.ndim)]
    lo = c[_sl(axis, slice(0, n), a.ndim)]
    return (hi - lo) / float(k)


def _blur_f(arr, r):
    """近似高斯模糊。⚠️ PIL 的 GaussianBlur 只吃 L/RGB 等整型模式，float('F') 会
    `ValueError: image has wrong mode` —— 所以自己用 3 次盒式（≈高斯）做。"""
    if r < 1:
        return arr.astype(np.float64)
    out = arr.astype(np.float64)
    for _ in range(3):
        out = _box1d(out, int(round(r)), 0)
        out = _box1d(out, int(round(r)), 1)
    return out


def dilate_mask(mask, iters=2, size=9):
    im = Image.fromarray((mask.astype(np.uint8) * 255), "L")
    for _ in range(iters):
        im = im.filter(ImageFilter.MaxFilter(size))
    return np.asarray(im) > 127


def pyramid_fill(im, mask, radii=(400, 200, 100, 50, 25, 12, 6, 3)):
    """多尺度归一化卷积修复（diffusion inpainting）。

    ⚠️ 坑⑥：为什么不用「逐列插值」——角色占据的是**二维区域**，而逐列填充本质是
       「把某一行像素向下挤出」。背景里任何横向/斜向结构（相框下边框、斜切色带、
       浅色光带）被挤出后就会变成**竖向条带**（实测 dark-square 出现「碎玻璃」、
       banner/vertical 出现细亮竖线），且掩码顶部被 box 裁平时整段共用同一行 ⇒ 更糟。
       改成由粗到细的归一化卷积，每一级只用「已知像素」做加权平均，未知处逐级细化
       ⇒ 得到**二维平滑重建**，不会出现挤出条带。

    ⚠️ 坑⑦：**最粗半径必须大于掩码尺寸**。用 64 起步、3 次盒式（支撑仅 387px）时，
       深色底板那 500px 宽的掩码中心区域归一化分母≈0 ⇒ 直接填成黑 —— 实测得到
       「一个旧熊猫形状的黑影」。改成 400 起步（支撑 ≈2400px）后覆盖全掩码。

    ⚠️ 坑⑧：**每一级都必须把上一级的结果当作输入，不能再用 w0 乘一遍**。
       原来写成 `num = blur(cur * w0)`：掩码区每级都被乘回 0，上一级的填充**永远传不到
       下一级**；到最小半径（3）时支撑只有 9px，分母≈0 ⇒ `0/1e-6 = 0` ⇒ 又填成黑。
       合成用例（纯色 100 + 中心 40×40 掩码）直接复现：期望 100，实得 0。
       ⇒ 第一级用归一化卷积（只用已知像素，避开旧角色自身的黑/红），之后逐级直接模糊。
    """
    a = np.asarray(im.convert("RGB"), dtype=np.float64)
    unk = mask.astype(bool)
    if not unk.any():
        return im
    w0 = (~unk).astype(np.float64)
    cur = a.copy()
    for i, r in enumerate(radii):
        if i == 0:
            den = _blur_f(w0, r)
            num = _blur_f(cur * w0[:, :, None], r)
            c = num / np.maximum(den, 1e-6)[:, :, None]
            # 掩码比支撑还大时（den≈0）退化为「已知像素全局均值」，绝不填黑
            if den.min() < 1e-4:
                gm = (a[w0 > 0].mean(axis=0) if (w0 > 0).any() else np.zeros(3))
                c = np.where((den < 1e-4)[:, :, None], gm[None, None, :], c)
        else:
            c = _blur_f(cur, r)          # cur 此时处处有值（掩码区是上一级填充）
        cur = np.where(unk[:, :, None], c, a)
    return Image.fromarray(np.clip(cur, 0, 255).astype(np.uint8), "RGB")


# ---------------------------------------------------------------- 浅色底板：结构重建
def plate_structure(a, y_probe, x_clean):
    """量出「圆角卡片 + 深绿描边 + 平色背景」的几何与三类平色。"""
    H, W = a.shape[:2]
    dark = (a.max(axis=-1) < 140) & (a[:, :, 1] >= a[:, :, 0] - 12)
    xs = np.where(dark[y_probe])[0]
    if xs.size < 2:
        raise RuntimeError("y_probe=%d 这行找不到左右描边" % y_probe)
    cl, cr = int(xs.min()), int(xs.max())
    col = dark[:, x_clean]
    ys = np.where(col)[0]
    if ys.size < 2:
        raise RuntimeError("x_clean=%d 这列找不到上下描边" % x_clean)
    ct, cb = int(ys.min()), int(ys.max())
    th = 1
    while ct + th < H and col[ct + th]:
        th += 1
    drow = np.where(dark[ct])[0]
    rad = max(8, int(drow.min()) - cl)
    border = np.median(a[ct:ct + th, cl + rad + 40: cr - rad - 40].reshape(-1, 3), axis=0)
    card = np.median(a[ct + 60: ct + 140, cl + rad + 60: cl + rad + 180].reshape(-1, 3), axis=0)
    bg = np.median(a[max(0, ct - 80): max(1, ct - 20), cl + 40: cl + 300].reshape(-1, 3), axis=0)
    return dict(l=cl, t=ct, r=cr, b=cb, th=th, rad=rad,
                border=np.round(border).astype(np.uint8),
                card=np.round(card).astype(np.uint8),
                bg=np.round(bg).astype(np.uint8))


def _rr_inside(xs, ys, l, t, r, b, rad, inset=0):
    L, T, R, B = l + inset, t + inset, r - inset, b - inset
    RR = max(0, rad - inset)
    dx = np.maximum(np.maximum(L + RR - xs, xs - (R - RR)), 0)
    dy = np.maximum(np.maximum(T + RR - ys, ys - (B - RR)), 0)
    return (xs >= L) & (xs <= R) & (ys >= T) & (ys <= B) & (np.hypot(dx, dy) <= RR)


def structure_plate(a, st, feather=12):
    """把整幅按结构重画成「卡片 / 描边 / 背景」，只在 rect 内使用（外面会与原图羽化缝合）。"""
    H, W = a.shape[:2]
    ys, xs = np.mgrid[0:H, 0:W]
    inner = _rr_inside(xs, ys, st["l"], st["t"], st["r"], st["b"], st["rad"], st["th"])
    outer = _rr_inside(xs, ys, st["l"], st["t"], st["r"], st["b"], st["rad"], 0)
    plate = np.empty((H, W, 3), dtype=np.float64)
    plate[...] = st["bg"]
    plate[outer] = st["border"]
    plate[inner] = st["card"]
    return plate


def rebuild_light(im, rect, st, feather=12, verify=None):
    """浅色底板抹除：rect 内按结构重建，边缘 feather 像素与原图羽化缝合（防「平色拼贴」露边）。"""
    a = np.asarray(im.convert("RGB"), dtype=np.float64)
    H, W = a.shape[:2]
    x0, y0, x1, y1 = rect
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W, x1), min(H, y1)
    plate = structure_plate(a, st)
    w = np.ones((y1 - y0, x1 - x0), dtype=np.float64)
    fs = min(feather, (x1 - x0) // 2 - 1, (y1 - y0) // 2 - 1)
    if fs > 1:
        ramp = np.linspace(0.0, 1.0, fs)
        if x0 > 0:
            w[:, :fs] = np.minimum(w[:, :fs], ramp[None, :])
        if x1 < W:
            w[:, -fs:] = np.minimum(w[:, -fs:], ramp[::-1][None, :])
        if y0 > 0:
            w[:fs, :] = np.minimum(w[:fs, :], ramp[:, None])
        if y1 < H:
            w[-fs:, :] = np.minimum(w[-fs:, :], ramp[::-1][:, None])
    out = a.copy()
    seg = out[y0:y1, x0:x1]
    seg[...] = seg * (1.0 - w[:, :, None]) + plate[y0:y1, x0:x1] * w[:, :, None]
    out = np.clip(out, 0, 255)
    if verify is not None:
        # 自检：结构模型只对「卡片周边」负责（卡片外的装饰不在模型里，整幅比毫无意义）。
        # 只看卡片圆角矩形外扩 4px、并挖掉角色所占矩形。
        ys2, xs2 = np.mgrid[0:H, 0:W]
        band = _rr_inside(xs2, ys2, st["l"], st["t"], st["r"], st["b"], st["rad"], -4)
        band[y0:y1, x0:x1] = False
        d = np.abs(plate - a)[band]
        verify.append((d.mean(), np.abs(plate - a).max()))
    return Image.fromarray(out.astype(np.uint8), "RGB")


# ---------------------------------------------------------------- 贴回
def paste_char(im, box, width_ratio=1.0, bottom_lift=0):
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    ch = Image.open(CHAR).convert("RGBA")
    scale = (bh * width_ratio) / ch.height
    nw, nh = max(1, round(ch.width * scale)), max(1, round(ch.height * scale))
    ch = ch.resize((nw, nh), Image.LANCZOS)
    cx = x0 + bw // 2 - nw // 2
    cy = y1 - nh + round(bh * 0.02) - bottom_lift
    im.paste(ch, (cx, cy), ch)
    return im


# ---------------------------------------------------------------- 主流程
def load_state():
    if os.path.isfile(STATE):
        try:
            return json.load(open(STATE, encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_state(st):
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2, sort_keys=True)


def contact(rel, orig, new, note):
    os.makedirs(DBG, exist_ok=True)
    a, b = orig.copy(), new.copy()
    t = 300
    a.thumbnail((t, t), Image.LANCZOS)
    b.thumbnail((t, t), Image.LANCZOS)
    canvas = Image.new("RGB", (a.width + b.width + 30, max(a.height, b.height) + 26), (245, 245, 248))
    d = ImageDraw.Draw(canvas)
    canvas.paste(a, (8, 22))
    canvas.paste(b, (a.width + 22, 22))
    d.text((10, 6), "OLD  " + os.path.basename(rel), fill=(190, 30, 30))
    d.text((a.width + 24, 6), "NEW  " + note, fill=(20, 120, 40))
    p = os.path.join(DBG, rel.replace("/", "__") + ".png")
    canvas.save(p)
    return p


def process(rel, im, debug=False, verify_mode=False):
    light = rel in LIGHT_PLATES
    if light:
        spec = LIGHT_SPEC[rel]
        mask = char_mask_strong(im)
        cols = column_runs(mask, spec["search"], im.width, min_run=12, gap=6)
        box = cols_bbox(cols)
        if not box:
            raise RuntimeError("找不到角色区域")
        st = plate_structure(np.asarray(im.convert("RGB"), dtype=np.int16),
                             spec["y_probe"], spec["x_clean"])
        print("     卡片 l=%d t=%d r=%d b=%d 厚=%d 圆角=%d | 描边%s 卡内%s 背景%s"
              % (st["l"], st["t"], st["r"], st["b"], st["th"], st["rad"],
                 tuple(st["border"]), tuple(st["card"]), tuple(st["bg"])))
        pad = 16
        rect = (box[0] - pad, box[1] - pad, box[2] + pad, min(im.height, box[3] + pad))
        vf = [] if (debug or verify_mode) else None
        im2 = rebuild_light(im, rect, st, feather=12, verify=vf)
        if vf:
            print("     结构自检：非角色区 mean|Δ|=%.2f  最大|Δ|=%d  %s"
                  % (vf[0][0], vf[0][1], "OK" if vf[0][0] < 3 else "✗ 几何/取色有误"))
        # 角色触到底边时，把新角色整体上提一点，露出脚（旧角色是被底边裁掉的）
        lift = 14 if box[3] >= im.height - 2 else 0
        im2 = paste_char(im2, box, width_ratio=0.98, bottom_lift=lift)
        note = "box=%s rect=%s" % (box, rect)
        return im2, note

    full = char_mask_dark(im)
    box = biggest_cluster(full)
    if not box:
        raise RuntimeError("找不到角色区域")
    # 只取 box 范围内的掩码（背景里可能出现同类色元素，别一起抹掉），
    # 再向外膨胀 ~8px 吃掉角色抗锯齿晕圈，否则填完会留一圈亮边。
    sub = np.zeros_like(full)
    x0, y0, x1, y1 = box
    sub[y0:y1, x0:x1] = full[y0:y1, x0:x1]
    m = dilate_mask(sub, iters=2, size=9)
    im2 = pyramid_fill(im, m)
    # 新版全身比旧版「挥手半身」窄，按 bbox 高度贴会显得体量偏小 ⇒ 深色这 6 张是
    # 装饰主图，放大 1.15 找回存在感（浅色那 2 张是内容模板，卡片要留白，保持 1.0）。
    im2 = paste_char(im2, box, width_ratio=1.15)
    note = "box=%s 掩码=%dpx" % (box, int(m.sum()))
    return im2, note


def main():
    debug = "--debug" in sys.argv
    verify_mode = "--verify" in sys.argv
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
    st = load_state()
    done = 0
    for rel in TARGETS:
        if only and rel != only:
            continue
        p = os.path.join(APP, rel)
        if not os.path.isfile(p):
            print("  !! 缺文件 %s" % rel)
            continue
        raw = open(p, "rb").read()
        h_in = hashlib.md5(raw).hexdigest()
        if st.get(rel) == h_in and not (debug or verify_mode):
            print("  [skip] %-36s 已是重制版" % rel)
            continue
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        try:
            im2, note = process(rel, im, debug=debug, verify_mode=verify_mode)
        except Exception as e:
            print("  !! %-36s %s" % (rel, e))
            continue
        buf = io.BytesIO()
        im2.save(buf, "WEBP", quality=90, method=6)
        data = buf.getvalue()
        if debug or verify_mode:
            q = contact(rel, im, im2, note)
            print("  [dbg ] %-36s %s" % (rel, note))
            if verify_mode:
                diff = Image.fromarray(
                    (np.abs(np.asarray(im2, dtype=np.int16) - np.asarray(im, dtype=np.int16))
                     .max(axis=2) * 3).clip(0, 255).astype(np.uint8))
                diff.save(os.path.join(DBG, "DIFF__" + rel.replace("/", "__") + ".png"))
            continue
        with open(p, "wb") as f:
            f.write(data)
        st[rel] = hashlib.md5(data).hexdigest()
        done += 1
        print("  \u2713 %-36s %s  %d B → %d B" % (rel, note, len(raw), len(data)))
    if debug or verify_mode:
        print("\n  图目录：%s" % DBG)
    else:
        save_state(st)
        print("\n  已写盘 %d 张；state=%s" % (done, os.path.basename(STATE)))


if __name__ == "__main__":
    main()
