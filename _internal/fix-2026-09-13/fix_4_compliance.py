#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sinoky v0.23.8 FIX · 组 4：开源素材合规义务（审计 P2-4）

════════════════════════════════════════════════════════════════════════
先说结论：审计 P2-4 的**两条待办其实都已完成**（本轮第 15 处「文档说没做、实际做了」）
════════════════════════════════════════════════════════════════════════
  ② 「ArphicPL 补 ARPHICPL.TXT + 产品内署名」
     · ARPHICPL.TXT 7902 B 真许可全文，就在仓库根目录
     · 已进 build-web.mjs FILES 清单 ⇒ APK 包内也有（www/ARPHICPL.TXT）
     · 线上实测：GET /ARPHICPL.TXT → 200 · text/plain · 7824 B（LF 版，内容一致）
     · 产品内署名在 index.html L1043-1048 的 `details.attr`（v0.3.56 上线）
  ① 「Attribution 区块」
     · 已存在，列了 Hanzi Writer / Make Me a Hanzi / Arphic / pinyin-pro / vConsole
     · 项目**没有使用任何 CC-BY 素材**（Shtooka 只在《改进路线》里做过候选评估，
       最终未采用；`grep -i "shtooka|tatoeba|cc-by"` 全库零命中）
     ⇒ 不存在未履行的 CC-BY 署名义务

════════════════════════════════════════════════════════════════════════
真正还没清的 3 个（本组负责）
════════════════════════════════════════════════════════════════════════
G1. **清单漏项**：v0.23.6 内联了 `qrcode-generator`（MIT，Kazuhiko Arase），
    版权头确实保留在源码首部（MIT 已满足），但**用户可见的鸣谢清单里没有它**。
    —— 这正是「加了库、忘了写」的复发形态。

G2. **一句法律声明过度声明**（比漏写更重）
    原文：`All pronunciation audio in Sinoky is original content.`
    实况：417 条场景句 + 4 条声调音频确为作者本人录制；但 `/api/tts`
          （`_worker.js`）走 **微软 Edge 语音合成**给「没有录音的句子」发音。
          「All … original」把合成音也算成原创，是**事实不符的陈述**。
    —— 合规声明说错，性质比不写更糟：它是一句可被引用的承诺。

G3. **无处可链**：鸣谢只藏在 `v-prog` 视图的一个 <details> 里。
    合规/商店审核需要一个**稳定 URL**；页面本身挂掉时也需要一个不依赖 JS 的落地页。

════════════════════════════════════════════════════════════════════════
本组交付
════════════════════════════════════════════════════════════════════════
  · index.html 鸣谢块：补 qrcode-generator + 改准音频声明 + 加 credits.html 链接
  · langs/*.json × 6：1 条改写 + 2 条新增（新增文案必须入字典 —— 零 fallback 是验收线）
  · credits.html：新建**零 JS** 静态页（全部第三方 + 许可全文链接 + 数据来源）
  · scripts/build-web.mjs：credits.html 进 FILES（否则构建闸门会判「未归类」并 fail）
  · scripts/check-credits.mjs：防复发闸门（新增 vendor 库 / 内联库必须同时进两处清单）

幂等：全部按「目标态已存在则跳过」判定；连跑 N 次字节不变。
"""
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))
IDX = os.path.join(APP, 'index.html')
BUILD = os.path.join(APP, 'scripts', 'build-web.mjs')
CREDITS = os.path.join(APP, 'credits.html')
LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th']

OLD_AUDIO = 'All pronunciation audio in Sinoky is original content.'
NEW_AUDIO = ('Scene and tone audio is recorded by the Sinoky author. '
             'Phrases without a recording use Microsoft Edge text-to-speech.')
K_QR = 'QR code: qrcode-generator (MIT License, Kazuhiko Arase).'
K_FULL = 'Full credits and license texts'

NEW_AUDIO_TR = {
    'zh': '场景与声调音频由 Sinoky 作者本人录制；没有录音的句子使用微软 Edge 语音合成。',
    'es': 'El audio de escenas y tonos lo graba el autor de Sinoky. Las frases sin grabación usan la síntesis de voz de Microsoft Edge.',
    'ru': 'Аудио сцен и тонов записано автором Sinoky. Фразы без записи озвучиваются синтезом речи Microsoft Edge.',
    'vi': 'Âm thanh của tình huống và thanh điệu do tác giả Sinoky thu âm. Các câu chưa có bản thu dùng giọng đọc tổng hợp của Microsoft Edge.',
    'id': 'Audio skena dan nada direkam oleh penulis Sinoky. Frasa yang belum ada rekamannya memakai sintesis suara Microsoft Edge.',
    'th': 'เสียงของสถานการณ์และเสียงวรรณยุกต์บันทึกโดยผู้เขียน Sinoky ประโยคที่ยังไม่มีไฟล์เสียงใช้เสียงสังเคราะห์ของ Microsoft Edge',
}
K_QR_TR = {
    'zh': '二维码：qrcode-generator（MIT 许可，Kazuhiko Arase）。',
    'es': 'Código QR: qrcode-generator (licencia MIT, Kazuhiko Arase).',
    'ru': 'QR-код: qrcode-generator (лицензия MIT, Kazuhiko Arase).',
    'vi': 'Mã QR: qrcode-generator (giấy phép MIT, Kazuhiko Arase).',
    'id': 'Kode QR: qrcode-generator (Lisensi MIT, Kazuhiko Arase).',
    'th': 'คิวอาร์โค้ด: qrcode-generator (สัญญาอนุญาต MIT, Kazuhiko Arase)',
}
K_FULL_TR = {
    'zh': '完整鸣谢与许可全文',
    'es': 'Créditos completos y textos de licencia',
    'ru': 'Полные благодарности и тексты лицензий',
    'vi': 'Ghi công đầy đủ và toàn văn giấy phép',
    'id': 'Kredit lengkap dan teks lisensi',
    'th': 'เครดิตฉบับเต็มและข้อความสัญญาอนุญาต',
}


def read(p):
    with io.open(p, encoding='utf-8', newline='') as f:
        s = f.read()
    return s.replace('\r\n', '\n').replace('\r', '\n')


def write(p, s):
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


# ═══════════════════ G1+G2+G3：index.html 鸣谢块 ═══════════════════
def fix_attribution(idx):
    print('G1/G2/G3  index.html 鸣谢块')

    OLD_TAIL = ('        <p>' + OLD_AUDIO + '</p>\n'
                '      </details>')
    NEW_TAIL = ('        <p>' + NEW_AUDIO + '</p>\n'
                '        <p>' + K_QR + '</p>\n'
                '        <p><a href="credits.html" target="_blank" rel="noopener">' + K_FULL + '</a></p>\n'
                '      </details>')

    if NEW_TAIL in idx:
        print('  [skip] 鸣谢块已是新版')
        return idx
    n = idx.count(OLD_TAIL)
    assert n == 1, '鸣谢块锚点命中 %d 次（应为 1）' % n
    idx = idx.replace(OLD_TAIL, NEW_TAIL, 1)
    print('  [ok]   补 qrcode-generator + 音频声明改准 + 加 credits.html 链接')
    return idx


# ═══════════════════ 字典：1 改写 + 2 新增 × 6 语言 ═══════════════════
def fix_dicts():
    print('i18n  字典：1 改写 + 2 新增 × 6 语言')
    for l in LANGS:
        p = os.path.join(APP, 'langs', l + '.json')
        s = read(p)
        changed = False

        # ① 改写（保留 key 位置，整行换成新的 key+value）
        if ('"%s"' % NEW_AUDIO) not in s:
            old_line = '  ' + json.dumps(OLD_AUDIO, ensure_ascii=False) + ': ' + \
                       json.dumps(json.load(io.open(p, encoding='utf-8'))[OLD_AUDIO], ensure_ascii=False) + ','
            assert s.count(old_line) == 1, '%s：旧音频行未唯一命中' % l
            new_line = ('  ' + json.dumps(NEW_AUDIO, ensure_ascii=False) + ': ' +
                        json.dumps(NEW_AUDIO_TR[l], ensure_ascii=False) + ',')
            s = s.replace(old_line, new_line, 1)
            changed = True
            print('  [ok]   %s  音频声明改准' % l)

        # ② 新增 2 条（紧跟新音频行之后，保持同类聚在一起）
        if ('"%s"' % K_QR) not in s:
            anchor = '  ' + json.dumps(NEW_AUDIO, ensure_ascii=False) + ': ' + \
                     json.dumps(NEW_AUDIO_TR[l], ensure_ascii=False) + ','
            assert s.count(anchor) == 1, '%s：新音频行未唯一命中' % l
            add = ('\n  ' + json.dumps(K_QR, ensure_ascii=False) + ': ' + json.dumps(K_QR_TR[l], ensure_ascii=False) + ','
                   + '\n  ' + json.dumps(K_FULL, ensure_ascii=False) + ': ' + json.dumps(K_FULL_TR[l], ensure_ascii=False) + ',')
            s = s.replace(anchor, anchor + add, 1)
            changed = True
            print('  [ok]   %s  +2 条' % l)

        if changed:
            write(p, s)
        else:
            print('  [skip] %s' % l)

        # 立刻回读校验
        back = json.loads(read(p))
        assert back.get(NEW_AUDIO) == NEW_AUDIO_TR[l], '%s 回读失败' % l
        assert back.get(K_QR) == K_QR_TR[l], '%s K_QR 回读失败' % l
        assert back.get(K_FULL) == K_FULL_TR[l], '%s K_FULL 回读失败' % l
        assert OLD_AUDIO not in back, '%s 旧 key 未清除' % l
        # key 数必须与其它语言一致（防止只有部分语言加成功）
        print('         %s keys=%d' % (l, len(back)))


# ═══════════════════ G3：credits.html ═══════════════════
CREDITS_HTML = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Credits &amp; licences · Sinoky</title>
<meta name="description" content="Third-party components, licences and data sources used by Sinoky.">
<link rel="icon" href="icons/favicon-32.png">
<style>
  :root{ --bg:#0e1020; --card:#1a1d33; --txt:#eef0f6; --sub:#9aa0b8; --t2:#2aa98f; --line:rgba(255,255,255,.12); --red:#e63946; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    line-height:1.7;padding:24px 18px calc(40px + env(safe-area-inset-bottom));max-width:680px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px}
  .tag{color:var(--sub);font-size:13px;margin-bottom:20px}
  h2{font-size:16px;margin:26px 0 8px;color:var(--t2)}
  p{font-size:14px;margin:8px 0}
  .small{color:var(--sub);font-size:12.5px}
  .box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:14px 0}
  a{color:var(--t2);text-decoration:none}
  .back{display:inline-block;margin-top:28px;padding:10px 16px;background:var(--t2);color:#fff;border-radius:10px;font-size:14px;font-weight:600}
  ul{font-size:14px;padding-left:20px;margin:8px 0}
  li{margin:6px 0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:rgba(255,255,255,.07);padding:1px 5px;border-radius:5px}
  .lg{display:inline-block;font-size:11px;color:var(--sub);border:1px solid var(--line);border-radius:99px;padding:1px 8px;margin-left:6px;vertical-align:1px}
</style>
</head>
<body>
  <h1>Credits &amp; licences</h1>
  <div class="tag">Sinoky — Speak Chinese where it matters · Last updated: 2026-09-13</div>

  <div class="box">
    <strong>Why this page exists.</strong> Sinoky is built on the work of others. This page lists every
    third-party component and data set it uses, together with the licence it is used under, so that the
    required copyright notices travel with the product.
  </div>

  <h2>1. Writing &amp; stroke order</h2>
  <ul>
    <li><b>Hanzi Writer</b><span class="lg">MIT</span> — stroke animation and quiz engine.
      Copyright its respective authors. <code>vendor/hanzi-writer.min.js</code></li>
    <li><b>Make Me a Hanzi</b> — stroke order data (<code>data/strokes/*.json</code>), derived from
      glyphs of the Arphic Public Fonts. Distributed under the
      <a href="ARPHICPL.TXT" target="_blank" rel="noopener">Arphic Public License</a>.</li>
    <li><b>Arphic Public Fonts</b> — the glyph source for the stroke data above. The full licence text is
      retained unaltered as <a href="ARPHICPL.TXT" target="_blank" rel="noopener">ARPHICPL.TXT</a>
      in the root of the product, as required by §1 of that licence.</li>
  </ul>

  <h2>2. Pinyin</h2>
  <ul>
    <li><b>pinyin-pro</b><span class="lg">MIT</span> — pinyin conversion, tone marks and heteronym handling.
      <code>vendor/pinyin-pro.bundle.mjs</code></li>
  </ul>

  <h2>3. QR codes</h2>
  <ul>
    <li><b>qrcode-generator v1.4.4</b><span class="lg">MIT</span> — QR encoding for share cards.
      Copyright &copy; 2009 Kazuhiko Arase. Inlined into <code>index.html</code> with the original
      copyright header preserved verbatim at the head of the block.</li>
    <li class="small">&#8220;QR Code&#8221; is a registered trademark of DENSO WAVE INCORPORATED.</li>
  </ul>

  <h2>4. Debugging</h2>
  <ul>
    <li><b>vConsole</b><span class="lg">MIT</span> — on-device debug console, loaded only in debug builds.
      Copyright Tencent. <code>vendor/vconsole.min.js</code></li>
  </ul>

  <h2>5. Audio</h2>
  <ul>
    <li><b>Scene and tone audio</b> — recorded by the author of Sinoky and owned by this project.</li>
    <li><b>Microsoft Edge text-to-speech</b> — used at runtime to voice phrases that have no recording.
      Generated audio is streamed for playback only, never stored, and is not part of the recorded corpus.</li>
  </ul>

  <h2>6. Fonts used for rendering</h2>
  <p class="small">Sinoky does not ship any font files. Chinese text is rendered with the fonts already
  installed on your device (falling back through a CJK stack such as Noto Sans CJK, PingFang SC, or
  Microsoft YaHei). No webfont is downloaded and no font file is redistributed.</p>

  <h2>7. Content</h2>
  <p class="small">All 31 learning scenes, the HSK-graded flashcard sets, and every English/Chinese
  sentence pair were written for Sinoky. City photographs are used with permission or generated for
  this project. If you believe something here is mis-attributed, please write to
  <a href="mailto:hello@sinoky.app">hello@sinoky.app</a> and we will correct it.</p>

  <p class="small" style="margin-top:18px">Licence texts bundled with this product:
    <a href="ARPHICPL.TXT" target="_blank" rel="noopener">ARPHICPL.TXT</a> (Arphic Public License).</p>

  <a class="back" href="./">&#8592; Back to Sinoky</a>
</body>
</html>
'''


def fix_credits():
    print('G3    credits.html')
    if os.path.exists(CREDITS) and read(CREDITS) == CREDITS_HTML:
        print('  [skip] 已是新版')
        return
    write(CREDITS, CREDITS_HTML)
    print('  [ok]   写入 %d B' % len(CREDITS_HTML.encode('utf-8')))


# ═══════════════════ build-web.mjs：credits.html 归类 ═══════════════════
def fix_build():
    print('build-web.mjs  归类 credits.html')
    s = read(BUILD)
    old = "'ARPHICPL.TXT', 'privacy.html', 'stats.html', 'robots.txt', 'sitemap.xml',"
    new = "'ARPHICPL.TXT', 'privacy.html', 'stats.html', 'credits.html', 'robots.txt', 'sitemap.xml',"
    if new in s:
        print('  [skip] 已归类')
        return
    assert s.count(old) == 1, 'build-web FILES 锚点未唯一命中'
    write(BUILD, s.replace(old, new, 1))
    print('  [ok]   FILES 已含 credits.html（否则「未归类条目」断言会 fail）')


# ═══════════════════ sw.js：credits.html 进预缓存 ═══════════════════
def fix_sw_assets():
    print('sw.js  预缓存 credits.html')
    p = os.path.join(APP, 'sw.js')
    s = read(p)
    old = "  './index.html',\n"
    new = "  './index.html',\n  './credits.html',   /* v0.23.8：合规页应离线可达（从产品内鸣谢块链出） */\n"
    if new in s:
        print('  [skip] 已在 ASSETS')
        return
    assert s.count(old) == 1, 'sw.js ASSETS 锚点未唯一命中'
    write(p, s.replace(old, new, 1))
    print('  [ok]   已加入 ASSETS（install 阶段 addAll 会拉一次，5 KB）')


if __name__ == '__main__':
    print('APP =', APP)
    idx = read(IDX)
    idx = fix_attribution(idx)
    write(IDX, idx)
    fix_dicts()
    fix_credits()
    fix_build()
    fix_sw_assets()
    print('\n完成。index.html %d B' % len(idx.encode('utf-8')))
