# -*- coding: utf-8 -*-
"""v0.23.1：version.json 版本号 + note 重写（品牌图标还原为红字标）

铁律：
  · 'rb'/'wb' 读写，保持 CRLF（不用 text 模式，默认换行转换会让行数翻倍）
  · 不用 json.dump —— 它会重排 noteEn 缩进 / 转义中文，产生无意义 diff
  · 逐行精确匹配（带缩进），断言每处命中恰 1 次

跑法：python _setver-v0231.py
"""
import os
import json

P = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'version.json'))

NEW_VER = '0.23.1'
NEW_NOTE = (
    'v0.23.1：品牌图标还原为红字标 + 熊猫归位为应用内角色。'
    '① header 唯一品牌图标位 icons/logo-header.png 与 favicon-32.png 还原为品牌设计的红字标'
    '（深青黑 #141a24 底 + 朱砂红 #e63946 钥匙几何标），与 04-品牌设计/assets/第二轮/'
    'sinoky-图标-192.png / -32.png 逐字节一致（4,989 B / 885 B，md5 ab9b1b66… / beb28dca…）。'
    'v0.22.0 曾误把这个品牌字标换成诺诺熊猫 —— 品牌字标与吉祥物是两个角色，不能互相顶替。'
    '② 品牌图标从此加锁：smoke-tour.js 新增「暗底 ≥ 60% 且米白 ≈ 0」判据，把「红字标」与「熊猫配色」分开'
    '（红字标 = 深青黑 + 朱砂红；熊猫 = 米白 + 黑），并逐字节锚定 4,989 B / 885 B，防再次误换。'
    '③ 熊猫（诺诺）继续在应用内各场景出现 —— 启动屏、首启引导、面板、浮标、空态、分享卡、'
    '6 站功能导览、16/17 视图问候全部保留，符合「熊猫元素可以在产品应用内的任何场景和功能中出现」。'
    '网页版 v0.23.1。'
)
NEW_NOTE_EN = (
    'v0.23.1: the brand icon is restored to the red wordmark and the panda returns to its in-app role. '
    '(1) The header logo and the favicon are back to the brand-design red mark - a deep ink-black tile '
    '(#141a24) carrying the cinnabar (#e63946) key glyph - byte-identical to the brand sources '
    '(4,989 B and 885 B). v0.22.0 had mistakenly replaced this brand wordmark with the panda mascot; '
    'the brand mark and the mascot are two distinct roles and must not stand in for each other. '
    '(2) The brand icon is now locked: the acceptance script asserts a dark tile (>= 60% dark pixels) '
    'with near-zero off-white, which separates the red mark from panda colours, plus byte-size anchors, '
    'so it cannot be swapped again by accident. '
    '(3) The panda still appears throughout the app - splash, onboarding, panel, floating button, '
    'empty states, share card, the six-stop tour and 16 of 17 contextual greetings - consistent with '
    'the panda being free to appear in any in-app scene.'
)

b = open(P, 'rb').read()
bare = b.count(b'\n') - b.count(b'\r\n')
assert bare == 0, 'version.json 行尾不是纯 CRLF（裸 LF = %d）' % bare

lines = b.split(b'\r\n')
hit = {'ver': 0, 'note': 0, 'noteEn': 0}
for i, ln in enumerate(lines):
    if ln == b'  "version": "0.23.0",':                     # 顶层（2 空格缩进；apk 段是 4 空格，不会误命中）
        lines[i] = ('  "version": "%s",' % NEW_VER).encode('utf-8')
        hit['ver'] += 1
    elif ln.startswith(b'  "note": "'):
        lines[i] = ('  "note": "%s",' % NEW_NOTE).encode('utf-8')
        hit['note'] += 1
    elif ln.strip().startswith(b'"v0.23.0:'):               # noteEn[0]
        lines[i] = ('    "%s",' % NEW_NOTE_EN).encode('utf-8')
        hit['noteEn'] += 1

assert hit == {'ver': 1, 'note': 1, 'noteEn': 1}, '替换命中数异常 %r' % hit

out = b'\r\n'.join(lines)
open(P, 'wb').write(out)

j = json.loads(out.decode('utf-8'))
assert j['version'] == NEW_VER
assert j['note'].startswith('v0.23.1')
assert j['noteEn'][0].startswith('v0.23.1')
print('OK  version = %s' % j['version'])
print('OK  note    = %d 字' % len(j['note']))
print('OK  noteEn  = %d 条（[0] 已换新，[1] 历史保留）' % len(j['noteEn']))
print('OK  apk 段   = %s（等 CI 回填 v0.23.1）' % json.dumps(j['apk'], ensure_ascii=False))
print('OK  行尾     = CRLF %d / 裸 LF %d' % (out.count(b'\r\n'), out.count(b'\n') - out.count(b'\r\n')))
