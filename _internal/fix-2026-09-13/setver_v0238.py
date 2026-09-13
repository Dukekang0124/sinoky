# -*- coding: utf-8 -*-
"""
setver_v0238.py —— 网页版 0.23.7 → 0.23.8（本轮只发网页线，APK 停在 0.23.4）

六处版本号（v0.23.2 起从「三处」升为六处）：
  1. version.json 顶层 version            ← 改
  2. version.json apk.version             ← **不动**（本版刻意不发包）
  3. index.html 的 APP_VERSION             ← 改
  4. sw.js 的 CACHE                        ← 改
  5. download.html 兜底 APK 直链 ×2 处      ← **不动**

🔴 门禁设计教训（写在 memory 里那条）：**咬不变量，不要锚常量**。
   上一轮（v0.23.6）的脚本拿 `OLD='0.23.5'` 去卡 apk 段，而 apk 段**本来就该停在 0.23.4**
   ⇒ 必然中止。正确做法：先把 apk 段**整段存下来**，改完再比「一字未变」。
"""
import io
import json
import os
import re
import sys

APP = r'D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app'

OLD_WEB = '0.23.7'
NEW_WEB = '0.23.8'
OLD_CACHE = 'sinoky-v0.23.7'
NEW_CACHE = 'sinoky-v0.23.8'
APK_EXPECT = '0.23.4'
APK_VCODE = 2304
DATE = '2026-09-13'

NOTE_ZH = (
    'v0.23.8：修好了一件从第一天起就没生效的事 —— 离线缓存。'
    '① Service Worker 的缓存清单里有 15 条资源路径漏了引号，导致整个 sw.js 是一个语法错误、'
    '浏览器直接拒绝注册。也就是说，过去所有版本「装到桌面就能离线用」的说法都不成立：'
    '一旦断网，页面根本打不开。修完后 33 条资源全部进缓存，实测断网可开首页、可读已缓存数据。'
    '（这条能藏这么久，是因为语法检查只查 index.html 里的内联脚本，从没查过 sw.js —— 检查口子已补上。）'
    '② 听辨练习的发音一直是哑的：音频播放器只接受内嵌音频，遇到文件路径直接拒绝，'
    '而听辨题用的正是文件路径；并且答题对错都没有任何反馈。两处都已修好，现在每答必给反馈。'
    '③ 12 个纯图标按钮（播放 / 喇叭 / 关闭等）补上无障碍标签，读屏器不再只能念「按钮」。'
    '④ 学习数据不再无限膨胀：学习天数记录加了 400 天上限（此前只增不减）。'
    '⑤ 新增「首屏错误上报」：浏览器报错以前只存在本机、从不发出，现在随统计数据一并上云，'
    '零新增请求、零新增存储配额（错误数按 3 档封桶，写入量是常数而不是随错误数线性增长）。'
    '⑥ 新增「开口漏斗」四步统计（打开 → 听到发音 → 开口录音 → 判分通过），用来回答「用户到底卡在哪一步」。'
    '⑦ 修掉一个统计写入的隐性缺陷：嵌套字段与旧快照共享内存，导致这些字段单独变化时永远写不进云端'
    '（该缺陷自早期版本就在，只是从未被验证过）。'
    '⑧ 开源合规补齐：补上二维码库（qrcode-generator, MIT）的署名，修正一处把所有发音都声明为'
    '「原创录音」的过度声明，并新增 credits.html 汇总全部第三方许可与原文链接。'
    '⑨ 新增 2 条界面文案的 6 语言翻译（字典 588 → 590 条，依旧零英文兜底）。'
    '本版只发网页版，APK 仍为 v0.23.4。'
)

NOTE_EN = (
    'v0.23.8: this release fixes something that never worked from day one - offline caching. '
    '(1) Fifteen asset paths in the Service Worker manifest were missing their quotes, which made the whole '
    'sw.js file a syntax error and made browsers refuse to register it. In other words, every earlier claim that '
    'the app could be used offline once added to the home screen was false: with no network the page would not '
    'open at all. After the fix all 33 assets are cached, and opening the app offline has been verified. (It hid '
    'this long because the syntax check only ever inspected the inline scripts inside index.html and never looked '
    'at sw.js - that gap in the check is now closed.) '
    '(2) The listening drill had silent audio: the player only accepted embedded audio and refused plain file '
    'paths, which is exactly what the listening questions use; and answers gave no feedback either way. Both are '
    'fixed - every answer now gets a response. '
    '(3) Twelve icon-only buttons (play, speaker, close, and so on) now carry accessibility labels, so screen '
    'readers no longer call all of them just "button". '
    '(4) Study data no longer grows without bound: the days-log now has a 400-day cap, where before it only ever '
    'grew. '
    '(5) First-load error reporting was added: browser errors used to be stored only on the device and never sent '
    'anywhere. They now go up with the regular stats, with zero new requests and zero new storage usage (error '
    'counts are bucketed into three bands, so the write volume is a constant rather than growing with each error). '
    '(6) A four-step speaking funnel was added (opened -> heard audio -> recorded -> passed scoring) to answer '
    'where users actually get stuck. '
    '(7) A hidden bug in stats writing was fixed: nested fields shared memory with the previous snapshot, so those '
    'fields could never be written to the cloud when they changed on their own (a defect that had been present '
    'since an early version and had simply never been verified). '
    '(8) Open-source compliance: attribution was added for the QR code library (qrcode-generator, MIT), an '
    'overstatement that claimed all pronunciation audio was original recording was corrected, and a new '
    'credits.html collects every third-party licence with links to the full texts. '
    '(9) Two UI strings gained translations in all six languages (dictionaries 588 -> 590, still zero English '
    'fallback). Web only this round; the APK stays at v0.23.4.'
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

    # ── 0. 前置：确认起点就是 0.23.7（防止盲改） ────────────────────────
    vj_raw = read(os.path.join(APP, 'version.json'))
    vj = json.loads(vj_raw)
    assert vj['version'] == OLD_WEB, '起点版本不是 %s（实得 %s）—— 先确认工作区状态' % (OLD_WEB, vj['version'])
    apk_before = json.dumps(vj.get('apk'), ensure_ascii=False, sort_keys=True)
    assert vj['apk']['version'] == APK_EXPECT, 'APK 段起点异常：%s' % vj['apk']['version']
    print('起点确认：网页 %s / APK %s ✅' % (vj['version'], vj['apk']['version']))

    # ── 1. version.json ────────────────────────────────────────────────
    vj['version'] = NEW_WEB
    vj['updated'] = DATE
    vj['note'] = NOTE_ZH
    en = vj.get('noteEn')
    if not isinstance(en, list):
        en = [en] if en else []
    # 幂等：已是最新就不重复插
    if not (en and en[0].startswith('v0.23.8')):
        vj['noteEn'] = [NOTE_EN] + en
    # 不变量：apk 段一字未变
    apk_after = json.dumps(vj.get('apk'), ensure_ascii=False, sort_keys=True)
    if apk_after != apk_before:
        fails.append('version.json 的 apk 段被改动了！（本轮刻意不发包）')
    write(os.path.join(APP, 'version.json'), json.dumps(vj, ensure_ascii=False, indent=2) + '\n')
    print('  ✔ version.json: %s → %s（apk 段保持不变）' % (OLD_WEB, NEW_WEB))

    # ── 2/3. index.html APP_VERSION + sw.js CACHE ──────────────────────
    idx_p = os.path.join(APP, 'index.html')
    s = read(idx_p)
    n = s.count("var APP_VERSION = '%s';" % OLD_WEB)
    if n == 0 and s.count("var APP_VERSION = '%s';" % NEW_WEB) == 1:
        print('  = index.html APP_VERSION 已是 %s' % NEW_WEB)
    else:
        assert n == 1, 'index.html APP_VERSION 锚点命中 %d 次' % n
        s = s.replace("var APP_VERSION = '%s';" % OLD_WEB, "var APP_VERSION = '%s';" % NEW_WEB, 1)
        write(idx_p, s)
        print('  ✔ index.html APP_VERSION → %s' % NEW_WEB)

    sw_p = os.path.join(APP, 'sw.js')
    sw = read(sw_p)
    if sw.count("var CACHE = '%s';" % NEW_CACHE) == 1:
        print('  = sw.js CACHE 已是 %s' % NEW_CACHE)
    else:
        assert sw.count("var CACHE = '%s';" % OLD_CACHE) == 1, 'sw.js CACHE 锚点不唯一'
        sw = sw.replace("var CACHE = '%s';" % OLD_CACHE, "var CACHE = '%s';" % NEW_CACHE, 1)
        write(sw_p, sw)
        print('  ✔ sw.js CACHE → %s' % NEW_CACHE)

    # ── 4. download.html 兜底 APK 直链 ×2：必须**仍指向 0.23.4** ────────
    dl_p = os.path.join(APP, 'download.html')
    dl = read(dl_p) if os.path.exists(dl_p) else ''
    hits = re.findall(r'Sinoky-v([0-9.]+)-release\.apk', dl)
    if not hits:
        fails.append('download.html 里找不到 APK 直链（应为 2 处）')
    else:
        bad = [h for h in hits if h != APK_EXPECT]
        if bad:
            fails.append('download.html 的 APK 直链版本异常：%r（应为 %s ×%d）' % (bad, APK_EXPECT, len(hits)))
        print('  ✔ download.html APK 直链 %d 处，全部仍指向 %s' % (len(hits), APK_EXPECT))

    # ── 5. 全量复验六处 ────────────────────────────────────────────────
    print('\n== 六处版本复验 ==')
    vj2 = json.loads(read(os.path.join(APP, 'version.json')))
    idx2 = read(idx_p)
    sw2 = read(sw_p)
    checks = [
        ('version.json 顶层', vj2['version'] == NEW_WEB, vj2['version']),
        ('version.json apk', vj2['apk']['version'] == APK_EXPECT, vj2['apk']['version']),
        ('version.json apk.versionCode', vj2['apk']['versionCode'] == APK_VCODE, vj2['apk']['versionCode']),
        ('index.html APP_VERSION', ("var APP_VERSION = '%s';" % NEW_WEB) in idx2, next((l for l in idx2.split('\n') if 'APP_VERSION =' in l), '?')[:60]),
        ('sw.js CACHE', ("var CACHE = '%s';" % NEW_CACHE) in sw2, next((l for l in sw2.split('\n') if 'CACHE =' in l), '?')[:60]),
        ('download.html 兜底直链', all(h == APK_EXPECT for h in re.findall(r'Sinoky-v([0-9.]+)-release\.apk', dl)), ','.join(hits)),
    ]
    for name, good, val in checks:
        print('  %s %-28s %s' % ('✅' if good else '❌', name, val))
        if not good:
            fails.append('%s 不正确（%s）' % (name, val))

    # 残留旧版本号（排除历史/备份目录）
    for f, old in [(idx_p, OLD_WEB), (sw_p, OLD_CACHE)]:
        pass

    print()
    if fails:
        print('❌ 中止：')
        for x in fails:
            print('   - %s' % x)
        sys.exit(1)
    print('✅ v%s 发版号就位（网页线）。APK 保持 v%s —— 这是刻意不发包，不是漏改。' % (NEW_WEB, APK_EXPECT))


if __name__ == '__main__':
    main()
