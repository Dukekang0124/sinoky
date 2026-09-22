# -*- coding: utf-8 -*-
"""v0.23.20 bump：version.json(version/note/noteEn) + sw.js CACHE + index.html APP_VERSION + download.html 兜底 ×2。
幂等。apk 块（versionCode/url/md5/size）不动——由 apk.yml 在出包时回写真实值，避免先发占位值。
"""
import os, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VJ = os.path.join(ROOT, 'version.json')
SW = os.path.join(ROOT, 'sw.js')
IH = os.path.join(ROOT, 'index.html')
DH = os.path.join(ROOT, 'download.html')
NEW = '0.23.20'
PREV = '0.23.19'

# ---- version.json（仅顶层 version/note/noteEn；apk 块留给 CI） ----
vj = json.load(open(VJ, encoding='utf-8'))
if vj.get('version') == NEW:
    print('version.json version already %s' % NEW)
else:
    vj['version'] = NEW
    vj['updated'] = '2026-09-22'
    vj['note'] = ('v0.23.20：新增「语法/写作教练」（B2）。首页多了一张"✍️ 写一句中文"卡：诺诺出题'
      '（用你学过的字造句 / 自我介绍 / 说说今天做了什么 / 翻译一句），你写下中文，诺诺当场批改——'
      '先给改正后最自然的一句话，再用 1-2 句讲清改了什么、为什么。改完点"读出来"就直接接着跟读打分与点评，'
      '把"写"闭环到"说"。每次提交 1 次 AI 调用、每天最多 10 次，全程走免费 GLM-4-Flash，离线/超时回落。'
      '仅网页发布，APK 经 CI 出包后同版本上线。')
    en = ('v0.23.20: new Grammar & Writing Coach (B2). A new "Write a sentence" card on Home: Nono sets the task '
      '(build a sentence with characters you have learned / introduce yourself / say what you did today / translate a line), '
      'you write it in Chinese, and Nono corrects it on the spot - first the most natural corrected sentence, then one or two '
      'short lines explaining what changed and why. Tap "Read it out" to go straight into read-after-me scoring and the coaching '
      'tip, closing the loop from writing to speaking. One AI call per submission, capped at 10/day, all on free GLM-4-Flash '
      'with offline/timeout fallbacks. Web-only until the CI-built APK ships at the same version.')
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
