# -*- coding: utf-8 -*-
"""v0.24.0 落地 + bump：开屏图换底（v3 刻度版）+ #splash 底色对齐 + 六处版本号。
幂等。apk 块（versionCode/url/md5/size）不动——由 apk.yml 出包时回写真实值。

本次为「视觉 P1 设计语言换血」发版（静默仪表 / Quiet Instrument）：
  ① 开屏图 a8_9x16.webp 由旧语言（青瓷底 + 云头/回纹 + 鎏金龙纹）换成 v3 刻度版；
     角色与品牌字标**逐像素保留**（字标由 alpha 反解从原图抠出，不重绘）。
  ② #splash 底色 #0E3739 → var(--bg)：新图四边精确归零到 #141a24，非 9:16 屏
     letterbox 处与底色无缝（探针 probe_splash_seam.js 4 档视口实测图边 Δ=1）。
"""
import os, sys, shutil, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# ⚠️ 定案 v3b（dial-visible）而非 v3（dial）：
#    康哥选的是「刻度版」，但 v3 在真机 430 宽下刻度环**几乎不可见** ——
#    以 v3 与 v1 的真机截图做差集，主体外中位 Δ 仅 9/255（低于 12 的可见门槛），
#    根因是环色取 --line(Δ=30) + 1.8px 线宽经 0.398 倍缩放后被抗锯齿摊薄。
#    v3b 只调强度（环色升 --line-strong、峰值 alpha 0.60/0.75/0.90），构图完全不变，
#    真机主体外中位 Δ 提到 13（达门槛）。性质同「品牌红对比度 4.19→6.33」的质量修正，
#    非品牌决策。v3 原图保留在 splash-v3-dial.webp，一句话可换回。
SRC = os.path.join(ROOT, '_internal', 'fix-2026-09-23', 'splash', 'splash-v3b-dial-visible.webp')
DST = os.path.join(ROOT, 'assets', 'splash', 'a8_9x16.webp')
SW = os.path.join(ROOT, 'sw.js')
IH = os.path.join(ROOT, 'index.html')
VJ = os.path.join(ROOT, 'version.json')
DH = os.path.join(ROOT, 'download.html')
NEW = '0.24.0'
PREV = '0.23.23'


def md5(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()


# ---------- ① 落地开屏图 ----------
if not os.path.exists(SRC):
    print('ABORT 候选图不存在：%s' % SRC); sys.exit(1)
sm, dm = md5(SRC), (md5(DST) if os.path.exists(DST) else None)
if sm == dm:
    print('a8_9x16.webp 已是 v3（md5 %s）' % sm[:12])
else:
    shutil.copyfile(SRC, DST)
    print('a8_9x16.webp 已落地：%s -> %s  (%.1f KB)'
          % ((dm or 'NONE')[:12], sm[:12], os.path.getsize(DST) / 1024))

# ---------- ② #splash 底色 + 注释同步 ----------
h = open(IH, encoding='utf-8').read()

OLD_NOTE = """   🔴 v0.24.0 遗留（待康哥定品牌视觉）：本底色 #0E3739 是**开屏图边缘取自图内**的补色，
   不能单独改 —— 满版图 a8_9x16.webp 整体是旧设计语言（青瓷底 + 云头/回纹 + 鎏金龙纹），
   与「静默仪表」的「单一朱砂红 + 无云头回纹」正面冲突，而它是用户看到的第一帧。
   处置顺序必须是「先重出开屏图 → 再改这里与图边缘对齐」，否则非 9:16 屏会出现硬接缝。 */"""
NEW_NOTE = """   🔴 v0.24.0：开屏图已按「静默仪表」重出（v3 刻度版），本底色随之改为 var(--bg)=#141a24。
   依据：新图四边**精确归零**到 #141a24（生成器 splash_rebuild.py 的 edge_guard() 保证），
   与 --bg 逐通道相等 ⇒ 手机竖屏 contain 的上下补色、桌面宽屏的左右补色都无缝。
   验收：probe_splash_seam.js 跑 4 档视口 × 3 版候选，图边 Δ=1（WebP 有损自带的量化偏移）。
   生成器与候选在 _internal/fix-2026-09-23/splash/（含 说明.md 复现命令）。 */"""
if NEW_NOTE in h:
    print('#splash 注释已是 v0.24.0 版')
elif OLD_NOTE in h:
    h = h.replace(OLD_NOTE, NEW_NOTE, 1)
    print('#splash 注释 -> v0.24.0')
else:
    print('ABORT #splash 注释锚点未命中'); sys.exit(1)

OLD_BG = 'z-index:var(--z-splash);background:#0E3739;'
NEW_BG = 'z-index:var(--z-splash);background:var(--bg);'
if NEW_BG in h:
    print('#splash 底色已是 var(--bg)')
elif OLD_BG in h:
    h = h.replace(OLD_BG, NEW_BG, 1)
    print('#splash 底色 -> var(--bg)')
else:
    print('ABORT #splash 底色锚点未命中'); sys.exit(1)

if "var APP_VERSION = '%s'" % NEW in h:
    print('index.html APP_VERSION already %s' % NEW)
else:
    old = "var APP_VERSION = '%s'" % PREV
    c = h.count(old)
    if c != 1:
        print('ABORT index.html APP_VERSION anchor %s count=%d' % (PREV, c)); sys.exit(1)
    h = h.replace(old, "var APP_VERSION = '%s'" % NEW, 1)
    print('index.html APP_VERSION -> %s' % NEW)

open(IH, 'w', encoding='utf-8', newline='').write(h)

# ---------- ③ sw.js CACHE（红线：换预缓存图必须换 CACHE 名） ----------
s = open(SW, encoding='utf-8').read()
if "var CACHE = 'sinoky-v%s'" % NEW in s:
    print('sw.js already %s' % NEW)
else:
    old = "var CACHE = 'sinoky-v%s'" % PREV
    c = s.count(old)
    if c != 1:
        print('ABORT sw.js CACHE anchor %s count=%d' % (PREV, c)); sys.exit(1)
    s = s.replace(old, "var CACHE = 'sinoky-v%s'" % NEW, 1)
    open(SW, 'w', encoding='utf-8').write(s)
    print('sw.js CACHE -> sinoky-v%s' % NEW)

# ---------- ④ version.json（version/updated/note/noteEn；noteEn 按版本前缀去重） ----------
import json
vj = json.load(open(VJ, encoding='utf-8'))
if vj.get('version') == NEW and (vj.get('noteEn') or [''])[0].startswith('v%s:' % NEW):
    print('version.json already %s' % NEW)
else:
    vj['version'] = NEW
    vj['updated'] = '2026-09-23'
    vj['note'] = ('v0.24.0：视觉设计语言换血（P1）。'
      '（1）全站配色改为新的「静默仪表」体系：深石墨底 #141a24 + 单一朱砂信号红 #e63946 + '
      '仅服务语音域的功能青 #4cc9f0；弃用金色与青瓷作主题色，成功态改用独立语义色 --ok。'
      '（2）移除全部中式装饰层：满视口金网格底纹、诺诺面板网格、卡片四角云头、回纹带、'
      '导航金线祥云、龙鳞进度条——界面由「装饰性」转为「仪表性」。'
      '（3）图标体系统一：emoji 与位图图标替换为 20 个矢量线性图标（Lucide，ISC 许可），'
      '由 CSS mask 着色、随文字色自动适配；新增「反馈」圆形图标按钮。'
      '（4）层级建立单一事实源：全站 z-index 收编为 17 个 --z-* 设计令牌，'
      '语义为「功能件 < 陪伴角色 < 浮层」；同时修复「反馈按钮与诺诺浮标自 v0.5.0 起'
      '同角重叠、靠运行时补丁掩盖」的既有布局缺陷（补丁已收回源码）。'
      '（5）开屏图重出为「静默仪表」刻度版：保留原角色与品牌字标（逐像素），'
      '仅换背景语言，消除与旧视觉的断层。网页与 APK 同版本上线。')
    en = ('v0.24.0: visual design-language overhaul (P1). '
      '(1) Site-wide palette moved to the new "Quiet Instrument" system: graphite background #141a24, '
      'a single vermilion signal red #e63946, and a function cyan #4cc9f0 reserved for the speech domain; '
      'gold and celadon are retired as theme colours, and the success state now uses its own semantic token --ok. '
      '(2) All Chinese-style ornament layers removed: the full-viewport gold grid, the Nono panel grid, '
      'card corner cloud-scrolls, the fret band, the nav gold rule/auspicious-cloud motif, and the dragon-scale '
      'progress bar - the interface shifts from decorative to instrumental. '
      '(3) Icon system unified: emoji and bitmap icons replaced by 20 vector line icons (Lucide, ISC licence), '
      'tinted via CSS mask so they follow the text colour automatically; a circular Feedback icon button was added. '
      '(4) Layering now has a single source of truth: all z-index values are consolidated into 17 --z-* design '
      'tokens with the semantics "utility < companion character < overlay"; this also fixes a long-standing layout '
      'defect where the Feedback button and the Nono widget had overlapped in the same corner since v0.5.0 '
      '(previously masked by a runtime patch, now folded back into the source). '
      '(5) The splash artwork was re-rendered as a "Quiet Instrument" dial: the character and brand lock-up are '
      'preserved pixel-for-pixel; only the background language changed, removing the visual break with the old look. '
      'Web and APK ship together at this version.')
    # 按版本前缀去重：移除任何已存在的 v0.24.0 条目，再插入到队首
    rest = [x for x in (vj.get('noteEn') or []) if not x.startswith('v%s:' % NEW)]
    vj['noteEn'] = [en] + rest
    json.dump(vj, open(VJ, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(VJ, 'a', encoding='utf-8').write('\n')
    print('version.json -> %s（noteEn %d 条）' % (NEW, len(vj['noteEn'])))

# ---------- ⑤ download.html 兜底 APK url ×2 ----------
d = open(DH, encoding='utf-8').read()
if 'Sinoky-v%s-release.apk' % NEW in d:
    print('download.html already %s' % NEW)
else:
    old = 'Sinoky-v%s-release.apk' % PREV
    c = d.count(old)
    if c == 0:
        print('ABORT download.html anchor %s not found' % PREV); sys.exit(1)
    d = d.replace(old, 'Sinoky-v%s-release.apk' % NEW)
    open(DH, 'w', encoding='utf-8', newline='').write(d)
    print('download.html fallback -> Sinoky-v%s-release.apk (%d hits)' % (NEW, c))

print('DONE')
