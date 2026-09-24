# -*- coding: utf-8 -*-
"""v0.24.1 bump：发版后体检整改（P0）—— 资源合规 + 多语言补全 + 闸门修复。

幂等。四类版本号（web 线）：index.html APP_VERSION / sw.js CACHE
/ version.json 顶层 / download.html 直链 ×2。
version.json 的 apk 段（url/versionCode/md5/size）**不动** —— 由 apk.yml 出包时回写；
注意 CI 只回写部署目录 www/version.json，不回写仓库根（已知事实，见 NOTES-RELEASE-DEPLOY.md）。
"""
import os, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IH = os.path.join(ROOT, 'index.html')
SW = os.path.join(ROOT, 'sw.js')
VJ = os.path.join(ROOT, 'version.json')
DH = os.path.join(ROOT, 'download.html')
NEW, PREV = '0.24.1', '0.24.0'

NOTE_ZH = ('v0.24.1：发版后体检整改（P0）。（1）资源合规：从 assets/ 移出 19 个零引用文件（约 1.35 MB）'
  '——6 个废弃 2x 备图、6 个已被矢量图标取代的旧 PNG 图标、2 个废弃 banner、3 个废弃分享卡备件、'
  '1 个未采用品牌形象；其中 assets/scenes/meeting.md 是含内部规范库路径的内容脚本，此前会被公开下载。'
  '根因是构建对 assets 整目录拷贝、无逐文件排除机制，已补审计工具防复发。'
  '（2）多语言补全：修复非英语用户在 7 处直接看到英文或中文硬编码文案的缺陷 —— 诺诺页内提示（9 条消费点'
  '漏包翻译函数）、限额芯片（原显示「今天还剩 5 次Nono chat」，中英混排且语序错乱）、声调纠错标签、'
  '新用户引导卡整卡、诺诺注入段；共新增 27 条字典 key × 6 语言 = 162 条译文，'
  '6 个语言包 key 集合保持完全一致（706→733）。'
  '（3）工具修复：i18n 构建闸门原先不还原 \\uXXXX 转义，含 emoji 的文案会被误报为「字典缺失」，'
  '而照报错补进去的 key 又永远命不中（源码文本与实际字符串形状不一致），现已修正。'
  '网页与 APK 同版本上线。')

NOTE_EN = ('v0.24.1: post-release audit remediation (P0). '
  '(1) Asset compliance: 19 unreferenced files (~1.35 MB) were removed from assets/ - 6 retired 2x backups, '
  '6 legacy PNG icons superseded by vector icons, 2 retired banners, 3 retired share-card spares, and '
  '1 unused brand illustration. Among them, assets/scenes/meeting.md was an internal content script containing '
  'internal library paths that had been publicly downloadable. Root cause: the build copied the whole assets '
  'directory with no per-file exclusion; an audit tool was added to prevent recurrence. '
  '(2) Localisation completeness: fixed 7 places where non-English users saw hard-coded English or Chinese - '
  'Nono in-page hints (9 call sites missing the translate call), the quota chip (previously rendered as '
  '"今天还剩 5 次Nono chat", mixing languages and scrambling word order), tone-correction labels, the entire '
  'first-run tour card, and the Nono intro block; 27 new dictionary keys x 6 languages = 162 new strings were '
  'added, keeping all six packs in exact key parity (706 -> 733). '
  '(3) Tooling fix: the i18n build gate did not decode \\uXXXX escapes, so strings containing emoji were '
  'reported as missing while any key added to match that report could never resolve at runtime; this is now fixed. '
  'Web and APK ship together at this version.')

# ---------- ① index.html APP_VERSION ----------
h = open(IH, encoding='utf-8').read()
anchor = "var APP_VERSION = '%s'" % NEW
if anchor in h:
    print('index.html APP_VERSION already %s' % NEW)
else:
    old = "var APP_VERSION = '%s'" % PREV
    c = h.count(old)
    if c != 1:
        print('ABORT index.html APP_VERSION anchor %s count=%d' % (PREV, c)); sys.exit(1)
    h = h.replace(old, anchor, 1)
    open(IH, 'w', encoding='utf-8', newline='').write(h)
    print('index.html APP_VERSION -> %s' % NEW)

# ---------- ② sw.js CACHE ----------
s = open(SW, encoding='utf-8').read()
anchor = "var CACHE = 'sinoky-v%s'" % NEW
if anchor in s:
    print('sw.js already %s' % NEW)
else:
    old = "var CACHE = 'sinoky-v%s'" % PREV
    c = s.count(old)
    if c != 1:
        print('ABORT sw.js CACHE anchor %s count=%d' % (PREV, c)); sys.exit(1)
    s = s.replace(old, anchor, 1)
    open(SW, 'w', encoding='utf-8').write(s)
    print('sw.js CACHE -> sinoky-v%s' % NEW)

# ---------- ③ version.json 顶层 ----------
vj = json.load(open(VJ, encoding='utf-8'))
if vj.get('version') == NEW and (vj.get('noteEn') or [''])[0].startswith('v%s:' % NEW):
    print('version.json already %s' % NEW)
else:
    vj['version'] = NEW
    vj['updated'] = '2026-09-24'
    vj['note'] = NOTE_ZH
    rest = [x for x in (vj.get('noteEn') or []) if not x.startswith('v%s:' % NEW)]
    vj['noteEn'] = [NOTE_EN] + rest
    json.dump(vj, open(VJ, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(VJ, 'a', encoding='utf-8').write('\n')
    print('version.json -> %s（noteEn %d 条）' % (NEW, len(vj['noteEn'])))

# ---------- ④ download.html 直链 ×2 ----------
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
    print('download.html -> Sinoky-v%s-release.apk（%d 处）' % (NEW, c))

print('DONE')
