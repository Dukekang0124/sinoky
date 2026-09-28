# -*- coding: utf-8 -*-
"""v3 诺诺母版重建：修底部「啃噬」缺口 + 亚像素平滑 + 统一渐隐收底。

与 v2 的差异（为什么 v2 解决不了）：
  v2 假设「母版 alpha 是对的、只是硬」。实测（2026-09-28 晚）母版真正的问题是：
  ① 底部剪影被啃出大缺口/台阶/悬空块（上游 AI matting 所致），渐隐 12px 盖不住 30-60px 的啃噬带；
  ② 缺口是 alpha=0 但 RGB 是影棚背景 —— 直接填 alpha 会把背景色当身体显示，
     所以填补区必须用「就近实心内部像素」修补 RGB，不能沿用原 RGB；
  ③ 云端 matting（buddy matting）会脑补下半身（灰斑），不可用 —— 弃。

用法：
  python fix_nono_cutout_v3.py            # 只出预览到 preview3/
  python fix_nono_cutout_v3.py --write    # 写回 assets/onboard/（先 lossless 备份到 _backup_v3/）
"""
import os, sys, json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
MASCOT = os.path.join(APP, "assets", "mascot")
ONBOARD = os.path.join(APP, "assets", "onboard")
HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW = os.path.join(HERE, "preview3")
BACKUP = os.path.join(HERE, "_backup_v3")
WRITE = "--write" in sys.argv

# 与 v2 逐字一致：构图映射（name, pose, canvas, scale)
JOBS = [
    ("main",         "wave",  (800, 600), 1.00),
    ("step1-pinyin", "point", (512, 512), 0.92),
    ("step2-listen", "listen", (512, 512), 0.92),
    ("step3-speak",  "cheer", (512, 512), 0.92),
    ("step4-score",  "like",  (512, 512), 0.92),
]
BG_AI = np.array([138.0, 127.0, 118.0])   # AI 影棚背景（v2 实测 8 格一致）

# ---- v3 参数 ----
BAND_Y = 372        # 底部修补带起点（四姿态躯干下缘都在此之下）
CLOSE_R = 26        # closing 圆盘半径：填底部缺口（缺口深 ≤26px）
OPEN_R = 5          # opening 圆盘半径：除尖刺
MIN_COMP_FRAC = 0.015   # 小于主块 1.5% 的连通域 = 碎块，删
DOWNSAMPLE = 4      # 亚像素平滑的降采样倍数
SMOOTH_SIGMA = 1.0  # 降采样域里的高scroll σ（≈4px 全分辨率）
N_FADE = 56         # 渐隐带高度（512 尺度）≈ 34-37px 屏显


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


def inpaint_added(rgb, old_hard, new_hard):
    """填补区的 RGB 用「旧实心的腐蚀内部」最近邻 —— 不引入影棚背景色。"""
    added = new_hard & ~old_hard
    if not added.any():
        return rgb, added
    interior = ndi.binary_erosion(old_hard, iterations=4)
    if interior.sum() < 100:
        interior = old_hard
    _, (iy, ix) = ndi.distance_transform_edt(~interior, return_indices=True)
    out = rgb.copy()
    out[added] = rgb[iy[added], ix[added]]
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


def bottom_fade(a):
    """从躯干最下缘起余弦渐隐；本体被画布切断则锚在画布底。"""
    ys = np.where((a > 0.06).any(axis=1))[0]
    yb = int(ys.max())
    y_end = a.shape[0] if yb >= a.shape[0] - 8 else yb + 2
    n = min(N_FADE, y_end)
    t = np.clip((np.arange(y_end - n, y_end) - (y_end - n)) / (n - 1.0), 0, 1)
    a[y_end - n:y_end] *= (0.5 * (1 + np.cos(np.pi * t)))[:, None]
    a[y_end:] = 0.0
    return a, [y_end - n, y_end, n]


def build(pose, size, scale):
    src = np.array(Image.open(os.path.join(MASCOT, pose + ".webp")).convert("RGBA")).astype(np.float64)
    old_hard = src[..., 3] >= 128
    new_hard = repair_bottom(old_hard)
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
    fa, fade = bottom_fade(canvas[..., 3] / 255.0)
    canvas[..., 3] = fa * 255.0
    canvas[canvas[..., 3] == 0, :3] = 0.0        # 透明区 RGB 归零（含「查看器假象」根除）
    return canvas, int(added.sum()), fade


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
        canvas, added_px, fade = build(pose, size, scale)
        previews(name, canvas)
        report.append({"name": name, "pose": pose, "added_px(修补)": added_px, "fade": fade})
        print(f"{name} ← {pose}: 修补 {added_px}px, 渐隐 {fade}")
    if WRITE:
        os.makedirs(BACKUP, exist_ok=True)
        for name, *_ in JOBS:
            dst = os.path.join(ONBOARD, name + ".webp")
            bak = os.path.join(BACKUP, name + ".webp")
            if not os.path.exists(bak):   # 守卫：备份永不覆盖（但基线读这里 ⇒ 首跑即原版）
                Image.open(dst).save(bak, "WEBP", lossless=True, method=6)
            Image.open(os.path.join(PREVIEW, name + ".webp")).save(dst, "WEBP", quality=92, method=6)
        print("已写回 assets/onboard/（原版备份在 _backup_v3/，lossless）")
    with open(os.path.join(HERE, "fix-report-v3.json"), "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
