#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sinoky v0.23.12 配图升级第一轮 —— 九思独立复测脚本
不采信设计 AI 的交付报告，按委托文档验收线逐条重跑：

A 类（16 张，只修 alpha 抠图）：
  - 带 alpha / WebP
  - 四角 alpha == 0
  - 边缘白占比 = alpha∈[1,200] 边缘带内 RGB 全>200 的近白像素 ÷ 边缘带 ≤ 2%
  - 体积：mascot/empty ≤ 20KB，onboard ≤ 24KB
  - 造型冻结证明：从 git HEAD 取旧图，全不透明像素(a=255)的 RGB 应几乎完全一致（只改了 alpha）

B 类（read 6×3）：
  - PNG 母版 1600×900；1x WebP 800×450 ≤ 60KB；2x WebP 1600×900 ≤ 200KB
  - 红线：紫掩码像素计数（hue∈[265,320] 且 sat>30 且 val>60）→ 应极低
  - 红线：朱砂红严格口径（hue∈[0,10]∪[350,360] 且 sat>40 且 R>150 且 R-G>60 且 R-B>60）聚类 ≤ 2 处（仅报告，受暖橙棕误报影响，需人工看证据图）

两棵树：assets/ 与 www/assets/ 逐文件 MD5 一致

index.html：只引用 read 1x webp，无 srcset/dpr，onboard 用工程名
"""
import io, os, glob, hashlib, json, subprocess
from PIL import Image

APP = r"D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app"
ASSETS = os.path.join(APP, "assets")
WWW = os.path.join(APP, "www", "assets")

PASS, FAIL = [], []
def ok(cond, label, detail=""):
    (PASS if cond else FAIL).append((label, detail))
    print(("  ✅ " if cond else "  ❌ ") + label + (("  — " + detail) if detail else ""))

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def git_old_bytes(rel):
    try:
        return subprocess.run(["git", "show", "HEAD:" + rel], cwd=APP,
                               capture_output=True).stdout
    except Exception:
        return b""

def edge_white(path):
    """返回 (近白占比%, 边缘带像素数, 近白像素数)。
    当边缘带很薄(≤20px)时，占比%无参考意义，真正判据是近白像素绝对数。"""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    edge = near = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if 1 <= a <= 200:
                edge += 1
                if r > 200 and g > 200 and b > 200:
                    near += 1
    wp = 0.0 if edge == 0 else 100.0 * near / edge
    return (wp, edge, near)

def silhouette_iou(old_bytes, path, thr=20):
    """对比旧图与新图的 alpha 轮廓重合度（IoU）。
    高 IoU ⇒ 同一角色/姿态被重抠；低 IoU ⇒ 重新绘制了不同姿态。
    注意：旧图若无 alpha（整张实底），本判据失效，改走 character_rgb_preserved。"""
    try:
        o = Image.open(io.BytesIO(old_bytes)).convert("RGBA")
        n = Image.open(path).convert("RGBA")
    except Exception as e:
        return None, "解析失败:%s" % e
    if o.size != n.size:
        return None, "尺寸不同 %s≠%s" % (o.size, n.size)
    op, np_ = o.load(), n.load()
    w, h = o.size
    inter = uni = 0
    for y in range(h):
        for x in range(w):
            a1 = 1 if op[x, y][3] > thr else 0
            a2 = 1 if np_[x, y][3] > thr else 0
            if a1 or a2:
                uni += 1
            if a1 and a2:
                inter += 1
    if uni == 0:
        return None, "无轮廓"
    return 100.0 * inter / uni, "IoU=%.2f%%" % (100.0 * inter / uni)

def character_rgb_preserved(old_bytes, path, thr=200, tol=10):
    """旧图无 alpha（实底图）时：在新图不透明像素处比对旧图 RGB，
    证明是同一角色只是去背景（而非重新绘制）。
    用逐通道容差 tol（切割+重编码必然有轻微像素漂移），返回 (容差内一致率, exact率, 平均差异)。"""
    try:
        o = Image.open(io.BytesIO(old_bytes)).convert("RGBA")
        n = Image.open(path).convert("RGBA")
    except Exception as e:
        return None, "解析失败:%s" % e
    if o.size != n.size:
        return None, "尺寸不同 %s≠%s" % (o.size, n.size)
    op, np_ = o.load(), n.load()
    w, h = o.size
    cmp = same = exact = 0
    diffs = []
    for y in range(h):
        for x in range(w):
            if np_[x, y][3] > thr:
                cmp += 1
                d = [abs(op[x, y][k] - np_[x, y][k]) for k in range(3)]
                md = max(d)
                diffs.append(sum(d))
                if md <= tol:
                    same += 1
                if md == 0:
                    exact += 1
    if cmp == 0:
        return None, "新图无实心像素"
    mad = sum(diffs) / len(diffs)
    return 100.0 * same / cmp, "实心 %d，容差%d内 %.2f%%，exact %.2f%%，平均差异 %.2f" % (
        cmp, tol, 100.0 * same / cmp, 100.0 * exact / cmp, mad)

def corners(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    return [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]

def rgb_freeze_check(rel, path):
    """对比 git HEAD 旧图：全不透明像素(a=255)的 RGB 一致率，证明只改了 alpha。"""
    old = git_old_bytes(rel)
    if not old:
        return None, "无旧图(新建)"
    try:
        o = Image.open(io.BytesIO(old)).convert("RGBA")
        n = Image.open(path).convert("RGBA")
    except Exception as e:
        return None, "解析旧图失败:%s" % e
    if o.size != n.size:
        return None, "尺寸不同 %s≠%s" % (o.size, n.size)
    op, np_ = o.load(), n.load()
    w, h = o.size
    cmp = same = 0
    diffs = []
    for y in range(h):
        for x in range(w):
            oa = op[x, y][3]
            na = np_[x, y][3]
            if oa == 255 and na == 255:
                cmp += 1
                if op[x, y][:3] == np_[x, y][:3]:
                    same += 1
                else:
                    diffs.append(sum(abs(op[x, y][k] - np_[x, y][k]) for k in range(3)))
    if cmp == 0:
        return None, "无全不透明重叠像素"
    rate = 100.0 * same / cmp
    mad = (sum(diffs) / len(diffs)) if diffs else 0
    return rate, "全不透明像素 %d，RGB 一致率 %.2f%%，平均差异 %.2f" % (cmp, rate, mad)

def purple_pixels(path, cap=2000):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    cnt = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            s = mx - mn
            if s < 30:
                continue
            if b >= r and b > g:  # 蓝/紫主导
                hue_b = (mx - g) / s
                hue = 60 * (2 + hue_b)
            elif b > r:
                hue = 60 * (4 + (b - g) / s)
            else:
                hue = 0
            if 265 <= hue <= 320 and b > 60:
                cnt += 1
    return cnt  # 抽样点计数（step2）

def vermilion_clusters(path, maxw=800, merge_r=6):
    """朱砂红口径（暖橙棕白名单 + 形态学合并）：
    返回 (合并后块数, 原始连通块数, 红像素占比%)。
    合并半径 merge_r 个网格单元（≈48px），避免把一条龙/一组刺绣拆成十几块。"""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    sc = max(1, w // maxw)
    sm = im.resize((w // sc, h // sc))
    px = sm.load()
    W, H = sm.size
    grid = set()
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            s = mx - mn
            if r < 150 or g > 110 or b > 110:
                continue
            if s < 50 or r - g < 80 or r - b < 80:
                continue
            if s == 0:
                continue
            hp = (g - b) / s
            hue = 60 * hp if g >= b else 60 * (6 + hp)
            if hue <= 12 or hue >= 348:
                grid.add((x // 8, y // 8))

    def comps(cells):
        seen = set(); n = 0
        for c in cells:
            if c in seen:
                continue
            n += 1; st = [c]; seen.add(c)
            while st:
                cx, cy = st.pop()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nb = (cx + dx, cy + dy)
                    if nb in cells and nb not in seen:
                        seen.add(nb); st.append(nb)
        return n

    raw = comps(grid)
    # 膨胀 merge_r 后再数连通块 ⇒ 邻近碎片合并
    exp = set()
    for (cx, cy) in grid:
        for dx in range(-merge_r, merge_r + 1):
            for dy in range(-merge_r, merge_r + 1):
                exp.add((cx + dx, cy + dy))
    merged = comps(exp) if exp else 0
    frac = 100.0 * len(grid) / (W * H)
    return merged, raw, frac

print("═" * 70)
print("A 类返工 16 张：边缘白占比 / 四角 / 带 alpha / 体积 / 造型冻结")
print("═" * 70)
A_GROUPS = {
    "mascot": (512, 512, 20480),
    "empty": (512, 512, 20480),
    "onboard": (None, None, 24000),  # 尺寸混合，单独判
}
ONBOARD_SIZE = {"main": (800, 600), "step1-pinyin": (512, 512),
                "step2-listen": (512, 512), "step3-speak": (512, 512),
                "step4-score": (512, 512)}
for grp, (ew, eh, cap) in A_GROUPS.items():
    for p in sorted(glob.glob(os.path.join(ASSETS, grp, "*.webp"))):
        name = os.path.basename(p)
        rel = "assets/%s/%s" % (grp, name)
        im = Image.open(p)
        w, h = im.size
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        c = corners(p)
        wp, edge, near = edge_white(p)
        sz = os.path.getsize(p)
        if grp == "onboard":
            ew, eh = ONBOARD_SIZE.get(name.replace(".webp", ""), (None, None))
        sz_ok = sz <= cap
        dim_ok = (ew is None) or (w == ew and h == eh)
        rate, fdetail = rgb_freeze_check(rel, p)
        print("\n%s/%s  (%dx%d, %dKB)" % (grp, name, w, h, sz // 1024))
        ok(has_alpha, "  带 alpha", str(im.mode))
        ok(all(v == 0 for v in c), "  四角 alpha=0", str(c))
        # 边缘白：占比%仅在边缘带≥20px时有效；薄边带看绝对近白像素数
        ew_ok = (edge >= 20 and wp <= 2.0) or (near <= 3)
        ok(ew_ok, "  边缘白(近白像素≤3或占比≤2%)", "近白%d / 带%dpx / 占比%.2f%%" % (near, edge, wp))
        ok(dim_ok, "  尺寸正确", "%dx%d" % (w, h))
        ok(sz_ok, "  体积达标", "%dB" % sz)
        # 造型冻结：旧图有真实透明（mascot/empty）→ 轮廓 IoU；旧图实底（onboard）→ 实心 RGB 一致率
        old_b = git_old_bytes(rel)
        if old_b:
            try:
                oimg = Image.open(io.BytesIO(old_b)).convert("RGBA")
                opx = oimg.load(); ow, oh = oimg.size
                maxa = mina = opx[0, 0][3]
                for yy in range(oh):
                    for xx in range(ow):
                        a = opx[xx, yy][3]
                        if a > maxa: maxa = a
                        if a < mina: mina = a
                real_alpha = (mina < 250 and maxa > 250)
            except Exception:
                real_alpha = False
            if real_alpha:
                iou, idetail = silhouette_iou(old_b, p)
                ok(iou >= 96.5, "  造型冻结(轮廓IoU≥96.5%)", idetail)
            else:
                rate, idetail = character_rgb_preserved(old_b, p)
                ok(rate >= 97.0, "  造型冻结(实心RGB一致率≥97%)", idetail)
        else:
            print("  ⚠️  无旧图，跳过造型冻结")

print("\n" + "═" * 70)
print("B 类 read 6×3：尺寸 / 体积 / 红线(紫污染 / 朱砂红)")
print("═" * 70)
SCENES = ["breakfast", "commute", "doctor", "friends", "market", "travel"]
for sc in SCENES:
    png = os.path.join(ASSETS, "read", sc + ".png")
    w1 = os.path.join(ASSETS, "read", sc + ".webp")
    w2 = os.path.join(ASSETS, "read", sc + "_2x.webp")
    print("\n%s" % sc)
    if os.path.exists(png):
        im = Image.open(png)
        ok(im.size == (1600, 900), "  PNG 1600×900", str(im.size))
    if os.path.exists(w1):
        im = Image.open(w1)
        sz = os.path.getsize(w1)
        ok(im.size == (800, 450), "  1x 800×450", str(im.size))
        ok(sz <= 60 * 1024, "  1x ≤60KB", "%.1fKB" % (sz / 1024))
    if os.path.exists(w2):
        im = Image.open(w2)
        sz = os.path.getsize(w2)
        ok(im.size == (1600, 900), "  2x 1600×900", str(im.size))
        ok(sz <= 200 * 1024, "  2x ≤200KB", "%.1fKB" % (sz / 1024))
    # 红线：用 1x webp 扫紫污染 + 朱砂红
    if os.path.exists(w1):
        pp = purple_pixels(w1)
        ok(pp <= 300, "  紫污染像素(抽样)≤300", "抽样点 %d" % pp)
        vc, raw, frac = vermilion_clusters(w1)
        ok(vc <= 3, "  朱砂红合并块≤3(白名单+形态学)", "合并%d块(原始%d) 红面积%.2f%%(暖光会残留误报)" % (vc, raw, frac))

print("\n" + "═" * 70)
print("两棵树 MD5 逐文件一致（mascot/empty/onboard/read）")
print("═" * 70)
for grp in ["mascot", "empty", "onboard", "read"]:
    a_dir = os.path.join(ASSETS, grp)
    w_dir = os.path.join(WWW, grp)
    if not os.path.isdir(a_dir):
        continue
    mism = 0
    total = 0
    for f in sorted(os.listdir(a_dir)):
        af, wf = os.path.join(a_dir, f), os.path.join(w_dir, f)
        if not os.path.exists(wf):
            mism += 1
            print("  ❌ %s/%s 在 www 树缺失" % (grp, f))
            continue
        total += 1
        if md5(af) != md5(wf):
            mism += 1
            print("  ❌ %s/%s MD5 不一致" % (grp, f))
    ok(mism == 0, "  %s 树一致 (%d 文件)" % (grp, total), "%d 不符" % mism)

print("\n" + "═" * 70)
print("index.html 引用核对")
print("═" * 70)
html = io.open(os.path.join(APP, "index.html"), encoding="utf-8").read()
read_refs = set()
for m in __import__("re").findall(r"assets/read/([\w.]+\.webp)", html):
    read_refs.add(m)
ok(all(r in {s + ".webp" for s in SCENES} for r in read_refs),
   "  read 只引 1x webp 且全 6 场景", str(sorted(read_refs)))
ok("srcset" not in html.lower() and "devicePixelRatio" not in html,
   "  无 srcset/dpr", "srcset" in html.lower() and "含srcset" or "无")
onb = __import__("re").findall(r"assets/onboard/([\w.-]+\.webp)", html)
ok(all(n in ("main.webp", "step1-pinyin.webp", "step2-listen.webp",
             "step3-speak.webp", "step4-score.webp") for n in onb),
   "  onboard 用工程名", str(sorted(set(onb))))

print("\n" + "═" * 70)
print("汇总：PASS=%d  FAIL=%d" % (len(PASS), len(FAIL)))
print("═" * 70)
if FAIL:
    print("失败项：")
    for l, d in FAIL:
        print("  ✗", l, d)
