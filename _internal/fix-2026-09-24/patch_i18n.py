# -*- coding: utf-8 -*-
"""
patch_i18n.py —— v0.24.1 i18n 盲区补丁（幂等）

背景（2026-09-24 发版后体检 P0-2）：
  非英语用户在若干位置直接看到「英文」或「中文」硬编码文案，绕过 T()/字典：
    a) VIEW_HINT 消费点漏包 T()  → 9 条诺诺提示全不翻
    b) 限额芯片 3 条 + 声调纠错 2 组 + 引导卡整卡 + 注入段「诺诺带你认识」
  其中「字典 key 带 <b> 标签 vs applyI18n 取剥离标签的文本节点」是形状不匹配，
  即使有 key 也永久翻不上（新缺陷类别，详见 _internal/retired-assets-2026-09-24/README.md 同批记录）。

本脚本只做「包 T()」与「函数替换」，不改任何布局/样式/逻辑。
所有替换均断言命中数（expect），命中 0 或多余即报错退出 —— 幂等铁律：重跑安全。

用法：python _internal/fix-2026-09-24/patch_i18n.py
      python _internal/fix-2026-09-24/patch_i18n.py --dry-run
"""
import sys
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent.parent                      # sinoky-app/
SRC = APP / 'index.html'
DRY = '--dry-run' in sys.argv

text = SRC.read_text(encoding='utf-8')
before = text

# ---------------------------------------------------------------- 替换表
# (标签, old, new, 期望命中数)
EDITS = []

# ── M1/M2/M3：限额芯片（quotaBadge, L8118-8125）
EDITS.append((
    'M1 已解锁芯片',
    """    if(isUnlocked()) return '<span class="qt-chip unl">\u2705 \u5df2\u89e3\u9501 \u00b7 \u4e0d\u9650\u6b21\u6570</span>';""",
    """    if(isUnlocked()) return '<span class="qt-chip unl">'+T('\u2705 Unlocked \u00b7 unlimited')+'</span>';""",
    1,
))
EDITS.append((
    'M2 App 芯片（复用既有 key Install App \u00b7 Unlimited）',
    """    if(lim===0) return '<span class="qt-chip unl">\U0001F4F1 App \u00b7 \u4e0d\u9650\u6b21\u6570</span>';""",
    """    /* v0.24.1：'Install App \u00b7 Unlimited' 是既有字典 key（zh=\u88c5 App \u00b7 \u4e0d\u9650\u6b21\u6570），复用而不新增 */
    if(lim===0) return '<span class="qt-chip unl">\U0001F4F1 '+T('Install App \u00b7 Unlimited')+'</span>';""",
    1,
))
EDITS.append((
    'M3 剩余次数芯片（占位符模板，沿用项目 {city} 模式）',
    """    return '<span class="qt-chip '+(left<=0?'warn':'')+'">\u4eca\u5929\u8fd8\u5269 <b>'+left+'</b> \u6b21'+QLABEL[feat]+'</span>';""",
    """    /* v0.24.1：原实现把中文与英文标签直接拼在一起（\u4eca\u5929\u8fd8\u5269 3 \u6b21Nono chat）——
       中英语序相反，无法用前后缀拼接解决，故用占位符模板（与 L3622 {city} 同模式）。 */
    return '<span class="qt-chip '+(left<=0?'warn':'')+'">'+T('{n} {feat} left today').replace('{n}','<b>'+left+'</b>').replace('{feat}',T(QLABEL[feat]))+'</span>';""",
    1,
))

# ── M4/M6：声调纠错「应为」（两处调用点）
EDITS.append((
    'M4 应为（renderTone 内 x.tExp）',
    """        return '<span class="'+((x.score>=0.99)?'ok':'bad')+'">'+ (x.target||'') +(tb?'<i class="tone-err">\u5e94\u4e3a'+toneLabel(x.tExp)+'</i>':'') +'</span>'; }).join('') +'</div>' : '')+""",
    """        return '<span class="'+((x.score>=0.99)?'ok':'bad')+'">'+ (x.target||'') +(tb?'<i class="tone-err">'+T('should be')+toneKey(x.tExp)+'</i>':'') +'</span>'; }).join('') +'</div>' : '')+""",
    1,
))
EDITS.append((
    'M6 应为（score 面板内 s.tExp）',
    """    h += '<span class="ss '+(ok?'ok':'bad')+'">'+esc(s.target)+(tb?'<i class="tone-err">\u5e94\u4e3a'+toneLabel(s.tExp)+'</i>':'')+'</span>';""",
    """    h += '<span class="ss '+(ok?'ok':'bad')+'">'+esc(s.target)+(tb?'<i class="tone-err">'+T('should be')+toneKey(s.tExp)+'</i>':'')+'</span>';""",
    1,
))

# ── M5/M7：评分明细里硬编码的英文 'tone should be 1st (\u4e00\u58f0)'
EDITS.append((
    'M5 明细 tone should be（np-fix，ms）',
    """        if(f.toneOk===false) ms += ' \u00b7 tone should be '+toneLabelEn(f.tExp)+' ('+toneLabel(f.tExp)+')';""",
    """        if(f.toneOk===false) ms += T(' \u00b7 tone should be')+toneKey(f.tExp);""",
    1,
))
EDITS.append((
    'M7 明细 tone should be（score-fix，msgs）',
    """      if(f.toneOk===false) msgs += ' \\u00b7 tone should be '+toneLabelEn(f.tExp)+' ('+toneLabel(f.tExp)+')';""",
    """      if(f.toneOk===false) msgs += T(' \\u00b7 tone should be')+toneKey(f.tExp);""",
    1,
))

# ── M8：废弃 toneLabel / toneLabelEn 双函数，改为随语言切换的 toneKey
EDITS.append((
    'M8 toneLabel/toneLabelEn \u2192 toneKey',
    """function toneLabel(n){ return n===1?'\u4e00\u58f0':n===2?'\u4e8c\u58f0':n===3?'\u4e09\u58f0':n===4?'\u56db\u58f0':'\u8f7b\u58f0'; }
function toneLabelEn(n){ return n===1?'1st':n===2?'2nd':n===3?'3rd':n===4?'4th':'neutral'; }""",
    """/* v0.24.1\uff1a\u539f toneLabel()\uff08\u4e2d\u6587\uff09/ toneLabelEn()\uff08\u82f1\u6587\uff09\u53cc\u51fd\u6570\u5e9f\u5f03\u2014\u2014
   \u58f0\u8c03\u540d\u6539\u4e3a\u5b57\u5178 key\uff0c\u968f\u754c\u9762\u8bed\u8a00\u5207\u6362\u3002
   \u65e7\u5b9e\u73b0\u8ba9\u897f/\u4fc4/\u8d8a/\u5370/\u6cf0\u7528\u6237\u770b\u5230 '1st' \u6216 '\u4e00\u58f0'\uff0c\u5c5e i18n \u76f2\u533a\u3002
   \u6ce8\uff1a\u8fd4\u56de\u503c\u5e26\u524d\u5bfc\u7a7a\u683c\uff0c\u4fbf\u4e8e\u4e0e 'should be' / '\u00b7 tone should be' \u76f4\u63a5\u62fc\u63a5\u3002 */
function toneKey(n){
  return ' ' + T({ '1':'1st tone', '2':'2nd tone', '3':'3rd tone', '4':'4th tone' }[n] || 'neutral tone');
}""",
    1,
))

# ── M9：VIEW_HINT 消费点漏包 T()（根因）
EDITS.append((
    'M9 VIEW_HINT 消费点包 T()',
    """          window.nonoHint(cfg.html, { pose: cfg.pose, once: 'vh_' + v, ms: 7000 });""",
    """          /* v0.24.1\uff1a\u539f\u7f3a T()\u3002\u5b57\u5178 key \u6309\u300c\u5e26\u6807\u7b7e\u6574\u4e32\u300d\u8bbe\u8ba1\uff08zh.json \u65e9\u5df2\u6709 3 \u6761\uff09\uff0c
             \u800c nonoHint \u5185\u90e8\u662f el.innerHTML = msg\uff0c\u6545 T() \u5165\u53c2\u4e0e innerHTML \u8f93\u5165\u5f62\u72b6\u4e00\u81f4\u3002 */
          window.nonoHint(T(cfg.html), { pose: cfg.pose, once: 'vh_' + v, ms: 7000 });""",
    1,
))

# ── M10/M11：注入段「诺诺带你认识」
EDITS.append((
    'M10 诺诺带你认识',
    """          '<div><b>\u8bfa\u8bfa\u5e26\u4f60\u8ba4\u8bc6</b>' +""",
    """          '<div><b>'+T('Nono will show you around')+'</b>' +""",
    1,
))
EDITS.append((
    'M11 注入段英文正文',
    """          '<span>I\\u2019m Nono \\uD83D\\uDC3C \\u2014 here are the three things that matter. ' +
          'Want the full map? Tap me any time.</span></div></div>';""",
    """          '<span>'+T('I\\u2019m Nono \\uD83D\\uDC3C \\u2014 here are the three things that matter. Want the full map? Tap me any time.')+'</span></div></div>';""",
    1,
))

# ── M12：tourHtml 整卡（8 段文本包 T()）
TOUR_OLD = """  return '<div class="card"><div class="top"><h2>\\u{1F44B} New here?</h2><span class="badge teal">60 SECONDS</span></div>'+
    '<p class="desc">Three steps \\u2014 that is the whole app:</p>'+
    '<div class="tour-steps"><div><b>New to Chinese?</b> Characters do not tell you how to say them \\u2014 that is what the small letters above them are for (pinyin: <b>n\\u01D0 h\\u01CEo</b>). The little marks are tones: \\u0101 \\u00E1 \\u01CE \\u00E0 \\u2014 four tones, four different words. Tap \\u25B6 to hear any line; tap \U0001F422 to slow it down \u2014 tap again for slower (0.5\u00D7, best for hearing the tones).</div></div>'+
    '<div class="tour-steps">'+
    '<div>1\\uFE0F\\u20E3 Tap a line below \\u2192 listen, cover the Chinese, <b>say it out loud 3\\u00D7</b>. Speaking is the whole point.</div>'+
    '<div>2\\uFE0F\\u20E3 Do one <b>Day</b> card a day \\u2014 the streak keeps you coming back.</div>'+
    '<div>3\\uFE0F\\u20E3 Open <b>Tones</b> for 1 minute \\u2014 train your ear: four tones, four different words.</div>'+
    '<div>4\\uFE0F\\u20E3 Want to <b>write</b> characters too? Open <b>Cards</b> \\u2192 tap \\u270D\\uFE0F <b>Strokes</b> \\u2014 watch the stroke order, then trace it yourself.</div>'+
    '</div>'+
    '<p class="desc" style="font-size:11.5px;color:var(--sub);margin:10px 0 0">\\u{1F512} Recordings are never saved \\u00B7 \\u{1F4AC} Feedback (bottom-left) any time</p>'+
    '<button class="btn primary" onclick="endTour()">Got it \\u2014 let\\'s speak</button></div>';"""

TOUR_NEW = """  /* v0.24.1\uff1a\u6574\u5361\u6587\u6848\u8d70 T()\uff08key = \u542b\u6807\u7b7e\u6574\u4e32\uff0c\u4e0e VIEW_HINT \u540c\u5f62\u72b6\uff09\u3002
     \u672c\u5361\u53ea\u5bf9\u300c\u96f6\u8fdb\u5ea6\u65b0\u7528\u6237\u300d\u51fa\u73b0\u4e00\u6b21\uff1bT() \u5728\u6e32\u67d3\u65f6\u6c42\u503c\uff0c
     \u5207\u8bed\u8a00\u540e\u56de\u5230 home \u4f1a\u91cd\u65b0\u6e32\u67d3\uff08renderHome \u2192 tourHtml\uff09\uff0c\u6545\u65e0\u9700\u989d\u5916 re-render \u94a9\u5b50\u3002
     \u6559\u5b66\u6f14\u793a\u90e8\u5206\uff08\u62fc\u97f3 n\u01d0 h\u01ceo\u3001\u58f0\u8c03\u7b26\u53f7 \u0101 \u00e1 \u01ce \u00e0\u3001\u53ef\u70b9\u51fb\u56fe\u6807\uff09\u4e0d\u8bd1\uff0c\u5404\u8bed\u8a00\u8bd1\u6587\u4e2d\u539f\u6837\u4fdd\u7559\u3002 */
  return '<div class="card"><div class="top"><h2>'+T('\\u{1F44B} New here?')+'</h2><span class="badge teal">'+T('60 SECONDS')+'</span></div>'+
    '<p class="desc">'+T('Three steps \\u2014 that is the whole app:')+'</p>'+
    '<div class="tour-steps"><div>'+T('<b>New to Chinese?</b> Characters do not tell you how to say them \\u2014 that is what the small letters above them are for (pinyin: <b>n\\u01D0 h\\u01CEo</b>). The little marks are tones: \\u0101 \\u00E1 \\u01CE \\u00E0 \\u2014 four tones, four different words. Tap \\u25B6 to hear any line; tap \U0001F422 to slow it down \u2014 tap again for slower (0.5\u00D7, best for hearing the tones).')+'</div></div>'+
    '<div class="tour-steps">'+
    '<div>'+T('1\\uFE0F\\u20E3 Tap a line below \\u2192 listen, cover the Chinese, <b>say it out loud 3\\u00D7</b>. Speaking is the whole point.')+'</div>'+
    '<div>'+T('2\\uFE0F\\u20E3 Do one <b>Day</b> card a day \\u2014 the streak keeps you coming back.')+'</div>'+
    '<div>'+T('3\\uFE0F\\u20E3 Open <b>Tones</b> for 1 minute \\u2014 train your ear: four tones, four different words.')+'</div>'+
    '<div>'+T('4\\uFE0F\\u20E3 Want to <b>write</b> characters too? Open <b>Cards</b> \\u2192 tap \\u270D\\uFE0F <b>Strokes</b> \\u2014 watch the stroke order, then trace it yourself.')+'</div>'+
    '</div>'+
    '<p class="desc" style="font-size:11.5px;color:var(--sub);margin:10px 0 0">'+T('\\u{1F512} Recordings are never saved \\u00B7 \\u{1F4AC} Feedback (bottom-left) any time')+'</p>'+
    '<button class="btn primary" onclick="endTour()">'+T('Got it \\u2014 let\\'s speak')+'</button></div>';"""

EDITS.append(('M12 tourHtml 整卡', TOUR_OLD, TOUR_NEW, 1))

# ---------------------------------------------------------------- 执行
print('== patch_i18n.py  ==')
print('目标：' + str(SRC))
print('模式：' + ('DRY-RUN（不写盘）' if DRY else '写入'))
print('')

fails = []
for name, old, new, expect in EDITS:
    # 幂等：若 new 已存在且 old 不存在，视为已完成
    n_old = text.count(old)
    n_new = text.count(new)
    if n_old == 0 and n_new > 0:
        print('  = ' + name + '：已是目标状态，跳过')
        continue
    if n_old != expect:
        fails.append('%s：期望命中 %d 处，实际 %d 处' % (name, expect, n_old))
        print('  \u2717 ' + name + '：命中 ' + str(n_old) + ' 处（期望 ' + str(expect) + '）')
        continue
    text = text.replace(old, new)
    print('  \u2713 ' + name + '：命中 ' + str(n_old) + ' 处，已替换')

if fails:
    print('\n\u2717 有 ' + str(len(fails)) + ' 处替换未按预期命中，未写盘：')
    for f in fails:
        print('   - ' + f)
    sys.exit(1)

if text == before:
    print('\n无变化（全部已是目标状态）。')
    sys.exit(0)

if not DRY:
    SRC.write_text(text, encoding='utf-8')
print('\n完成。index.html 字节 ' + str(len(before)) + ' \u2192 ' + str(len(text)) +
      '（+' + str(len(text) - len(before)) + '）')
