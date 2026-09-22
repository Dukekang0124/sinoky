# -*- coding: utf-8 -*-
"""v0.23.19 bump：version.json(version/note/noteEn) + sw.js CACHE + index.html APP_VERSION + download.html 兜底 ×2。
幂等。apk 块（versionCode/url/md5/size）不动——由 apk.yml 在出包时回写真实值，避免先发占位值。
"""
import os, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VJ = os.path.join(ROOT, 'version.json')
SW = os.path.join(ROOT, 'sw.js')
IH = os.path.join(ROOT, 'index.html')
DH = os.path.join(ROOT, 'download.html')
NEW = '0.23.19'

# ---- version.json（仅顶层 version/note/noteEn；apk 块留给 CI） ----
vj = json.load(open(VJ, encoding='utf-8'))
if vj.get('version') == NEW:
    print('version.json version already %s' % NEW)
else:
    vj['version'] = NEW
    vj['updated'] = '2026-09-22'
    vj['note'] = ('v0.23.19：智能化深度升级（A1/A2/A3/B1）。A1 记忆化教练——诺诺现在"记得"你的发音弱点与'
      '最近读错的字，跟读点评/情境接话/复习出题/自由对话都会带上你的学习背景，点评更准；'
      'A3 语义兜底——点评顺带提醒同音错字（如"买/卖"）；A2 字卡 grounding——收藏汉字时诺诺依据真实已学字表造记忆锚点；'
      'B1 自适应日计划——首页新增"诺诺为你定的今日计划"卡，按全量进度生成 ≤3 条今日行动、末条必为开口说（每日≤1次 AI 调用）。'
      '全部复用免费 GLM-4-Flash，零新增 KV 写，离线/超时均回落。仅网页发布，APK 经 CI 出包后同版本上线。')
    en = ('v0.23.19: intelligence depth upgrade (A1/A2/A3/B1). A1 memory coach - Nono now "remembers" '
      'your pronunciation weak spots and recent misread characters; coach comment, scene reply, review drill '
      'and free chat all carry your learning context for sharper tips. A3 semantic fallback - the coach also '
      'flags homophone mistakes (e.g. mai/mmai). A2 flashcard grounding - when you star a character Nono builds '
      'the memory anchor against your real learned word list. B1 adaptive daily plan - a new "Nono\'s plan for you" '
      'Home card generates <=3 daily actions from your full progress, the last one always a speak task (<=1 AI call/day). '
      'All on free GLM-4-Flash, zero extra KV writes, with offline/time-out fallbacks. Web-only until the CI-built APK ships at the same version.')
    vj['noteEn'] = [en] + (vj.get('noteEn') or [])
    json.dump(vj, open(VJ, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(VJ, 'a', encoding='utf-8').write('\n')
    print('version.json -> %s' % NEW)

# ---- sw.js CACHE ----
s = open(SW, encoding='utf-8').read()
if "var CACHE = 'sinoky-v%s'" % NEW in s:
    print('sw.js already %s' % NEW)
else:
    c = s.count("var CACHE = 'sinoky-v0.23.18'")
    if c == 0:
        print('ABORT sw.js CACHE anchor 0.23.18 not found (count=%d)' % c); sys.exit(1)
    s = s.replace("var CACHE = 'sinoky-v0.23.18'", "var CACHE = 'sinoky-v%s'" % NEW, 1)
    open(SW, 'w', encoding='utf-8').write(s)
    print('sw.js CACHE -> sinoky-v%s' % NEW)

# ---- index.html APP_VERSION ----
h = open(IH, encoding='utf-8').read()
if "var APP_VERSION = '%s'" % NEW in h:
    print('index.html APP_VERSION already %s' % NEW)
else:
    c = h.count("var APP_VERSION = '0.23.18'")
    if c != 1:
        print('ABORT index.html APP_VERSION anchor count=%d' % c); sys.exit(1)
    h = h.replace("var APP_VERSION = '0.23.18'", "var APP_VERSION = '%s'" % NEW, 1)
    open(IH, 'w', encoding='utf-8').write(h)
    print('index.html APP_VERSION -> %s' % NEW)

# ---- download.html 兜底 APK url ×2 ----
d = open(DH, encoding='utf-8').read()
if 'Sinoky-v%s-release.apk' % NEW in d:
    print('download.html already %s' % NEW)
else:
    c = d.count('Sinoky-v0.23.13-release.apk')
    if c == 0:
        print('ABORT download.html anchor 0.23.13 not found (count=%d)' % c); sys.exit(1)
    d = d.replace('Sinoky-v0.23.13-release.apk', 'Sinoky-v%s-release.apk' % NEW)
    open(DH, 'w', encoding='utf-8').write(d)
    print('download.html fallback -> Sinoky-v%s-release.apk (%d hits)' % (NEW, c))
print('DONE')
