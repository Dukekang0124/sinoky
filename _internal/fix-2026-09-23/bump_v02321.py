# -*- coding: utf-8 -*-
"""v0.23.21 bump：version.json(version/note/noteEn) + sw.js CACHE + index.html APP_VERSION + download.html 兜底 ×2。
幂等。apk 块（versionCode/url/md5/size）不动——由 apk.yml 在出包时回写真实值，避免先发占位值。
"""
import os, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VJ = os.path.join(ROOT, 'version.json')
SW = os.path.join(ROOT, 'sw.js')
IH = os.path.join(ROOT, 'index.html')
DH = os.path.join(ROOT, 'download.html')
NEW = '0.23.21'
PREV = '0.23.20'

# ---- version.json（仅顶层 version/note/noteEn；apk 块留给 CI） ----
vj = json.load(open(VJ, encoding='utf-8'))
if vj.get('version') == NEW:
    print('version.json version already %s' % NEW)
else:
    vj['version'] = NEW
    vj['updated'] = '2026-09-23'
    vj['note'] = ('v0.23.21：新增「反馈智能分诊」（B3，运营侧能力，用户界面无变化）。'
      '以前每一条用户反馈都要人工一条条读，现在后台会把近期反馈交给 AI 自动做摘要 + 主题聚类：'
      '先给你 2-3 句整体结论，再把反馈归成 3-6 个主题簇（每簇带条数、代表性原话和一条可执行建议），'
      '并单独标出最该立刻修的那一条。只读不写、走免费 GLM-4-Flash，模型不可用时自动降级为原文可读，'
      '绝不影响任何用户功能。仅网页发布，APK 经 CI 出包后同版本上线。')
    en = ('v0.23.21: new Feedback Triage (B3), an operator-side capability with no user-facing change. '
      'Instead of reading every user-feedback message by hand, the backend now hands recent feedback to the model for '
      'automatic summarisation and topic clustering: a two-to-three sentence overall read, then three to six clusters '
      '(each with a count, representative quotes and one actionable suggestion), plus a separate callout of the single '
      'issue that most needs fixing right now. Read-only, on free GLM-4-Flash, degrading gracefully to plain readable text '
      'when the model is unavailable, and never affecting any user-facing feature. Web-only until the CI-built APK ships '
      'at the same version.')
    vj['noteEn'] = [en] + (vj.get('noteEn') or [])
    json.dump(vj, open(VJ, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(VJ, 'a', encoding='utf-8').write('\n')
    print('version.json -> %s' % NEW)

# ---- sw.js CACHE ----
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

# ---- index.html APP_VERSION ----
h = open(IH, encoding='utf-8').read()
if "var APP_VERSION = '%s'" % NEW in h:
    print('index.html APP_VERSION already %s' % NEW)
else:
    old = "var APP_VERSION = '%s'" % PREV
    c = h.count(old)
    if c != 1:
        print('ABORT index.html APP_VERSION anchor %s count=%d' % (PREV, c)); sys.exit(1)
    h = h.replace(old, "var APP_VERSION = '%s'" % NEW, 1)
    open(IH, 'w', encoding='utf-8').write(h)
    print('index.html APP_VERSION -> %s' % NEW)

# ---- download.html 兜底 APK url ×2 ----
d = open(DH, encoding='utf-8').read()
if 'Sinoky-v%s-release.apk' % NEW in d:
    print('download.html already %s' % NEW)
else:
    old = 'Sinoky-v%s-release.apk' % PREV
    c = d.count(old)
    if c == 0:
        print('ABORT download.html anchor %s not found (count=%d)' % (PREV, c)); sys.exit(1)
    d = d.replace(old, 'Sinoky-v%s-release.apk' % NEW)
    open(DH, 'w', encoding='utf-8').write(d)
    print('download.html fallback -> Sinoky-v%s-release.apk (%d hits)' % (NEW, c))
print('DONE')
