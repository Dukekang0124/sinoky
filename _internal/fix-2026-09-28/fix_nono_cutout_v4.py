# -*- coding: utf-8 -*-
"""v4 诺诺抠图：保留 v3 的边缘清理，废除破坏性底部渐隐。

v3 的实测教训（2026-09-28 晚，线上截图取证）：
  bottom_fade() 对「躯干在画布内结束」的姿态（point/cheer/like/wave 都是）
  从躯干底缘往上 56px 开始余弦渐隐 ⇒ 整个下半身化成烟雾（y=416 处
  master 320 实心 px → v3 0 实心）。这是 v3 自己引入的新缺陷。
  原版（用户认可的构图）就是「躯干硬止于 y≈447 + 底部留空条」；
  用户抱怨的是啃噬毛边/残渣，不是构图。

v4 与 v3 的差异（仅一处）：
  删除 bottom_fade()。底部边界质量由 repair_bottom(closing 填啃噬缺口)
  + smooth_alpha(亚像素高斯) 保证 —— 平滑闭边界本身就是收底。
  N_FADE/BAND 等参数仅保留 smooth/repair 所需。

用法：
  python fix_nono_cutout_v4.py            # 只出预览到 preview4/
  python fix_nono_cutout_v4.py --write    # 写回 assets/onboard/（v3 现状先 lossless 备份到 _backup_v4/）
"""
import os, sys, json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
MASCOT = os.path.join(APP, "assets", "mascot")
ONBOARD = os.path.join(APP, "assets", "onboard")
HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW = os.path.join(HERE, "preview4")
BACKUP = os.path.join(HERE, "_backup_v4")
WRITE = "--write" in sys.argv

JOBS = [
    ("main",         "wave",  (800, 600), 1.00),
    ("step1-pinyin", "point", (512, 512), 0.92),
    ("step2-listen", "listen", (512, 512), 0.92),
    ("step3-speak",  "cheer", (512, 512), 0.92),
    ("step4-score",  "like",  (512, 512), 0.92),
]
BG_AI = np.array([138.0, 127.0, 118.0])   # AI 影棚背景（v2 实测 8 格一致）

BAND_Y = 372        # 底部修补带起点（四姿态躯干下缘都在此之下）
CLOSE_R = 26        # closing 圆盘半径：填底部缺口（缺口深 ≤26px）
OPEN_R = 5          # opening 圆盘半径：除尖刺
MIN_COMP_FRAC = 0.015   # 小于主块 1.5% 的连通域 = 碎块，删
DOWNSAMPLE = 4      # 亚像素平滑的降采样倍数
SMOOTH_SIGMA = 1.0  # 降采样域里的高斯 σ（≈4px 全分辨率）
BMED_WIN = 51       # 底部边界曲线的中值窗（啃噬缺口 ≤~50px 被视作脉冲剔除）
BGAUSS_SIG = 6.0    # 底部边界曲线的高斯 σ（保住下摆的缓曲率，只去高频啃噬）


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def repair_bottom(hard):
    """① closing 填底部缺口（只接受修补带内的增量）② opening 除刺 ③ 删碎块。"""
    st_c, st_o = disk(CLOSE_R), disk(OPEN_R)
    closed = ndi.binary_closing(hard, structure=st_c)
    band = np.zeros_like(hard); band[BAND_Y:, :] = True
    hard2 = hard | (closed & band)
    hard2 = ndi.binary_opening(hard2, structure=st_o)
    hard2 = ndi.binary_closing(hard2, structure=disk(3))      # 开运算的圆整回填
    lab, n = ndi.label(hard2)
    if n > 1:
        sizes = ndi.sum(hard2, lab, range(1, n + 1))
        main = int(np.argmax(sizes)) + 1
        keep = sizes >= max(sizes.max() * MIN_COMP_FRAC, 50)
        keep[main - 1] = True
        hard2 = np.isin(lab, np.nonzero(keep)[0] + 1)
    return ndi.binary_fill_holes(hard2)


def smooth_bottom_boundary(hard):
    """底部边界曲线稳健平滑：啃噬 = 边界曲线上的高频脉冲 ⇒ 中值窗剔除 + 高斯去毛刺。

    只在边界附近 ±几十 px 动刀（fill=缺口往下补 / cut=凸块往上裁），
    不碰躯干内部，避免把悬空肢体与身体桥接起来。
    返回 (new_hard, boundary_meta)。
    """
    H, W = hard.shape
    yy = np.arange(H)[:, None].astype(np.float64)
    old_b = np.full(W, np.nan)
    sub = hard[BAND_Y:]
    for x in range(W):
        col = np.where(sub[:, x])[0]
        if len(col):
            old_b[x] = col.max() + BAND_Y
    valid = ~np.isnan(old_b)
    idx = np.where(valid)[0]
    new_b = old_b.copy()
    if len(idx) > BMED_WIN:
        from scipy.ndimage import median_filter, gaussian_filter1d
        sm = median_filter(old_b[idx], size=BMED_WIN, mode="nearest")
        sm = gaussian_filter1d(sm, BGAUSS_SIG, mode="nearest")
        # 只防病态值（允许 ≤60px 的真实缺口回填；v4.0 的 +4px 钳制会把缺口填充全部掐死）
        sm = np.minimum(sm, old_b[idx] + 60.0)
        new_b[idx] = sm
    depth = np.broadcast_to(new_b, (H, W))
    oldd = np.broadcast_to(old_b, (H, W))
    vmask = valid[None, :]
    inband = np.zeros_like(hard); inband[BAND_Y:, :] = True
    fill = vmask & inband & (yy > oldd) & (yy <= depth)          # 缺口：往下补
    cut = vmask & inband & (yy > depth + 1.0)                     # 凸块/残渣：往上裁
    new_hard = (hard | fill) & ~cut
    return new_hard, {"fill": int(fill.sum()), "cut": int((hard & cut).sum())}


def inpaint_added(rgb, old_hard, new_hard):
    """填补区 RGB：优先「同列正上方最近实心像素」垂直延拓（下摆阴影/衣色自然往下长），
    同列无源时回退「旧实心腐蚀内部」最近邻。填补区再做轻度去斑。"""
    added = new_hard & ~old_hard
    if not added.any():
        return rgb, added
    out = rgb.copy()
    H, W = added.shape
    # 垂直延拓源：每个 added 游程的顶端往上找最近旧实心像素
    src_y = np.full((H, W), -1, np.int64)
    for x in range(W):
        col = added[:, x]
        if not col.any():
            continue
        ys = np.where(col)[0]
        runs = np.split(ys, np.where(np.diff(ys) > 1)[0] + 1)
        for run in runs:
            sy = run[0] - 1
            while sy >= 0 and not old_hard[sy, x]:
                sy -= 1
            if sy >= 0:
                src_y[run, x] = sy
    ok = src_y >= 0
    yy, xx = np.where(ok)
    out[yy, xx] = rgb[src_y[yy, xx], xx]
    # 回退：无垂直源的用最近内部像素
    miss = added & ~ok
    if miss.any():
        interior = ndi.binary_erosion(old_hard, iterations=4)
        if interior.sum() < 100:
            interior = old_hard
        _, (iy, ix) = ndi.distance_transform_edt(~interior, return_indices=True)
        my, mx = np.where(miss)
        out[my, mx] = rgb[iy[my, mx], ix[my, mx]]
    # 去斑：填补区轻度平滑（σ≈1.6），再与原界外混合避免晕边
    if ok.any():
        blurred = np.stack([ndi.gaussian_filter(out[..., c], 1.6) for c in range(3)], axis=-1)
        w = ndi.gaussian_filter(ok.astype(float), 1.2)[..., None]
        out = out * (1 - w) + blurred * w
    return out, added


def smooth_alpha(hard):
    """降采样域高斯 → 亚像素软边；硬核钉 1、外部钉 0（防整只发灰）。"""
    small = hard[::DOWNSAMPLE, ::DOWNSAMPLE].astype(float)
    small = ndi.gaussian_filter(small, SMOOTH_SIGMA)
    a = ndi.zoom(small, DOWNSAMPLE, order=1)[:hard.shape[0], :hard.shape[1]]
    a = np.clip(a, 0, 1)
    core = ndi.binary_erosion(hard, iterations=2)
    a[core] = 1.0
    a[~ndi.binary_dilation(hard, iterations=2)] = 0.0
    return a


def unmix_edge(rgb, a):
    """边缘带去色边：F = (C − (1−α)·B) / α；极外圈用腐蚀内部最近邻兜底。"""
    edge = (a > 0.02) & (a < 1.0)
    if not edge.any():
        return rgb
    al = np.clip(a, 0.15, 1.0)
    F = (rgb.astype(np.float64) - (1.0 - al[..., None]) * BG_AI) / al[..., None]
    interior = ndi.binary_erosion(a > 0.85, iterations=3)
    _, (iy, ix) = ndi.distance_transform_edt(~interior, return_indices=True)
    F[edge] = F[iy[edge], ix[edge]]  # 全部用内部色，最稳
    out = rgb.copy()
    out[edge] = np.clip(F[edge], 0, 255)
    return out


def build(pose, size, scale):
    src = np.array(Image.open(os.path.join(MASCOT, pose + ".webp")).convert("RGBA")).astype(np.float64)
    old_hard = src[..., 3] >= 128
    new_hard = repair_bottom(old_hard)
    new_hard, bmeta = smooth_bottom_boundary(new_hard)
    rgb, added = inpaint_added(src[..., :3], old_hard, new_hard)
    a = smooth_alpha(new_hard)
    rgb = unmix_edge(rgb, a)
    rgba = np.dstack([rgb, a * 255.0])

    # 构图逐字沿用 v2/_gen-onboard：thumbnail(0.92·min) 居中（512 素材不放大）
    side = min(512, int(round(min(size) * scale)))
    im = Image.fromarray(np.uint8(rgba.clip(0, 255)))
    im = im.resize((side, side), Image.LANCZOS)
    m = np.array(im).astype(np.float64)
    # LANCZOS 预乘会把实心区糊成半透明 ⇒ 缩放后重新钉实心核（v2 同款）
    al = m[..., 3] / 255.0
    core = ndi.binary_erosion(al >= 0.5, iterations=2)
    al[core] = 1.0
    al[~ndi.binary_dilation(al >= 0.5, iterations=2)] = 0.0
    m[..., 3] = al * 255.0

    H, W = size[1], size[0]
    canvas = np.zeros((H, W, 4), np.float64)
    oy, ox = (H - side) // 2, (W - side) // 2
    canvas[oy:oy + side, ox:ox + side] = m
    canvas[canvas[..., 3] == 0, :3] = 0.0        # 透明区 RGB 归零（含「查看器假象」根除）

    # 底部质量取证：躯干最低实心行 + 该行的实心跨度（对比 master，确认没有内容损失）
    aa = canvas[..., 3] / 255.0
    ys = np.where((aa > 0.5).any(axis=1))[0]
    yb = int(ys.max()) if len(ys) else -1
    xs = np.where(aa[yb] > 0.5)[0] if yb >= 0 else []
    bottom = {"yb": yb, "span": [int(xs.min()), int(xs.max())] if len(xs) else None}
    return canvas, int(added.sum()), bmeta, bottom


def previews(name, canvas):
    os.makedirs(PREVIEW, exist_ok=True)
    Image.fromarray(np.uint8(canvas.clip(0, 255))).save(os.path.join(PREVIEW, name + ".webp"), "WEBP", quality=92, method=6)
    a = canvas[..., 3:4] / 255.0
    for tag, bg in [("dark", np.array([26, 33, 46.0])), ("gray", np.array([128, 128, 128.0]))]:
        comp = canvas[..., :3] * a + bg * (1 - a)
        Image.fromarray(np.uint8(comp.clip(0, 255))).save(os.path.join(PREVIEW, f"{name}-{tag}.png"), quality=92)
    Image.fromarray(np.uint8(canvas[..., 3]), "L").save(os.path.join(PREVIEW, f"{name}-alpha.png"))


def main():
    report = []
    for name, pose, size, scale in JOBS:
        canvas, added_px, bmeta, bottom = build(pose, size, scale)
        previews(name, canvas)
        report.append({"name": name, "pose": pose, "added_px(修补)": added_px, "boundary": bmeta, "bottom": bottom})
        print(f"{name} ← {pose}: 修补 {added_px}px, 边界补/裁 {bmeta['fill']}/{bmeta['cut']}, 底缘 y={bottom['yb']} span={bottom['span']}")
    if WRITE:
        os.makedirs(BACKUP, exist_ok=True)
        for name, *_ in JOBS:
            dst = os.path.join(ONBOARD, name + ".webp")
            bak = os.path.join(BACKUP, name + ".webp")
            if not os.path.exists(bak):   # 守卫：备份永不覆盖
                Image.open(dst).save(bak, "WEBP", lossless=True, method=6)
            Image.open(os.path.join(PREVIEW, name + ".webp")).save(dst, "WEBP", quality=92, method=6)
        print("已写回 assets/onboard/（v3 现状备份在 _backup_v4/，lossless）")
    with open(os.path.join(HERE, "fix-report-v4.json"), "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
