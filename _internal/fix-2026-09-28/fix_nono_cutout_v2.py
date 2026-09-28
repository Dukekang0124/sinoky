# -*- coding: utf-8 -*-
"""官网 4 张诺诺配图 —— 重做抠图（v2，正式版）

────────────────────────────────────────────────────────────────
一、为什么要重做：缺陷链（全部有实测证据，见 _b/ 与 _diag/）
────────────────────────────────────────────────────────────────
线上 4 张图 `assets/onboard/{main,step1-pinyin,step2-listen,step4-score}.webp`
不是从原图直接抠的，而是**二次抠图**——先合成、再抠回来，两次误差叠加：

  ① `_internal/nono-ip-v1/_gen-onboard.py`（v0.23.2）
     把 `assets/mascot/<姿态>.webp`（512²，已抠好）**贴到青绿光晕底上**，
     产出不透明 RGB 母版（= `_internal/fix-2026-09-16/_old_onboard/*.webp`，
     与 `8ace24d` 字节一致，已用 md5 核对）。
  ② v0.23.13 用 `nono-cutout.py` 把这层光晕**再抠掉**。

两次误差叠加出四类可见缺陷：

  ㈠ 抗锯齿被削平 —— 硬边
     主体 alpha 来自 ①（`mascot-process.py: cut_cell`），它在最后做了
     `grey_erosion(3×3)` + `al = where(al<0.10, 0, where(al>0.80, 1, al))`
     ⇒ 边缘只剩 0 和 255 两级。实测半透明像素占「轮廓带」比例仅
     0.31–0.39（`mascot/point.webp` 整图只有 4 个半透明像素），
     人眼读作**台阶锯齿**。
  ㈡ 边缘颜色被污染 —— 脏边光晕
     主体边缘像素的 RGB 是 `α·主体 + (1−α)·背景`（AI 影棚米白背景
     ≈(138,127,118)，实测 8 个宫格一致）。直接合成到深色卡片
     `#1e2530` 上时，这圈**既不像主体也不像卡片**的中间灰就成了"脏边"。
     ② 的再抠图用距离阈值判前景，无法还原被混合掉的本来颜色。
  ㈢ 底部硬切 —— 断头台
     ② 的 `keep_top_only` 直接 `alpha[cut:] = 0`，切面是笔直一行 + 1px 台阶。
     实测断裂行：step4 y=405 / step1 y=439 / step2 y=491 / main y=498。
     ⚠️ 必须说明：`step2-listen` 的平底**根因在更上游**——它的姿态素材
     `assets/mascot/listen.webp` 自身末行 α 就是 255（画布把身体切了），
     源自 AI 四宫格 `sheet2-nowm.png` 本来就把半身像切在格底，
     **身体像素不存在，无法找回**，只能软化。
  ㈣ 背景建模错 —— 残渣
     青绿光晕是**径向渐晕**（`_gen-onboard.py` 的 `ellipse` + GaussianBlur），
     而 ② 按"逐行左右边缘中位色"建模 ⇒ 底部中央被判成前景。

────────────────────────────────────────────────────────────────
二、v2 的做法
────────────────────────────────────────────────────────────────
不再是"再抠一次"，而是**从干净源头重建**：

  ① 源头换成 `assets/mascot/<姿态>.webp`（未叠光晕，只有一次抠图误差）
  ② alpha 重建：二值硬核 → 3×3 开/闭去 1px 毛刺与细缝 → 只留最大连通域
     → 填洞 → `gaussian(0.80)` 后按 0.5 电平重映射
     ⇒ 得到**亚像素级过渡带**（在 0.5 等值线处对称，几何不被啃小）
  ③ 去色边：`F = (C − (1−α)·B) / α`，B = AI 影棚背景色 (138,127,118)
     ⇒ 边缘像素还原成"主体本色"，合成到任何底色都不再出脏光晕
  ④ 构图**逐字沿用 `_gen-onboard.py`**（main 1.0 居中 / 其余 0.92 居中）
     ⇒ 画布尺寸与角色位置与线上完全一致，本次改动**只有像素、没有版式**
  ⑤ 底部统一收口：以角色底端 `yb` 为锚，向上取 FADE 行做升余弦渐隐；
     渐隐行数按**官网真实显示比例**折算（512 图 ×0.660、main ×0.4225），
     使 4 张在屏幕上的渐隐带都是 ≈12px ⇒ 观感统一，且硬切口被软化。

────────────────────────────────────────────────────────────────
三、用法
────────────────────────────────────────────────────────────────
  python fix_nono_cutout_v2.py --probe     # 只体检，不写盘（列现图/v2 指标对比）
  python fix_nono_cutout_v2.py --preview   # 写出到 _internal/.../preview_v2/
  python fix_nono_cutout_v2.py --write     # 写回 assets/onboard/（旧图备份 _backup-*.webp）
"""
import os
import sys
import json
import numpy as np
from PIL import Image

try:
    from scipy import ndimage as ndi
except ImportError:  # pragma: no cover
    sys.exit("需要 scipy：pip install scipy")

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))          # sinoky-app/
MASCOT = os.path.join(APP, "assets", "mascot")
CUR = os.path.join(APP, "assets", "onboard")
PREVIEW = os.path.join(HERE, "preview_v2")

# (输出名, 姿态素材名, 画布尺寸, 主体缩放)  —— 后三项逐字抄自 _gen-onboard.py
JOBS = [
    ("main",         "wave",   (800, 600), 1.00),
    ("step1-pinyin", "point",  (512, 512), 0.92),
    ("step2-listen", "listen", (512, 512), 0.92),
    ("step3-speak",  "cheer",  (512, 512), 0.92),
    ("step4-score",  "like",   (512, 512), 0.92),
]
TARGETS = ["main", "step1-pinyin", "step2-listen", "step4-score"]   # 官网引用的 4 张

BG_AI = np.array([138.0, 127.0, 118.0])   # AI 四宫格影棚背景，实测 8 格一致
FADE_DISPLAY_PX = 12.0                    # 底部渐隐带的屏幕可见高度（四张统一）
DISP_SCALE = {"main": 338.0 / 800.0}      # 其余 = 338/512
ALPHA_SIGMA = 0.60                        # 抗锯齿带宽（像素），实测定稿
# 轮廓平滑强度：AI 四宫格在袖口/下摆留下的是**结构性块状边**（台阶 8~20px，
# 不是 1px 抗锯齿缺失），只加 ALPHA_SIGMA 抹不掉。σ=2.5 在真实 338px 卡片上
# 才把台阶读成连续曲线（σ=0/1.5 仍可见台阶，σ=3.5 开始过度圆化）。
# ⚠️ 它同时会轻微圆化耳尖/呆毛这类凸细节 —— 实测 338px 下不可辨，收益远大于代价。
MASK_SMOOTH_SIGMA = 2.5
BACKUP = os.path.join(HERE, "_backup")    # 🔴 备份绝不能放进 assets/（build-web 整目录上线）


# ────────────────────────────── alpha 重建 ──────────────────────────────
def rebuild_alpha(rgba):
    """从姿态素材的 alpha 重建真抗锯齿 alpha（几何不变，只补过渡带）"""
    al = np.asarray(rgba)[:, :, 3].astype(np.float64) / 255.0
    hard = al >= 0.5

    # 1) 去 1px 毛刺 / 补 1px 细缝（3×3 是"不啃几何"的上限；disk(3) 会削掉耳朵尖）
    hard = ndi.binary_opening(hard, np.ones((3, 3), bool))
    hard = ndi.binary_closing(hard, np.ones((3, 3), bool))

    # 2) 只保留最大连通域 + 面积 ≥ 主块 2% 的块（清孤立碎渣），再填洞
    lab, n = ndi.label(hard, np.ones((3, 3), int))
    if n > 1:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        main = int(sizes.argmax())
        keep = [i for i in range(1, n + 1) if sizes[i] >= sizes[main] * 0.02]
        hard = np.isin(lab, keep)
    hard = ndi.binary_fill_holes(hard)
    hard = ndi.binary_fill_holes(ndi.binary_closing(hard, np.ones((3, 3), bool)))

    # 3) 轮廓平滑：把 AI 四宫格留下的结构性块状台阶（8~20px）抹成连续曲线。
    #    用 gaussian-阈值 而不是 disk 腐蚀：直线段不被啃小，凸角才被圆化。
    if MASK_SMOOTH_SIGMA > 0:
        hard = ndi.gaussian_filter(hard.astype(np.float64), MASK_SMOOTH_SIGMA) > 0.5
        hard = ndi.binary_fill_holes(ndi.binary_closing(hard, np.ones((3, 3), bool)))
        lab2, n2 = ndi.label(hard, np.ones((3, 3), int))
        if n2 > 1:                      # 平滑可能甩出孤立小岛，再筛一次
            s2 = np.bincount(lab2.ravel())
            s2[0] = 0
            hard = np.isin(lab2, [i for i in range(1, n2 + 1) if s2[i] >= s2.max() * 0.02])

    # 4) 亚像素过渡带：gaussian 后按 0.5 电平对称重映射
    g = ndi.gaussian_filter(hard.astype(np.float64), ALPHA_SIGMA)
    cov = np.clip(2.0 * g - 0.5, 0.0, 1.0)

    # 5) 硬核内部必须回到 1.0（防止 gaussian 把实心区削成半透明 → 整只熊猫发灰）
    solid = ndi.binary_erosion(hard, np.ones((3, 3), bool), iterations=2)
    cov[solid] = 1.0
    cov[~ndi.binary_dilation(hard, np.ones((3, 3), bool), iterations=2)] = 0.0
    return cov


# ────────────────────────────── 去色边 ──────────────────────────────
def decontaminate(rgb, cov):
    """F = (C − (1−α)·B) / α ：把边缘像素从"主体混背景"还原成主体本色"""
    out = rgb.astype(np.float64).copy()
    edge = (cov > 0.02) & (cov < 0.999)
    if not edge.any():
        return out

    a = np.clip(cov, 0.15, 1.0)[:, :, None]                  # α<0.15 时不外推（会爆）
    f = (rgb.astype(np.float64) - (1.0 - a) * BG_AI) / a
    out[edge] = np.clip(f[edge], 0.0, 255.0)

    # α<0.15 的极外圈：除以 α 会炸，改用"最近实心像素色"补（标准 color-bleed）
    thin = (cov > 0.0) & (cov <= 0.15)
    if thin.any():
        idx = ndi.distance_transform_edt(cov <= 0.15, return_distances=False, return_indices=True)
        out[thin] = rgb[idx[0], idx[1]][thin]
    return out


# ────────────────────────────── 底部收口 ──────────────────────────────
def bottom_fade(cov, name, canvas_h):
    """以角色底端为锚做升余弦渐隐；渐隐行数按显示比例折算，四张屏幕观感一致"""
    disp = DISP_SCALE.get(name, 338.0 / 512.0)
    n_fade = max(4, int(round(FADE_DISPLAY_PX / disp)))
    ys = np.where((cov > 0.06).any(axis=1))[0]
    if not len(ys):
        return cov, None
    yb = int(ys.max())
    y_end = canvas_h if yb >= canvas_h - 2 else yb + 1     # 本体被画布切断 ⇒ 锚在画布底
    y0 = max(0, y_end - n_fade)
    t = np.clip((np.arange(y0, y_end) - y0) / float(max(1, n_fade - 1)), 0, 1)
    ramp = 0.5 * (1.0 + np.cos(np.pi * t))
    cov = cov.copy()
    cov[y0:y_end] *= ramp[:, None]
    cov[y_end:] = 0.0
    return cov, (int(y0), int(y_end), int(n_fade))


# ────────────────────────────── 主流程 ──────────────────────────────
def build(name, pose, size, scale):
    """复刻 _gen-onboard.py 的构图：thumbnail(0.92·min) 后居中 —— scale 已折算好"""
    src = Image.open(os.path.join(MASCOT, pose + ".webp")).convert("RGBA")
    rgb = np.asarray(src)[:, :, :3]
    cov = rebuild_alpha(src)
    col = decontaminate(rgb, cov)

    m = Image.fromarray(np.dstack([col.astype(np.uint8), (cov * 255 + 0.5).astype(np.uint8)]), "RGBA")
    # 等价于 _gen-onboard 的 m.thumbnail((int(0.92·min(W,H)),)*2) —— 512 素材不会被放大
    side = min(src.size[0], int(round(min(size) * 0.92)))
    m = m.resize((side, side), Image.LANCZOS)

    # 重采样（LANCZOS 预乘）会把实心区也糊出半透明 ⇒ 重新把实心核钉回 1.0，
    # 否则整只诺诺在深底上会发灰（实测不加固时实心区最低 α 掉到 164）。
    a = np.asarray(m)[:, :, 3].astype(np.float64) / 255.0
    core = ndi.binary_erosion(a >= 0.5, np.ones((3, 3), bool), iterations=2)
    a[core] = 1.0
    a[~ndi.binary_dilation(a >= 0.5, np.ones((3, 3), bool), iterations=2)] = 0.0
    am = np.asarray(m).copy()
    am[:, :, 3] = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
    m = Image.fromarray(am, "RGBA")

    canvas = np.zeros((size[1], size[0], 4), np.float64)
    ox, oy = (size[0] - m.size[0]) // 2, (size[1] - m.size[1]) // 2
    ma = np.asarray(m).astype(np.float64)
    canvas[oy:oy + ma.shape[0], ox:ox + ma.shape[1]] = ma

    cov2, fade = bottom_fade(canvas[:, :, 3] / 255.0, name, size[1])
    out = np.dstack([canvas[:, :, :3], np.clip(cov2 * 255 + 0.5, 0, 255)]).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), fade


# ────────────────────────────── 体检指标 ──────────────────────────────
CARD = np.array([30.0, 37.0, 48.0])       # --card #1e2530，官网卡片底色
LUM_W = np.array([0.2126, 0.7152, 0.0722])
CARD_LUM = float(CARD @ LUM_W)            # 36.3


def stats(im, name=None):
    a = np.asarray(im.convert("RGBA")).astype(np.float64)
    al = a[:, :, 3]
    H, W = al.shape
    hard = al >= 128
    solid = ndi.binary_erosion(hard, np.ones((3, 3), bool), iterations=6)   # 深内部（≥6px）
    band = ndi.binary_dilation(hard, np.ones((3, 3), bool), iterations=3) & ~solid
    outer = ndi.binary_dilation(hard, np.ones((3, 3), bool), iterations=2) & ~hard
    semi = int(((al > 8) & (al < 247)).sum())
    # 轮廓带外还挂着半透明 = 底色残渣/脏边光晕
    halo = int(((al > 8) & (al < 247) & ~ndi.binary_dilation(hard, np.ones((3, 3), bool), iterations=3)).sum())
    # 合成到卡片底色后，紧贴轮廓外侧 2px 的平均亮度；干净抠图应 ≈ 卡片亮度
    comp = (a[:, :, :3] * al[:, :, None] / 255.0 + CARD * (1 - al[:, :, None] / 255.0))
    ring = float((comp[outer] @ LUM_W).mean()) if outer.any() else CARD_LUM
    ys = np.where((al > 8).any(1))[0]
    disp = DISP_SCALE.get(name, 338.0 / 512.0)
    return {
        "尺寸": "%dx%d" % (W, H),
        "半透明像素": semi,
        "轮廓带像素": int(band.sum()),
        "抗锯齿比(半透明/轮廓带)": round(semi / max(1, int(band.sum())), 2),
        "内部α最低": int(al[solid].min()) if solid.any() else -1,
        "内部半透明像素": int(((al > 0) & (al < 250) & solid).sum()),
        "轮廓带外半透明(残渣)": halo,
        "边缘亮环(Δ亮度)": round(ring - CARD_LUM, 1),
        "底切锐度(单行α跌幅)": int(np.diff(al.mean(1)[H // 2:]).min() if H > 2 else 0),
        "底行αmax": int(al[H - 1].max()),
        "底行非零列": int((al[H - 1] > 0).sum()),
        "四角α": [int(al[0, 0]), int(al[0, W - 1]), int(al[H - 1, 0]), int(al[H - 1, W - 1])],
        "角色y范围": [int(ys.min()), int(ys.max())] if len(ys) else [],
        "角色可见高(屏幕px)": int(round((ys.max() - ys.min() + 1) * disp)) if len(ys) else 0,
    }


def main():
    mode = "probe"
    for k in ("--probe", "--preview", "--write"):
        if k in sys.argv:
            mode = k[2:]
    only = None
    for a in sys.argv:
        if a.startswith("--only="):
            only = a.split("=", 1)[1].split(",")

    if mode == "write":
        os.makedirs(CUR, exist_ok=True)
        os.makedirs(BACKUP, exist_ok=True)
    if mode == "preview":
        os.makedirs(PREVIEW, exist_ok=True)

    base_lab = "原始线上图(_backup)" if os.path.exists(os.path.join(BACKUP, (only or TARGETS)[0] + ".webp")) \
        or os.path.isdir(BACKUP) else "assets/onboard"
    report = []
    print("=" * 118)
    print("%-14s %-26s %s" % ("", "基线（" + base_lab + "）", "v2（从姿态素材重建）"))
    print("=" * 118)
    for name, pose, size, scale in JOBS:
        if only and name not in only:
            continue
        v2, fade = build(name, pose, size, scale)
        # 🔴 基线必须是**原始线上图**（_backup/），不能是 assets/onboard/ ——
        # --write 之后 assets/onboard/ 已经是 v2，再拿它当"现图"就是自己跟自己比，
        # 指标会永远显示"无变化"。这是本轮踩到的自证陷阱。
        bak_p = os.path.join(BACKUP, name + ".webp")
        cur_p = bak_p if os.path.exists(bak_p) else os.path.join(CUR, name + ".webp")
        base_lab = "原始线上图(_backup)" if os.path.exists(bak_p) else "assets/onboard"
        s_cur = stats(Image.open(cur_p), name) if os.path.exists(cur_p) else None
        s_v2 = stats(v2, name)

        keys = ["抗锯齿比(半透明/轮廓带)", "半透明像素", "轮廓带像素", "内部α最低",
                "内部半透明像素", "轮廓带外半透明(残渣)", "边缘亮环(Δ亮度)", "底切锐度(单行α跌幅)",
                "底行αmax", "底行非零列", "四角α", "角色y范围", "角色可见高(屏幕px)"]
        print("\n▌%s   (%s, 姿态=%s, 素材缩放→%dpx)   底部渐隐 y[%d,%d) 共 %d 行" %
              (name, s_v2["尺寸"], pose, min(512, int(round(min(size) * 0.92))),
               fade[0], fade[1], fade[2]))
        for k in keys:
            a = "—" if s_cur is None else s_cur[k]
            print("    %-26s %-22s →  %s" % (k, a, s_v2[k]))
        report.append({"name": name, "pose": pose, "scale": scale, "fade": fade,
                       "before": s_cur, "after": s_v2})

        if mode == "preview":
            v2.save(os.path.join(PREVIEW, name + ".webp"), "WEBP", quality=92, method=6)
        elif mode == "write":
            dst = os.path.join(CUR, name + ".webp")
            if os.path.exists(dst):
                bak = os.path.join(BACKUP, name + ".webp")
                if not os.path.exists(bak):
                    Image.open(dst).save(bak, "WEBP", lossless=True, method=6)
                    print("    → 旧图已备份 %s" % os.path.relpath(bak, APP))
            v2.save(dst, "WEBP", quality=92, method=6)
            print("    → 已写入 %s（%d B）" % (os.path.relpath(dst, APP), os.path.getsize(dst)))

    with open(os.path.join(HERE, "fix-report-v2.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print("\nmode=%s  报告 → fix-report-v2.json" % mode)


if __name__ == "__main__":
    main()
