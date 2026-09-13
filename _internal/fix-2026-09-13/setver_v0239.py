# -*- coding: utf-8 -*-
"""
setver_v0239.py —— 网页版 0.23.8 → 0.23.9（本轮只发网页线，APK 停在 0.23.4）

六处版本号（v0.23.2 起从「三处」升为六处）：
  1. version.json 顶层 version            ← 改
  2. version.json apk.version             ← **不动**（本版刻意不发包）
  3. index.html 的 APP_VERSION             ← 改
  4. sw.js 的 CACHE                        ← 改
  5. download.html 兜底 APK 直链 ×2 处      ← **不动**

🔴 两条门禁教训（都写在 memory 里，这里照做）：
  · **咬不变量，不要锚常量**：apk 段不是本版目标值，所以先整段存下来、改完比「一字未变」，
    而不是拿一个常量去卡它。
  · **脚本要幂等**：`setver_v0238.py` 的起点断言 `version == 0.23.8` 在重跑时会中止
    （本轮实测过一次）。本脚本改为「起点是 0.23.8 → 升；起点已是 0.23.9 → 跳过并只做复验」，
    第三轮跑也不会失败。
"""
import io
import json
import os
import re
import sys

APP = r'D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app'

OLD_WEB = '0.23.8'
NEW_WEB = '0.23.9'
OLD_CACHE = 'sinoky-v0.23.8'
NEW_CACHE = 'sinoky-v0.23.9'
APK_EXPECT = '0.23.4'
APK_VCODE = 2304
DATE = '2026-09-13'

NOTE_ZH = (
    'v0.23.9：修好「界面上的字看不清」这件事。'
    '① 有用户反馈复习卡片（Smart review）里的英文句子是黑的，压在深色底上几乎读不出来 —— '
    '同一张卡的中文却是正常的浅色。查下来根因是样式表里写了一个**从未定义过**的颜色变量：'
    '整个文件里它被引用了 5 次、定义了 0 次，于是浏览器按「没设颜色」处理，'
    '最终继承到了系统按钮的默认黑色。这个写法语法完全合法、浏览器不会报错，所以一直没人发现。'
    '现已把这类引用全部收敛到既有颜色变量上。'
    '② 顺着同一个根因做了一次全量体检：把 17 个界面里 **924 处可见文字**的"字色 vs 底色"对比度全部算了一遍，'
    '又抓出两处同类问题 —— 页脚的 Privacy / Share 两个链接掉了浏览器的默认链接色（深蓝，'
    '在深色底上等于看不见）；已完成步骤的圆形序号是白字压亮青色块。都已修正。'
    '③ 新增第 4 道自动检查（颜色令牌），以后「引用不存在的颜色变量」「链接掉到浏览器默认色」'
    '这两类问题在提交阶段就会被拦下，不会等到用户截图才发现。'
    '本版只发网页版，APK 仍为 v0.23.4。'
)

NOTE_EN = (
    'v0.23.9: fixes unreadable text in the interface. '
    '(1) A user reported that the English sentence in the Smart review card was black and almost '
    'impossible to read against the dark background, while the Chinese line on the same card looked '
    'correct. The cause was a colour variable that is referenced five times but was never defined '
    'anywhere - so the browser treated it as "no colour set" and the text inherited the operating '
    "system's default black for buttons. The syntax was completely valid and the browser reported no "
    'error, which is why it went unnoticed. All such references now use existing colour tokens. '
    '(2) Following the same root cause, every visible piece of text was measured: contrast between text '
    'colour and background was computed for 924 text elements across 17 screens. Two more cases of the '
    'same class were found and fixed - the footer Privacy and Share links were falling back to the '
    "browser's default link colour (dark blue, effectively invisible on a dark background), and the "
    '"completed" step circles used white text on a light teal fill. '
    '(3) A fourth automated gate (colour tokens) now blocks both classes of problem at commit time, so '
    'they cannot reach users before being caught. Web only this round; the APK stays at v0.23.4.'
)


def read(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def main():
    print('APP = %s' % APP)
    fails = []
    vj_p = os.path.join(APP, 'version.json')
    idx_p = os.path.join(APP, 'index.html')
    sw_p = os.path.join(APP, 'sw.js')
    dl_p = os.path.join(APP, 'download.html')

    vj = json.loads(read(vj_p))
    apk_before = json.dumps(vj.get('apk'), ensure_ascii=False, sort_keys=True)

    # ── 0. 前置：起点必须是 0.23.8 或已是 0.23.9（幂等） ────────────────
    if vj['version'] == NEW_WEB:
        print('起点确认：已是 %s ⇒ 只做复验（幂等路径）' % NEW_WEB)
    else:
        assert vj['version'] == OLD_WEB, '起点版本不是 %s（实得 %s）—— 先确认工作区状态' % (OLD_WEB, vj['version'])
        assert vj['apk']['version'] == APK_EXPECT, 'APK 段起点异常：%s' % vj['apk']['version']
        print('起点确认：网页 %s / APK %s ✅' % (vj['version'], vj['apk']['version']))

        vj['version'] = NEW_WEB
        vj['updated'] = DATE
        vj['note'] = NOTE_ZH
        en = vj.get('noteEn')
        if not isinstance(en, list):
            en = [en] if en else []
        if not (en and en[0].startswith('v0.23.9')):
            vj['noteEn'] = [NOTE_EN] + en
        apk_after = json.dumps(vj.get('apk'), ensure_ascii=False, sort_keys=True)
        # 不变量：apk 段一字未变
        if apk_after != apk_before:
            fails.append('version.json 的 apk 段被改动了！（本轮刻意不发包）')
        write(vj_p, json.dumps(vj, ensure_ascii=False, indent=2) + '\n')
        print('  ✔ version.json: %s → %s（apk 段保持不变）' % (OLD_WEB, NEW_WEB))

    # ── 1/2. index.html APP_VERSION + sw.js CACHE ──────────────────────
    s = read(idx_p)
    if s.count("var APP_VERSION = '%s';" % NEW_WEB) == 1:
        print('  = index.html APP_VERSION 已是 %s' % NEW_WEB)
    else:
        n = s.count("var APP_VERSION = '%s';" % OLD_WEB)
        assert n == 1, 'index.html APP_VERSION 锚点命中 %d 次' % n
        write(idx_p, s.replace("var APP_VERSION = '%s';" % OLD_WEB, "var APP_VERSION = '%s';" % NEW_WEB, 1))
        print('  ✔ index.html APP_VERSION → %s' % NEW_WEB)

    sw = read(sw_p)
    if sw.count("var CACHE = '%s';" % NEW_CACHE) == 1:
        print('  = sw.js CACHE 已是 %s' % NEW_CACHE)
    else:
        assert sw.count("var CACHE = '%s';" % OLD_CACHE) == 1, 'sw.js CACHE 锚点不唯一'
        write(sw_p, sw.replace("var CACHE = '%s';" % OLD_CACHE, "var CACHE = '%s';" % NEW_CACHE, 1))
        print('  ✔ sw.js CACHE → %s' % NEW_CACHE)

    # ── 3. download.html 兜底 APK 直链 ×2：必须**仍指向 0.23.4** ────────
    dl = read(dl_p) if os.path.exists(dl_p) else ''
    hits = re.findall(r'Sinoky-v([0-9.]+)-release\.apk', dl)
    if not hits:
        fails.append('download.html 里找不到 APK 直链（应为 2 处）')
    else:
        bad = [h for h in hits if h != APK_EXPECT]
        if bad:
            fails.append('download.html 的 APK 直链版本异常：%r（应为 %s ×%d）' % (bad, APK_EXPECT, len(hits)))
        print('  ✔ download.html APK 直链 %d 处，全部仍指向 %s' % (len(hits), APK_EXPECT))

    # ── 4. 全量复验六处 ────────────────────────────────────────────────
    print('\n== 六处版本复验 ==')
    vj2 = json.loads(read(vj_p))
    idx2 = read(idx_p)
    sw2 = read(sw_p)
    checks = [
        ('version.json 顶层', vj2['version'] == NEW_WEB, vj2['version']),
        ('version.json apk', vj2['apk']['version'] == APK_EXPECT, vj2['apk']['version']),
        ('version.json apk.versionCode', vj2['apk']['versionCode'] == APK_VCODE, vj2['apk']['versionCode']),
        ('index.html APP_VERSION', ("var APP_VERSION = '%s';" % NEW_WEB) in idx2,
         next((l for l in idx2.split('\n') if 'APP_VERSION =' in l), '?')[:60]),
        ('sw.js CACHE', ("var CACHE = '%s';" % NEW_CACHE) in sw2,
         next((l for l in sw2.split('\n') if 'CACHE =' in l), '?')[:60]),
        ('download.html 兜底直链', all(h == APK_EXPECT for h in hits), ','.join(hits)),
    ]
    for name, good, val in checks:
        print('  %s %-28s %s' % ('✅' if good else '❌', name, val))
        if not good:
            fails.append('%s 不正确（%s）' % (name, val))

    # 不变量：noteEn 里不许留下上一个版本号当首条（防止重复追加）
    if vj2.get('noteEn') and not str(vj2['noteEn'][0]).startswith('v' + NEW_WEB):
        fails.append('noteEn 首条不是 v%s，可能是重复追加' % NEW_WEB)

    print()
    if fails:
        print('❌ 中止：')
        for x in fails:
            print('   - %s' % x)
        sys.exit(1)
    print('✅ v%s 发版号就位（网页线）。APK 保持 v%s —— 这是刻意不发包，不是漏改。' % (NEW_WEB, APK_EXPECT))


if __name__ == '__main__':
    main()
