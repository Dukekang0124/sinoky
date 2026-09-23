# -*- coding: utf-8 -*-
"""
splash_rebuild.py —— 开屏图 assets/splash/a8_9x16.webp 从
「青瓷底 + 云纹/回纹 + 山形波 + 金」旧语言，换到「静默仪表」石墨底（v0.24.0 P1）。

━━ 为什么是程序化换底，不是 AI 生图 ━━
 ① 原图里的熊猫**已经是新版白卫衣 3D 定妆**（实测就是 assets/brand/nono-splash.webp，
    与浮标 / 面板头 / 展开全身同一张 —— 见 rebrand_old_nono.py 的 CHAR）。AI 重生成
    会漂移这个来之不易的 look-lock，且「AI 出不准品牌色」是已知硬事实。
 ② 品牌字标（红钥匙标 + Sinoky 字组）在仓库里**没有矢量源**，是烘焙进光栅的。
    品牌字标是红线（见 MEMORY.md §4）⇒ 只能**精确抠出**，绝不能重画。
 ③ 程序化换底能保证「图的上/下/左/右四边精确等于 #141a24」—— 这是消除
    #splash 在非 9:16 屏上 letterbox 接缝的唯一可靠办法（原 #0E3739 就是图内补色）。

━━ 三个候选（同一角色、同一字标，只换底）━━
  v1 静默  graphite 柔光 + 一条单薄朱砂信号线（最克制）
  v2 信号  graphite + 屏中低幅「声波基线」横贯（左右露出 = 给角色做画框）
  v3 刻度  graphite + 同心刻度环 + 12 点朱砂刻度（仪表盘）

用法：
  python splash_rebuild.py --extract          # 只抠字标，存 _lockup.png + 目视校验图
  python splash_rebuild.py --build all        # 出三版 1080x1920（PNG 母版 + WebP）
  python splash_rebuild.py --contact          # 出对照联络表
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(APP, "assets", "splash", "a8_9x16.webp")
CHAR = os.path.join(APP, "assets", "brand", "nono-splash.webp")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "splash")
LOCKUP_PNG = os.path.join(OUT, "_lockup.png")

W, H = 1080, 1920
BG = np.array([20, 26, 36], dtype=np.float64)        # --bg    #141a24
BG2 = np.array([26, 32, 41], dtype=np.float64)       # --bg2   #1a2029
CARD = np.array([30, 37, 48], dtype=np.float64)      # --card  #1e2530
LINE = np.array([44, 53, 66], dtype=np.float64)      # --line  #2c3542
LINE_STRONG = np.array([58, 69, 83], dtype=np.float64)  # --line-strong  #3a4553
RED = np.array([230, 57, 70], dtype=np.float64)      # --red   #e63946

# 字标带实测（splash_probe2.py：y 400..550 非零，560..720 为空谷）
BAND_Y = (392, 562)
LOCKUP_PAD = 6


# ══════════════════════════════════════════════════ 1. 抠品牌字标
def _unblend(px, bg, palette):
    """已知背景与候选前景色，反解 alpha 并挑残差最小的前景色。

   模型 px = bg*(1-a) + fg*a，对每支前景色用最小二乘解 a 再算残差：解出的 a 让
   「按该 a 混合出来的颜色」与真实像素最接近。对双色品牌稿很稳，因为红与白在青瓷底上的
   方向差极大（红偏 +r、白三通道同增），不会互相串。

   `bg` 支持**逐行背景** (h,3)：原图底色是竖向轻渐变（实测首末更暗），
   用单一常数背景会在上下端产生系统性偏差 ⇒ 直接给逐行色。
   """
    bg3 = bg[:, None, :] if bg.ndim == 2 else bg            # (h,1,3) → 广播到 (h,w,3)
    px3 = px
    best_a = np.zeros(px.shape[:2], dtype=np.float64)
    best_r = np.full(px.shape[:2], 1e18, dtype=np.float64)
    best_c = np.zeros(px.shape[:2], dtype=np.int16)
    for i, fg in enumerate(palette):
        d = fg[None, None, :].astype(np.float64) - bg3      # (h,w,3)
        dd = (d * d).sum(axis=2)                            # (h,w)
        proj = ((px3 - bg3) * d).sum(axis=2) / np.maximum(dd, 1e-6)
        a = np.clip(proj, 0.0, 1.0)
        rec = bg3 + a[:, :, None] * d
        res = np.linalg.norm(px3 - rec, axis=2)
        take = res < best_r
        best_r = np.where(take, res, best_r)
        best_a = np.where(take, a, best_a)
        best_c = np.where(take, i, best_c)
    return best_a, best_r, best_c


def extract_lockup(verbose=True):
    im = Image.open(SRC).convert("RGB")
    a = np.asarray(im, dtype=np.float64)
    if a.shape[0] != H or a.shape[1] != W:
        raise RuntimeError("源图尺寸变了：%s" % (a.shape,))

    y0, y1 = BAND_Y
    # 逐行背景色：取左右干净 margin 的中位数（字标带内横向无结构，实测 Δ≤6）
    bgs = []
    for y in range(y0, y1):
        prof = np.vstack([a[y, 20:180], a[y, W - 180:W - 20]])
        bgs.append(np.median(prof, axis=0))
    bgs = np.asarray(bgs)                              # (y1-y0, 3)

    band = a[y0:y1]
    # 自动取调色板：红 = 红掩膜像素中位数；白 = 近白掩膜中位数
    r, g, b = band[:, :, 0], band[:, :, 1], band[:, :, 2]
    mx, mn = band.max(axis=2), band.min(axis=2)
    redm = ((r - b) > 22) & ((r - g) > 12) & (r > 60)
    whitem = (mn > 170) & ((mx - mn) < 55)
    pal_red = np.median(band[redm], axis=0) if redm.any() else RED
    pal_white = np.median(band[whitem], axis=0) if whitem.any() else np.array([255.0] * 3)
    if verbose:
        print("  调色板：红=%s  白=%s" % (tuple(pal_red.astype(int)), tuple(pal_white.astype(int))))

    al, res, ci = _unblend(band, bgs, [pal_red, pal_white])
    al = np.where(res > 34, 0.0, al)                   # 残差太大 ⇒ 与两支品牌色都不像 ⇒ 不是字标
    al = np.where(al < 0.06, 0.0, al)
    rgba = np.zeros((y1 - y0, W, 4), dtype=np.uint8)
    for i, fg in enumerate([pal_red, pal_white]):
        m = ci == i
        rgba[m, 0] = int(round(fg[0])); rgba[m, 1] = int(round(fg[1])); rgba[m, 2] = int(round(fg[2]))
    rgba[:, :, 3] = np.round(al * 255).astype(np.uint8)

    ys, xs = np.where(rgba[:, :, 3] > 8)
    if xs.size == 0:
        raise RuntimeError("抠不到字标")
    bb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    if verbose:
        print("  字标 bbox（带内坐标）=%s  w=%d h=%d" % (bb, bb[2] - bb[0], bb[3] - bb[1]))

    # 自检：把抠出的字标按原始 bg 重新合成回原带 → 与原带的差
    yy, xx = np.mgrid[y0:y1, 0:W]
    bgpix = bgs[yy - y0]
    rec = bgpix * (1 - al[:, :, None]) + rgba[:, :, :3].astype(np.float64) * al[:, :, None]
    diff = np.abs(rec - band)
    if verbose:
        print("  自检：重建 vs 原带  mean|Δ|=%.2f  p99=%.2f  max=%.0f"
              % (diff.mean(), np.percentile(diff, 99), diff.max()))

    return rgba, bb, bgs, pal_red, pal_white, diff, band


def cmd_extract():
    os.makedirs(OUT, exist_ok=True)
    rgba, bb, bgs, pr, pw, diff, band = extract_lockup()
    crop = rgba[bb[1]:bb[3], bb[0]:bb[2]]
    Image.fromarray(crop, "RGBA").save(LOCKUP_PNG)
    # 目视校验图：原带 | 抠出的字标贴到纯黑 | 贴到青瓷 | 差图
    h, w = crop.shape[:2]
    view = Image.new("RGB", (w * 4 + 30, h), (128, 128, 128))
    view.paste(Image.fromarray(band[bb[1]:bb[3], bb[0]:bb[2]].astype(np.uint8), "RGB"), (0, 0))
    blk = Image.new("RGB", (w, h), (0, 0, 0)); blk.paste(Image.fromarray(crop, "RGBA"), (0, 0), Image.fromarray(crop, "RGBA"))
    view.paste(blk, (w + 10, 0))
    grp = Image.new("RGB", (w, h), tuple(BG.astype(int))); grp.paste(Image.fromarray(crop, "RGBA"), (0, 0), Image.fromarray(crop, "RGBA"))
    view.paste(grp, (2 * w + 20, 0))
    dmax = (diff[bb[1]:bb[3], bb[0]:bb[2]].max(axis=2) * 4).clip(0, 255).astype(np.uint8)
    view.paste(Image.fromarray(np.dstack([dmax] * 3), "RGB"), (3 * w + 30 - 30, 0))
    view = view.resize((view.width * 2, view.height * 2), Image.LANCZOS)
    view.save(os.path.join(OUT, "_lockup_check.png"))
    print("  写出 %s / _lockup_check.png（带内原图 | 贴黑 | 贴石墨 | ×4 差图）" % os.path.basename(LOCKUP_PNG))


# ══════════════════════════════════════════════════ 2. 石墨底 + 三种母题
def base_graphite(soft=0.85):
    """四边精确回落到 --bg 的柔光底：t = sin(πx/W)^p * sin(πy/H)^p。
    为什么要四边归零：非 9:16 屏（尤其桌面宽屏）会在左右/上下露出 #splash 自己的底色，
    只有图边 == 底色才能做到无缝。"""
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    tx = np.sin(np.pi * xs / W) ** 0.85
    ty = np.sin(np.pi * ys / H) ** 0.85
    t = (tx * ty)[:, :, None] * soft
    return BG[None, None, :] + (BG2 - BG)[None, None, :] * t


def _blend(img, color, alpha):
    return img * (1 - alpha[:, :, None]) + color[None, None, :] * alpha[:, :, None]


def _soft_line(img, y, color, thick=2.0, feather=1.6, x0=0, x1=W):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    d = np.abs(ys - y)
    a = np.exp(-((d / (thick / 2.0 + feather)) ** 2))
    a[(xs < x0) | (xs > x1)] = 0.0
    return _blend(img, color, a)


def _ring(img, cx, cy, R, color, thick=2.0, alpha=1.0):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    d = np.hypot(xs - cx, ys - cy)
    a = np.exp(-(((d - R) / (thick / 2.0 + 1.2)) ** 2)) * alpha
    return _blend(img, color, a)


def _vignette(img, cx, cy, rx, ry, color, strength):
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    d = np.hypot((xs - cx) / rx, (ys - cy) / ry)
    a = np.clip(1.0 - d, 0, 1) ** 1.8 * strength
    return _blend(img, color, a)


def motif_silent(img):
    """v1 静默：只加一条短朱砂横线（字标之下的「信号刻度」）。"""
    img = _soft_line(img, 620.0, RED, thick=3.0, feather=1.4, x0=W / 2 - 62, x1=W / 2 + 62)
    return img


def motif_signal(img):
    """v2 信号：底部一排「电平条」（音频仪表语汇），最高那根染朱砂。

    为什么放底部而不是屏中：角色脚底在 y=1730，条带 1700..1814 与脚背有重叠 ⇒
    形成自然的前后关系；放屏中会被角色吃掉 85%（第一版实测只剩两条零散细线，不成形）。"""
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    base = 1814.0
    n, x0, x1 = 46, 92.0, 988.0
    step = (x1 - x0) / (n - 1)
    hot = int(round(n * 0.70))
    for i in range(n):
        cx = x0 + i * step
        u = i / float(n - 1)
        env = (0.5 + 0.5 * np.sin(np.pi * u)) * (0.42 + 0.58 * abs(np.sin(i * 0.83 + 0.4)))
        top = base - (22.0 + 116.0 * env)
        a = np.exp(-((np.abs(xs - cx) / 5.4) ** 6))
        a = a * np.clip((ys - top) / 1.4, 0, 1) * np.clip((base - ys) / 1.4, 0, 1)
        img = _blend(img, RED if i == hot else LINE, a * (0.95 if i == hot else 0.62))
    return _soft_line(img, base + 1.0, LINE, thick=2.0, feather=1.2, x0=x0 - 12, x1=x1 + 12)


def motif_dial(img):
    """v3 刻度：同心刻度环 + 外环 12 刻度，正上方一枚朱砂刻度。

    ⚠️ 第一版把刻度画成 `exp(-((clip(d-r0,-1,r1-r0) - (r1-r0)/2)/((r1-r0)/2))**6)`：
       `d > r1` 时 clip 恒等于上界 ⇒ 该式恒为 1 ⇒ 沿刻度的**径向射线无限延伸**，
       实测正上方那枚红刻度变成一条从画幅顶端贯到盘心的红竖线。改为
       「径向梯形（双边归零）× 角向高斯」，且环半径收进画幅内。
    """
    cx, cy = 540.0, 1235.0
    for R, th, al in ((300, 1.8, 0.40), (384, 1.8, 0.55), (468, 2.2, 0.85)):
        img = _ring(img, cx, cy, R, LINE, thick=th, alpha=al)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    d = np.hypot(xs - cx, ys - cy)
    ang = np.arctan2(ys - cy, xs - cx)
    for k in range(12):
        th = -np.pi / 2 + k * 2 * np.pi / 12
        da = np.abs(np.angle(np.exp(1j * (ang - th))))
        major = (k % 3 == 0)
        r0, r1 = 476.0, (506.0 if major else 490.0)
        prof = np.clip((d - r0) / 1.4, 0, 1) * np.clip((r1 - d) / 1.4, 0, 1)
        a = np.exp(-((da / 0.0075) ** 2)) * prof
        img = _blend(img, LINE, a * (0.85 if major else 0.55))
    # 朱砂信号：外环**左下 140°** 的一段弧。
    # ⚠️ 第一版把这枚刻度放在 12 点方向 —— 实测被熊猫头顶完全挡住，
    #    等于「单一信号色在成品里不可见」。左下方向角色永远到不了（该高度角色左沿 x≈265），
    #    故改到这里，保证朱砂一定看得见。
    seg = np.exp(-((np.angle(np.exp(1j * (ang - np.deg2rad(140)))) / np.deg2rad(15)) ** 2))
    img = _blend(img, RED, seg * np.exp(-(((d - 468.0) / 2.4) ** 2)) * 0.95)
    return img


def edge_guard(img, band=30.0, p=0.85):
    """把距四边 band 像素内的一切平滑收回到 --bg。

    🔴 为什么必须有它：#splash 用 object-fit:contain，非 9:16 屏会露出 #splash 自己的
       底色（桌面宽屏左右各露 ~656px、竖屏上下露 ~84px）。只要图的四边**精确等于**底色，
       接缝就不可见；反之任何装饰触到图边都会在接缝处露出一道亮边。
       实测踩过：v3 外环 R=576 在 x=0 处仍有像素（540−576<0）⇒ 左边缘不是纯底。
       故改为「不靠人记着别画到边，而是兜底把边收干净」。
    """
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    ex = np.clip(np.minimum(xs, W - 1 - xs) / band, 0, 1)
    ey = np.clip(np.minimum(ys, H - 1 - ys) / band, 0, 1)
    e = ((ex * ey) ** p)[:, :, None]
    return BG[None, None, :] + (img - BG[None, None, :]) * e


def motif_dial_visible(img):
    """v3b：v3 的「真机可见」微调版。

    背景（实测，v3 与 v1 的真机截图做差集）：v3 的三道同心环在真机 430 宽下
    **几乎不可见** —— 装饰层中位 Δ 仅 **4/255（≈1.6%）**。两个根因：
      ① 环色取 --line(#2c3542)，与底色 #141a24 的 Δ 只有 30；
      ② 1080→430 缩放系数 0.398 ⇒ 线宽 1.8px 落地不到 0.8px，抗锯齿把峰值摊薄。
    本版**只改可见度、不动构图**：环色升到 --line-strong(#3a4553，Δ=47)，
    峰值 alpha 提到 0.60/0.75/0.90（_ring 的 sigma 由常数 1.2 主导，
    加粗 thick 收效远小于提 alpha，故以 alpha 为主）。
    目标：缩放后峰值 Δ 稳过 12 的可见门槛（12/255 ≈ 4.7%，暗场可辨）。
    """
    cx, cy = 540.0, 1235.0
    for R, th, al in ((300, 3.0, 0.60), (384, 3.0, 0.75), (468, 3.4, 0.90)):
        img = _ring(img, cx, cy, R, LINE_STRONG, thick=th, alpha=al)
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    d = np.hypot(xs - cx, ys - cy)
    ang = np.arctan2(ys - cy, xs - cx)
    for k in range(12):
        th = -np.pi / 2 + k * 2 * np.pi / 12
        da = np.abs(np.angle(np.exp(1j * (ang - th))))
        major = (k % 3 == 0)
        r0, r1 = 474.0, (508.0 if major else 492.0)
        prof = np.clip((d - r0) / 1.4, 0, 1) * np.clip((r1 - d) / 1.4, 0, 1)
        a = np.exp(-((da / 0.0115) ** 2)) * prof          # 角向也放宽，缩放后不至于消失
        img = _blend(img, LINE_STRONG, a * (0.95 if major else 0.70))
    seg = np.exp(-((np.angle(np.exp(1j * (ang - np.deg2rad(140)))) / np.deg2rad(15)) ** 2))
    img = _blend(img, RED, seg * np.exp(-(((d - 468.0) / 3.0) ** 2)) * 0.95)
    return img


MOTIFS = {"v1": ("silent", motif_silent), "v2": ("signal", motif_signal),
          "v3": ("dial", motif_dial), "v3b": ("dial-visible", motif_dial_visible)}


# ══════════════════════════════════════════════════ 3. 合成
def paste_rgba(canvas_img, rgba_arr, cx_ink, bottom_ink, ink_h):
    """按「目标 ink 高度」缩放后贴入，使 ink 水平居中、ink 底边落在 bottom_ink。"""
    im = Image.fromarray(rgba_arr, "RGBA")
    al = np.asarray(im)[:, :, 3]
    ys, xs = np.where(al > 8)
    bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    ink_h_now = by1 - by0
    s = ink_h / float(ink_h_now)
    im2 = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    ink_cx = (bx0 + bx1) / 2.0 * s
    ink_by = by1 * s
    px = int(round(cx_ink - ink_cx))
    py = int(round(bottom_ink - ink_by))
    canvas_img.paste(im2, (px, py), im2)
    return im2, (px, py)


def build(variant, panda_ink_h=1010.0, panda_bottom=1730.0, lock_h=160.0, lock_cy=478.0):
    rgba_lock, bb, bgs, pr, pw, diff, band = extract_lockup(verbose=False)
    lock = Image.fromarray(rgba_lock[bb[1]:bb[3], bb[0]:bb[2]], "RGBA")
    lh = lock.height
    ls = lock_h / float(lh)
    lock = lock.resize((max(1, round(lock.width * ls)), max(1, round(lh * ls))), Image.LANCZOS)

    name, fn = MOTIFS[variant]
    arr = base_graphite()
    arr = _vignette(arr, 540, 1300, 900, 980, CARD, 0.30)
    arr = fn(arr)
    arr = edge_guard(arr)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    # 字标：水平居中于 540，纵向中心锁在 lock_cy
    lx = int(round(540 - lock.width / 2.0))
    ly = int(round(lock_cy - lock.height / 2.0))
    img.paste(lock, (lx, ly), lock)

    panda = Image.open(CHAR).convert("RGBA")
    im2, pos = paste_rgba(img, np.asarray(panda), 540.0, panda_bottom, panda_ink_h)

    # 接缝自检：四条边缘必须精确等于 --bg(#141a24)
    chk = np.asarray(img, dtype=np.int16)
    edges = {"top": chk[0], "bottom": chk[H - 1], "left": chk[:, 0], "right": chk[:, W - 1]}
    worst = max(float(np.abs(e - BG.astype(np.int16)).max()) for e in edges.values())
    return img, pos, (lx, ly, lock.width, lock.height), im2, worst


def cmd_build(which):
    os.makedirs(OUT, exist_ok=True)
    keys = list(MOTIFS) if which == "all" else [which]
    rep = {}
    for k in keys:
        img, ppos, lpos, pimg, worst = build(k)
        png = os.path.join(OUT, "splash-%s-%s.png" % (k, MOTIFS[k][0]))
        webp = os.path.join(OUT, "splash-%s-%s.webp" % (k, MOTIFS[k][0]))
        img.save(png)
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=90, method=6)
        open(webp, "wb").write(buf.getvalue())
        rep[k] = dict(name=MOTIFS[k][0], png=os.path.basename(png), webp=os.path.basename(webp),
                      bytes=len(buf.getvalue()), panda_pos=ppos, lock_pos=lpos,
                      edge_max_delta=worst)
        print("  ✓ %s(%s)  %s  %.1f KB  四边最大Δ=%d %s"
              % (k, MOTIFS[k][0], os.path.basename(png), len(buf.getvalue()) / 1024,
                 worst, "OK" if worst <= 1 else "✗ 接缝风险"))
    print(json.dumps(rep, ensure_ascii=False, indent=2))


def cmd_contact():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGB")
    tiles = [("OLD 青瓷 + 云纹/山形波（现行）", src)]
    for k in MOTIFS:
        p = os.path.join(OUT, "splash-%s-%s.png" % (k, MOTIFS[k][0]))
        if os.path.exists(p):
            tiles.append(("NEW %s %s" % (k, MOTIFS[k][0]), Image.open(p).convert("RGB")))
    tw, th, gap, top = 380, 676, 26, 30
    canvas = Image.new("RGB", (len(tiles) * (tw + gap) + gap, th + top * 2), (245, 245, 248))
    d = ImageDraw.Draw(canvas)
    for i, (label, im) in enumerate(tiles):
        t = im.copy(); t.thumbnail((tw, th), Image.LANCZOS)
        x = gap + i * (tw + gap)
        canvas.paste(t, (x, top))
        d.text((x + 2, 8), label, fill=(20, 20, 20))
    canvas.save(os.path.join(OUT, "_contact.png"))
    print("  写出 _contact.png  (%dx%d)" % canvas.size)


if __name__ == "__main__":
    if "--extract" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        cmd_extract()
    elif "--build" in sys.argv:
        cmd_build(sys.argv[sys.argv.index("--build") + 1])
    elif "--contact" in sys.argv:
        cmd_contact()
    else:
        print(__doc__)
