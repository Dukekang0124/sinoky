# -*- coding: utf-8 -*-
"""
Sinoky 大模型（免费 GLM-4-Flash /api/chat）能力覆盖度审计
=========================================================
适配自 llm-capability-coverage-audit 骨架。
口径：
  - 真·大模型通道 = /api/chat（GLM-4-Flash，经由 CF Worker 代理）。这是免费大模型唯一入口。
  - 专用评分模型 = /api/score（逐音节打分 + 声调判定 + verdict）。属专用 ML 服务，不计入「通用大模型广度」。
  - 语音能力 = /api/tts /api/asr。单列统计，不计入「大脑」。
门禁：A 穷举家族清点 / B 度量通电（KV 埋点通道）/ C 原始 vs 聚合 / D 四层判定。
"""
import io, re, os, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', 'index.html'))
s = io.open(SRC, encoding='utf-8', newline='').read().replace('\r\n', '\n')

# ============ AI 通道指纹 ============
# 真·大模型（免费）：/api/chat
LLM_PATTERNS = [
    ('/api/chat (GLM-4-Flash)', r"fetch\s*\(\s*[^)]*api/chat"),
]
# 专用评分模型（逐音节/声调），单列
SCORE_PATTERNS = [
    ('/api/score (评分模型)', r"fetch\s*\(\s*[^)]*api/score"),
]
# 语音能力（不计入大脑）
VOICE_PATTERNS = [
    ('/api/tts', r"fetch\s*\(\s*[^)]*api/tts"),
    ('/api/asr', r"fetch\s*\(\s*[^)]*api/asr"),
]

def hits_in(body, patterns):
    out = []
    for label, pat in patterns:
        if re.search(pat, body):
            out.append(label)
    return out

# ============ 1) 函数体解析（括号配平，跳字符串/注释） ============
funcs = {}
fn_re = re.compile(r'^[ \t]*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', re.M)
for m in fn_re.finditer(s):
    name = m.group(1)
    i = m.end() - 1
    depth = 0; instr = None; esc = False; started = False
    while i < len(s):
        c = s[i]
        if esc: esc = False; i += 1; continue
        if instr:
            if c == '\\': esc = True
            elif c == instr: instr = None
            i += 1; continue
        if c in '"\'`': instr = c; i += 1; continue
        if c == '/' and i + 1 < len(s) and s[i+1] == '/':
            j = s.find('\n', i); i = j if j > 0 else len(s); continue
        if c == '/' and i + 1 < len(s) and s[i+1] == '*':
            j = s.find('*/', i); i = (j + 2) if j > 0 else len(s); continue
        if c == '{': depth += 1; started = True
        elif c == '}':
            depth -= 1
            if started and depth == 0:
                funcs[name] = {'line': s[:m.start()].count('\n') + 1,
                               'endline': s[:i].count('\n') + 1,
                               'body': s[m.end()-1:i+1]}
                break
        i += 1

# ============ Gate A: 穷举家族清点 ============
print('=== Gate A: 函数总数 =', len(funcs))
fam = collections.Counter()
for n in funcs:
    mm = re.match(r'([a-z]+|[A-Z][a-z]+)', n)
    fam[mm.group(1) if mm else n[:4]] += 1
print('--- 函数名前缀家族 Top 40 ---')
for k, v in fam.most_common(40):
    print('  %-14s %d' % (k, v))

# ============ 2) 收集用户可见入口（三处） ============
entries = []
for m in re.finditer(r'on(?:click|change|input|submit)\s*=\s*"([^"]{0,400})"', s):
    raw = m.group(1); line = s[:m.start()].count('\n') + 1
    for fn in re.findall(r'([A-Za-z_$][\w$]*)\s*\(', raw):
        entries.append(('inline', fn, raw.strip()[:80], line))
for m in re.finditer(r"addEventListener\(\s*['\"](?:click|change|input|submit)['\"]\s*,\s*([^,)]{1,200})", s):
    line = s[:m.start()].count('\n') + 1; seg = m.group(1)
    for fn in re.findall(r'([A-Za-z_$][\w$]*)\s*\(', seg):
        entries.append(('listener', fn, seg.strip()[:80], line))
    for fn in re.findall(r'=\s*([A-Za-z_$][\w$]*)', seg):
        entries.append(('listener', fn, seg.strip()[:80], line))
for m in re.finditer(r'\.onclick\s*=\s*([A-Za-z_$][\w$.]*)', s):
    line = s[:m.start()].count('\n') + 1
    entries.append(('onclick-assign', m.group(1).split('.')[-1], m.group(1), line))

# ============ 3) 可达性（depth=1） ============
def resolve(name, depth=1, seen=None):
    if seen is None: seen = set()
    if name in seen: return set()
    seen.add(name)
    f = funcs.get(name)
    if not f: return set()
    h = set(hits_in(f['body'], LLM_PATTERNS))
    if depth > 0:
        for callee in set(re.findall(r'([A-Za-z_$][\w$]*)\s*\(', f['body'])):
            if callee in funcs and callee != name:
                h |= resolve(callee, depth - 1, seen)
    return h

def direct_only(name):
    f = funcs.get(name)
    return set(hits_in(f['body'], LLM_PATTERNS)) if f else set()

# 同时统计「到达评分模型」与「到达语音」以说明分布
def reach_any(name, patterns, depth=1, seen=None):
    if seen is None: seen = set()
    if name in seen: return set()
    seen.add(name)
    f = funcs.get(name)
    if not f: return set()
    h = set(hits_in(f['body'], patterns))
    if depth > 0:
        for callee in set(re.findall(r'([A-Za-z_$][\w$]*)\s*\(', f['body'])):
            if callee in funcs and callee != name:
                h |= reach_any(callee, patterns, depth - 1, seen)
    return h

rows = []
seen_keys = set()
for src, fn, ctx, line in entries:
    key = (fn, ctx)
    if key in seen_keys: continue
    seen_keys.add(key)
    d = sorted(direct_only(fn))
    i1 = sorted(reach_any(fn, LLM_PATTERNS, 1) - set(d))
    sc = sorted(reach_any(fn, SCORE_PATTERNS, 1))
    rows.append({'src': src, 'fn': fn, 'ctx': ctx, 'line': line,
                 'direct': d, 'indirect': i1, 'score': sc, 'defined': fn in funcs})

ai_rows = [r for r in rows if r['direct']]
ind_rows = [r for r in rows if not r['direct'] and r['indirect']]
noai_rows = [r for r in rows if not r['direct'] and not r['indirect'] and r['defined']]
undef_rows = [r for r in rows if not r['defined']]

print('\n=== 用户可见入口（去重）: %d ===' % len(rows))
print('  ① 直接触达 /api/chat（大模型）: %d' % len(ai_rows))
print('  ② 仅间接触达大模型           : %d' % len(ind_rows))
print('  ③ 完全未触达大模型（有定义） : %d' % len(noai_rows))
print('  ④ 未解析到定义               : %d' % len(undef_rows))

print('\n--- ① 直接触达大模型入口 ---')
for r in sorted(ai_rows, key=lambda x: x['line']):
    print('  L%-6d %-28s %s' % (r['line'], r['fn'], ','.join(r['direct'])))
print('\n--- ② 间接触达大模型入口 ---')
for r in sorted(ind_rows, key=lambda x: x['line']):
    print('  L%-6d %-28s <- %s' % (r['line'], r['fn'], ','.join(r['indirect'])))

# ============ 4) 按功能区聚合（函数数当体量权重） ============
print('\n=== 分功能区覆盖矩阵（函数数 = 体量）===')
FAMILIES = {
    '诺诺聊天':      r'^(nonoChat|nonoStartChat|nonoChatReply|nonoChatSend|nonoChatOpen|nonoChatBubble|nonoChatControls|nonoChatTextToggle|nonoChatScroll)',
    '诺诺跟读评分':  r'^(nonoGrade|nonoStartPractice|nonoSay|nonoNewLine|nonoPracticeLine|nonoShow|nonoState|nonoStop|nonoRecord)',
    '场景/情境对话': r'^(renderScene|startScene|scene|someone|renderDialog|openScene|renderExpr)',
    '每日一句':      r'^(renderDaily|daily|maybeExtendSentence|startExtend|extend)',
    '字卡/HSK':      r'^(fc|renderFlash|renderFc|hsk|flashcard|saveChar|renderChar)',
    '复习引擎':      r'^(rev|renderReview|review|rvMark|revState|revQueue|revSchedule)',
    '声调训练':      r'^(tone|TONE|renderTone)',
    '首页/导航':     r'^(renderHome|go|renderNav|nav|home)',
    '设置/语言':     r'^(renderSettings|renderLang|applyLang|setLang|renderAbout)',
    '徽章/成就':     r'^(badge|renderBadge|award|renderAward|medal)',
    '限流/解锁':     r'^(showLimitWall|renderQuotaUI|doUnlock|tryUnlockCode|copyWechat|resetUnlock)',
    '反馈/埋点':     r'^(feedback|trackEvent|trk|report|badgeReport|sendFeedback)',
}
matrix = {}
for fam, pat in FAMILIES.items():
    rx = re.compile(pat)
    names = [n for n in funcs if rx.search(n)]
    ai_n = [n for n in names if direct_only(n)]
    ind_n = [n for n in names if (not direct_only(n)) and reach_any(n, LLM_PATTERNS, 1)]
    sc_n = [n for n in names if reach_any(n, SCORE_PATTERNS, 1)]
    matrix[fam] = {'total': len(names), 'llm_direct': ai_n, 'llm_indirect': ind_n, 'score': sc_n}
    print('\n  [%s] 函数 %d ｜ 大模型直接 %d ｜ 间接 %d ｜ 评分模型 %d'
          % (fam, len(names), len(ai_n), len(ind_n), len(sc_n)))
    for n in sorted(names):
        h = direct_only(n)
        h1 = reach_any(n, LLM_PATTERNS, 1) - set(h)
        tag = 'LLM' if h else ('ind' if h1 else ('sc ' if n in sc_n else '—  '))
        print('     %s %-34s %s' % (tag, n, ','.join(sorted(h or h1)) or ('(score)' if n in sc_n else '')))

# ============ 5) 死代码 / 已挂载未接线检测 ============
print('\n=== 死代码 / 闲置能力检测（/api/chat 相关）===')
# 谁定义了 /api/chat 调用、谁调用了它
chat_callers = [n for n, f in funcs.items() if hits_in(f['body'], LLM_PATTERNS)]
print('  直接调用 /api/chat 的函数:', chat_callers)
# 统计各 AI 能力出现次数（定义/挂载/调用）
for k in ['nonoChatReply', 'nonoChatSend', 'nonoChatSendText', 'nonoStartChat', 'speak', 'asrText', 'apiScore', 'apiScoreSafe']:
    cnt = len(re.findall(r'\b'+re.escape(k)+r'\b', s))
    print('  %-22s 出现 %d 次' % (k, cnt))

# ============ 导出 ============
out = {'entries': rows,
       'funcs': {k: {'line': v['line']} for k, v in funcs.items()},
       'matrix': {k: {'total': v['total'], 'llm_direct': len(v['llm_direct']),
                      'llm_indirect': len(v['llm_indirect']), 'score': len(v['score'])}
                 for k, v in matrix.items()},
       'chat_callers': chat_callers}
io.open(os.path.join(HERE, '_ai_cov.json'), 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))
print('\n[saved] _ai_cov.json')
