# -*- coding: utf-8 -*-
"""v0.24.2 bump：代码审计 P1 修复（城市攻略语音失效 + 边缘 TTS 密钥泄露）。

幂等。四类版本号（web 线）：index.html APP_VERSION / sw.js CACHE
/ version.json 顶层 / download.html 直链 ×2。
version.json 的 apk 段（url/versionCode/md5/size）**不动** —— 由 apk.yml 出包时回写。
"""
import os, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IH = os.path.join(ROOT, 'index.html')
SW = os.path.join(ROOT, 'sw.js')
VJ = os.path.join(ROOT, 'version.json')
DH = os.path.join(ROOT, 'download.html')
NEW, PREV = '0.24.2', '0.24.1'

NOTE_ZH = ('v0.24.2：代码审计 P1 修复。'
  '（1）城市攻略语音失效：nonoStartGuide 设 mode=\'guide\' 但未设 NONO_LINE，导致 nonoRecord 守卫直接 return、'
  '攻略界面点麦克风毫无反应；现放行 guide 模式并复用聊天语音路径（ASR → 带【城市：X】前缀的诺诺问答），'
  '攻略场景可正常语音提问。'
  '（2）边缘 TTS 密钥泄露：_worker.js 中 Edge/Cosy TTS 转发密钥曾以明文硬编码在公开仓库，'
  '已改为从环境变量 env.EDGE_TTS_KEY 读取（未配置时自动回退 google/melo/youdao 兜底链，不影响可用性）。'
  '运维侧需在 Cloudflare Dashboard 为独立 edge-tts Worker 轮换密钥并配置 EDGE_TTS_KEY 变量。'
  '网页与 APK 同版本上线。')

NOTE_EN = ('v0.24.2: code-audit P1 fixes. '
  '(1) City-guide voice was dead: nonoStartGuide set mode=\'guide\' without NONO_LINE, so the nonoRecord '
  'guard returned early and tapping the mic in the guide screen did nothing. Guide mode now passes the guard '
  'and reuses the chat voice path (ASR -> Nono Q&A prefixed with [city: X]), so voice questions work in guides. '
  '(2) Edge/Cosy TTS relay key was hard-coded in plaintext in the public repo; it now reads from the '
  'env.EDGE_TTS_KEY variable (falls back to google/melo/youdao if unset, no availability impact). '
  'Ops: rotate the key on the standalone edge-tts Worker and set EDGE_TTS_KEY in the Pages project. '
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
