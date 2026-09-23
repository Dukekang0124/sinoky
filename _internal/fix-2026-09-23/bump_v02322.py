# -*- coding: utf-8 -*-
"""v0.23.22 bump：version.json(version/note/noteEn) + sw.js CACHE + index.html APP_VERSION + download.html 兜底 ×2。
幂等。apk 块（versionCode/url/md5/size）不动——由 apk.yml 在出包时回写真实值，避免先发占位值。
"""
import os, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VJ = os.path.join(ROOT, 'version.json')
SW = os.path.join(ROOT, 'sw.js')
IH = os.path.join(ROOT, 'index.html')
DH = os.path.join(ROOT, 'download.html')
NEW = '0.23.22'
PREV = '0.23.21'

# ---- version.json（仅顶层 version/note/noteEn；apk 块留给 CI） ----
vj = json.load(open(VJ, encoding='utf-8'))
if vj.get('version') == NEW:
    print('version.json version already %s' % NEW)
else:
    vj['version'] = NEW
    vj['updated'] = '2026-09-23'
    vj['note'] = ('v0.23.22：上海攻略中心 + 诺诺聊天空窗重做。'
      '（1）诺诺聊天（chat）从被遮挡的小窗改为「贴底大抽屉」：全宽贴底、自动避让键盘、可一键收起回小窗，'
      '彻底解决旧版浮窗压住内容和输入框的问题。（2）新增「上海攻略中心」——站在第一次来上海的外国人角度，'
      '把会遇到的所有实务拆成 9 个分区：机场到达、手机支付、地铁购票与换乘、打车、美食点单、景点门票、酒店入住、'
      '求助走失、离境退税；每个分区给核心短语（中文+拼音+英文）、情景对话、并支持「跟读三遍」打卡。'
      '（3）每区可一键「问诺诺（本地通）」——走新增的 guide 模式（免费 GLM-4-Flash，自动带入所在城市上下文、'
      '历史与闲聊隔离、不污染练习进度）。城市已参数化，北京等后续只需往 CITY_GUIDES 加数据，前端零改动。'
      '网页与 APK 同版本上线。')
    en = ('v0.23.22: Shanghai City Guide + rebuilt Nono chat window. '
      '(1) Nono chat (chat mode) is no longer an occluded small pop-up - it is now a bottom-docked full-width drawer '
      'that auto-clears the on-screen keyboard and collapses back to a small window with one tap, fixing the old problem '
      'where the floating panel covered content and the input box. '
      '(2) New "Shanghai Guide Center" - written from the perspective of a foreigner visiting Shanghai for the first time, '
      'it breaks every real-world task into 9 zones: airport arrival, mobile payment, metro tickets & transfers, taxi, '
      'ordering food, attraction tickets, hotel check-in, asking for help / getting lost, and departure & tax refund. '
      'Each zone gives key phrases (Chinese + pinyin + English), a situation dialogue, and "say it 3x" check-in tracking. '
      '(3) Each zone has a one-tap "Ask Nono (local guide)" that uses the new guide mode (free GLM-4-Flash, with the '
      'current city injected as context, chat history isolated from free chat, and zero pollution of practice progress). '
      'Cities are parameterised - Beijing and others only need an entry in CITY_GUIDES, with zero front-end change. '
      'Web and APK ship together at this version.')
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
