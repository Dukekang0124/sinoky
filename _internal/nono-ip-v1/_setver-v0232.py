#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v0.23.2 版本号同步 + 元数据重写。

为什么不用 json.dump：会把 noteEn 的缩进重排、把中文转成 \\uXXXX，产生整文件无意义 diff。
所以 version.json 走**文本级逐行精确替换**，并断言每处命中恰 1 次。

同步清单（Sinoky 只有这四处是"版本号真相"）：
  ① sinoky-app/index.html      var APP_VERSION
  ② sinoky-app/version.json    顶层 version + note + noteEn[0]
  ③ sinoky-app/sw.js           var CACHE
  ④ sinoky-app/download.html   两处兜底 APK 链接
外加两处「验收脚本口径」（不是产品版本号，但不改就会误报）：
  ⑤ _internal/nono-ip-v1/verify-nono-ip.py   EXPECT_VER
  ⑥ 05-…/_work/_ci/verify-live.mjs           APK_V / APK_SIZE / APK_MD5 / PREV_V

⚠️ apk 段（4 空格缩进的 "version"）**不动** —— 它由 apk.yml 在出包时回填，代表已发布 APK 版本。
   顶层 version 是 2 空格缩进，精确匹配不会误伤。

用法：python _setver-v0232.py [--check]
"""
import os
import sys

OLD, NEW = '0.23.1', '0.23.2'
OLD_CODE, NEW_CODE = 2301, 2302

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))              # sinoky-app
ROOT = os.path.dirname(REPO)                               # Sinoky
VJ = os.path.join(REPO, 'version.json')

NOTE = (
    'v0.23.2：桌面图标改品牌红字标 + 启动屏补漏字 + 首启引导换诺诺 + 品牌红统一。'
    '① 桌面图标（PWA icons/icon-192.png · icon-512.webp + APK apk-icons/* 全 5 密度）'
    '全部改为品牌设计的红字标（深青黑 #141a24 底 + 朱砂红 #e63946 钥匙几何标），'
    'icon-192.png 与品牌源 sinoky-图标-192.png 逐字节一致（4,989 B）—— '
    '品牌设计是红线，图标位不再放吉祥物。'
    '② 启动屏品牌文字漏字修复：#splash 原为「Sino<b>k</b>」只渲染成 Sinok，'
    '补回末尾 y ⇒ 现在正确显示 Sinoky（k 仍按品牌红高亮）。'
    '③ 首启引导 assets/onboard/ 5 张原是人类男性插画（画风混用），'
    '全部替换为诺诺熊猫姿态（wave/point/listen/cheer/like，取自同一批 3D 定妆 ⇒ 画风统一）；'
    'step1~4 改用 1:1 方图，在 96px 显示下主体可见尺寸提升约 33%。'
    '④ 品牌红统一：字标 #e63946 与界面 --red #c2362b 两种红混用，'
    '现全部统一为更鲜艳的 #e63946（含 41 处半透明 rgba、渐变配套色、'
    'HanziWriter 笔顺 strokeColor、分享卡 Canvas 色）。'
    '吉祥物诺诺（熊猫）作为中文学习陪伴者，继续在产品内各场景出现。网页版 v0.23.2。'
)

NOTE_EN = (
    'v0.23.2: desktop icons move to the brand red wordmark, the splash wordmark gets its missing letter back, '
    'the onboarding art switches to Nono, and the two brand reds are unified. '
    '(1) The desktop icons - PWA icon-192.png / icon-512.webp and all five Android densities under apk-icons/ - '
    'now use the brand-design red wordmark (deep ink tile #141a24 with the cinnabar #e63946 key glyph), '
    'byte-identical to the brand source. The brand mark is a hard rule: the icon slot no longer carries the mascot. '
    '(2) The splash wordmark was rendered as \'Sinok\' because the markup read Sino<b>k</b>; the trailing y is restored, '
    'so it now reads \'Sinoky\' with the k still highlighted. '
    '(3) The five onboarding illustrations were human-male artwork in two mixed styles; they are replaced with Nono panda poses '
    '(wave / point / listen / cheer / like) drawn from the same 3D asset set, so the art style is now consistent - '
    'and the four step tiles are square, so at their 96px display size the subject is about a third larger. '
    '(4) The two brand reds - the wordmark #e63946 and the UI --red #c2362b - are unified to the brighter #e63946, '
    'covering 41 translucent rgba usages, the gradient companions, the HanziWriter stroke colour and the share-card canvas colour. '
    'Nono the panda remains the in-app Chinese-learning companion. Web build v0.23.2.'
)

# ---------- ⑤⑥ 验收脚本口径（旧值 → 新值）----------
PY = os.path.join(HERE, 'verify-nono-ip.py')
LIVE = os.path.join(ROOT, '05-产品视觉素材', '2026-09-12-诺诺卫衣定妆', '_work', '_ci', 'verify-live.mjs')


def patch_version_json(check: bool) -> list:
    raw = open(VJ, 'rb').read()
    lines = raw.split(b'\r\n')
    hit = {'ver': 0, 'note': 0, 'noteEn': 0}

    for i, ln in enumerate(lines):
        if ln == b'  "version": "%s",' % OLD.encode():
            lines[i] = ('  "version": "%s",' % NEW).encode('utf-8')
            hit['ver'] += 1
        elif ln.startswith(b'  "note": "'):
            lines[i] = ('  "note": "%s",' % NOTE).encode('utf-8')
            hit['note'] += 1
        elif ln.strip().startswith(b'"v%s:' % OLD.encode()):
            lines[i] = ('    "%s",' % NOTE_EN).encode('utf-8')
            hit['noteEn'] += 1

    if hit != {'ver': 1, 'note': 1, 'noteEn': 1}:
        raise SystemExit('✗ version.json 替换命中数异常 %r' % hit)

    out = b'\r\n'.join(lines)
    bare = out.count(b'\n') - out.count(b'\r\n')
    if bare:
        raise SystemExit('✗ 行尾被破坏：%d 个裸 LF' % bare)
    # 文本级替换最怕把 JSON 结构搞坏 —— 写盘前必须能 parse，且关键字段对得上
    import json as _json
    try:
        j = _json.loads(out.decode('utf-8'))
    except Exception as e:
        raise SystemExit('✗ 替换后 JSON 非法：%s' % e)
    if j.get('version') != NEW:
        raise SystemExit('✗ 替换后 version 异常：%r' % j.get('version'))
    if not j['note'].startswith('v%s' % NEW) or not j['noteEn'][0].startswith('v%s' % NEW):
        raise SystemExit('✗ note / noteEn[0] 未同步到 %s' % NEW)
    if j['apk']['version'] != OLD:
        raise SystemExit('✗ apk 段被误改（应保持 %s，由 CI 回填）' % OLD)
    if not check:
        open(VJ, 'wb').write(out)
    return ['version.json：version/note/noteEn[0] 各 1 处（CRLF %d，裸 LF 0，JSON 合法，apk 段未动）'
            % out.count(b'\r\n')]


def patch_text(path: str, rules, check: bool) -> list:
    if not os.path.exists(path):
        raise SystemExit('✗ 文件不存在 %s' % path)
    src = open(path, encoding='utf-8', newline='').read()
    out, log = src, []
    for old, new, want in rules:
        n = out.count(old)
        if n == 0 and out.count(new) >= 1:
            log.append('  · %s 已应用，跳过' % old[:44])
            continue
        if n != want:
            raise SystemExit('✗ %s 命中 %d 次（期望 %d）：%s' % (os.path.basename(path), n, want, old[:60]))
        out = out.replace(old, new)
        log.append('  ✓ %s ×%d' % (old[:52], n))
    if not check:
        open(path, 'w', encoding='utf-8', newline='').write(out)
    return log


def main() -> int:
    check = '--check' in sys.argv
    log = patch_version_json(check)

    log += patch_text(os.path.join(REPO, 'index.html'),
                      [("var APP_VERSION = '%s';" % OLD, "var APP_VERSION = '%s';" % NEW, 1)], check)
    log += patch_text(os.path.join(REPO, 'sw.js'),
                      [("var CACHE = 'sinoky-v%s';" % OLD, "var CACHE = 'sinoky-v%s';" % NEW, 1)], check)
    log += patch_text(os.path.join(REPO, 'download.html'),
                      [('Sinoky-v%s-release.apk' % OLD, 'Sinoky-v%s-release.apk' % NEW, 2)], check)
    log += patch_text(PY,
                      [('EXPECT_VER = "%s"' % OLD, 'EXPECT_VER = "%s"' % NEW, 1)], check)
    log += patch_text(LIVE,
                      [("const APK_V = '%s';" % OLD, "const APK_V = '%s';" % NEW, 1),
                       ("const PREV_V = '0.23.0';", "const PREV_V = '%s';" % OLD, 1)], check)

    print('\n'.join(log))
    print('\n%s' % ('校验通过（未写盘）' if check else '已写盘'))
    print('⚠️ APK 常量 APK_SIZE / APK_MD5 需等 v%s 出包后按实测填（届时另行更新 verify-live.mjs）' % NEW)
    return 0


if __name__ == '__main__':
    sys.exit(main())
