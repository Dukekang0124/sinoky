# -*- coding: utf-8 -*-
"""v0.23.15 前端补丁：LLM 渗透进跟读点评 + aiWeak 闭环。
幂等：已含 coachGradeComment 则整文件跳过。逐处 count 断言 + LF 视图编辑。
新增 3 个字典 key（6 语言对齐）。版本号 bump 0.23.14→0.23.15。
"""
import io, sys, json, glob

GUARD = 'function coachGradeComment'
APP_V_OLD = "var APP_VERSION = '0.23.14'"
APP_V_NEW = "var APP_VERSION = '0.23.15'"
CACHE_OLD = "var CACHE = 'sinoky-v0.23.14'"
CACHE_NEW = "var CACHE = 'sinoky-v0.23.15'"

NEW_KEYS = {
  'AI coach insights': {'zh':'AI 教练洞察','en':'AI coach insights','es':'Ideas de la coach IA','ru':'Идеи ИИ-тренера','vi':'Nhận xét từ AI','id':'Wawasan pelatih AI','th':'AI โค้ชให้ข้อคิด'},
  'AI spotted your weak dimensions — drill them more.': {'zh':'AI 发现了你的薄弱维度——多练这些。','en':'AI spotted your weak dimensions — drill them more.','es':'La IA detectó tus puntos débiles — practícalos más.','ru':'ИИ нашёл слабые места — тренируй их чаще.','vi':'AI tìm ra điểm yếu — luyện thêm.','id':'AI menemukan kelemahan — latih lebih.','th':'AI พบจุดอ่อน — ฝึกเพิ่ม'},
  'AI spotted this needs more drills': {'zh':'AI 标了这条要多练','en':'AI spotted this needs more drills','es':'La IA marcó esta para practicar más','ru':'ИИ отметил это для тренировки','vi':'AI đánh dấu cần luyện thêm','id':'AI menandai perlu latih','th':'AI ระบุว่าต้องฝึกเพิ่ม'},
}


def rep(tag, old, new, expect=1):
    global src
    if old not in src:
        if new in src:
            print('SKIP[%s] applied' % tag); return
        sys.exit('ABORT[%s] old not found' % tag)
    n = src.count(old)
    if n != expect:
        sys.exit('ABORT[%s] count=%d expect=%d' % (tag, n, expect))
    src = src.replace(old, new, 1)
    print('OK[%s]' % tag)


# ---------- index.html ----------
raw = io.open('index.html', encoding='utf-8', newline='').read()
if GUARD in raw:
    print('index.html already patched, skip')
else:
    nl = '\r\n' if '\r\n' in raw else '\n'
    src = raw.replace('\r\n', '\n')

    # 1. 点评 div 加 id（coachGradeComment 定位锚点）
    rep('np-comment',
        '''<div class="np-fix" style="margin-top:8px">'+comment+(verdict?' <span style="color:var(--sub)">('+verdict+')</span>':'')+'</div>'+''',
        '''<div class="np-fix" id="np-comment" style="margin-top:8px">'+comment+(verdict?' <span style="color:var(--sub)">('+verdict+')</span>':'')+'</div>'+''')
    # 2. 渲染后异步触发 AI 点评
    rep('coach-call',
        '''  if(p) p.innerHTML = h;''',
        '''  if(p) p.innerHTML = h;
  coachGradeComment(line, acc, comp, flu, fixes, p);''')
    # 3. pickLine AI 维度弱点 boost
    rep('pickline',
        '''  /* 个性化：优先挑"老出错"的句子（weak 记录） */
  var weak = (S.nono && S.nono.weak) || {};
  var bad = pool.filter(function(l){ return (weak[l.key]||0) >= 2; });
  var arr = bad.length ? bad : pool;
  return arr[Math.floor(Math.random()*arr.length)];''',
        '''  /* 个性化：优先挑"老出错"的句子（weak 记录）+ AI 维度弱点 boost */
  var weak = (S.nono && S.nono.weak) || {};
  var aiw = (S.aiWeak && S.aiWeak.dims) || {};
  var aiBoost = Object.keys(aiw).some(function(k){ return (aiw[k]||0) >= 2; }) ? 1 : 0;
  var bad = pool.filter(function(l){ return (weak[l.key]||0) + aiBoost >= 2; });
  var arr = bad.length ? bad : pool;
  return arr[Math.floor(Math.random()*arr.length)];''')
    # 4. Progress 页容器
    rep('prog-container',
        '''    <div id="prog-weak"></div>''',
        '''    <div id="prog-weak"></div>
    <div id="prog-aiweak"></div>''')
    # 5. Progress 渲染
    rep('prog-render',
        '''    var pw=$('prog-weak'); if(pw && typeof weakLinesHtml==='function') pw.innerHTML = weakLinesHtml();''',
        '''    var pw=$('prog-weak'); if(pw && typeof weakLinesHtml==='function') pw.innerHTML = weakLinesHtml();
    var aw=$('prog-aiweak'); if(aw && typeof aiWeakHtml==='function') aw.innerHTML = aiWeakHtml();''')
    # 6. 版本号
    rep('appv', APP_V_OLD, APP_V_NEW)

    # 7. 注入追加块（</body> 前）
    MARK = '<!-- ===== v0.23.15 AI coach ===== -->'
    if MARK not in src:
        blk = io.open('_internal/llm-audit-2026-09-22/ai_coach_block.js', encoding='utf-8').read()
        block = MARK + '\n<script>\n' + blk + '\n</script>\n<!-- ===== /v0.23.15 AI coach ===== -->\n'
        i = src.rindex('</body>')
        src = src[:i] + block + src[i:]
        print('OK[inject]')
    out = src.replace('\n', nl)
    io.open('index.html', 'w', encoding='utf-8', newline='').write(out)
    print('index.html patched')

# ---------- sw.js ----------
raw = io.open('sw.js', encoding='utf-8', newline='').read()
if CACHE_NEW in raw:
    print('sw.js already patched')
else:
    nl = '\r\n' if '\r\n' in raw else '\n'
    src = raw.replace('\r\n', '\n')
    rep('sw-cache', CACHE_OLD, CACHE_NEW)
    io.open('sw.js', 'w', encoding='utf-8', newline='').write(src.replace('\n', nl))
    print('sw.js patched')

# ---------- version.json ----------
vj = json.load(io.open('version.json', encoding='utf-8'))
vj['version'] = '0.23.15'
vj['note'] = ('v0.23.15：免费大模型（GLM-4-Flash）渗透进练习主战场。给 /api/chat 加 coach 模式，跟读评分后由诺诺用 AI 生成个性化点评'
              '（中英混排、指出最该改进的点），离线回落模板点评；新增 S.aiWeak 维度弱点账本（声调/声母/流利度），AI 发现的弱点驱动复习挑句更积极，'
              '并在 Progress 页展示「AI coach insights」。仅网页发布，APK 沿用 0.23.13，用户经 SW 更新生效。')
NEW_EN = ('v0.23.15: the free LLM (GLM-4-Flash) now permeates the core practice loop. Added a coach mode to /api/chat; '
          'after each read-and-score Nono generates a personalised AI comment (mixed CN/EN, pinpointing the one thing to improve), '
          'falling back to the template comment when offline. New S.aiWeak dimension ledger (tones/initials/fluency) drives more aggressive '
          'review picking and surfaces on Progress as AI coach insights. Web-only; APK stays 0.23.13, App users get it via SW update.')
if not (vj.get('noteEn') and str(vj['noteEn'][0]).startswith('v0.23.15')):
    vj['noteEn'] = [NEW_EN] + (vj.get('noteEn') or [])
io.open('version.json', 'w', encoding='utf-8').write(json.dumps(vj, ensure_ascii=False, indent=2) + '\n')
print('version.json patched')

# ---------- 字典 ----------
for fp in glob.glob('langs/*.json'):
    lang = fp.split('/')[-1][:-5]
    d = json.load(io.open(fp, encoding='utf-8'))
    ch = False
    for k, tr in NEW_KEYS.items():
        if k not in d:
            d[k] = tr.get(lang, tr['en']); ch = True
    if ch:
        io.open(fp, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=1) + '\n')
        print('dict', lang, 'updated')

print('DONE')
