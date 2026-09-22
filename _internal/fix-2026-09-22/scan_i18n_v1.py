# -*- coding: utf-8 -*-
"""i18n 全量扫描器 v1（2026-09-22）
四类扫描：
  S1: JS 里含 CJK 的字符串字面量 —— 分类：T() 包裹 vs 裸奔
  S2: T('...') 字面量 × 6 字典交叉核对（任一语言缺 = fallback 缺口）
  S3: 裸英文字符串写到 DOM/textContent/innerHTML/insertAdjacentHTML/toast/alert/title/placeholder
      —— 且既不是 T() 包裹，也不在任何字典 → 疑似漏 i18n
  S4: 静态 HTML（抠掉 script/style 后）的 CJK 文本节点 与 \\uXXXX 转义泄漏
输出：_scan_report.txt（供人工判读）
"""
import io, re, json, os, sys

SRC = os.path.join(os.path.dirname(__file__), '..', '..', 'index.html')
LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th']
BASE = os.path.join(os.path.dirname(__file__), '..', '..', 'langs')

H = io.open(SRC, encoding='utf-8').read()
lines = H.split('\n')
line_of = lambda idx: H.count('\n', 0, idx) + 1

dicts = {}
for l in LANGS:
    dicts[l] = json.load(io.open(os.path.join(BASE, l + '.json'), encoding='utf-8'))
all_keys = set()
for l in LANGS:
    all_keys |= set(dicts[l].keys())

def has_cjk(s):
    return any('\u4e00' <= c <= '\u9fff' for c in s)

# ---------- 提取 JS 字符串字面量（跳过注释） ----------
def extract_strings(text):
    """返回 [(start, end, quote, raw_content)]，跳过 // 与 /* */ 注释"""
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i+1] == '/':
            j = text.find('\n', i)
            i = j if j > 0 else n
            continue
        if c == '/' and i + 1 < n and text[i+1] == '*':
            j = text.find('*/', i)
            i = (j + 2) if j > 0 else n
            continue
        if c in '"\'`':
            q = c
            j = i + 1
            buf = []
            while j < n:
                ch = text[j]
                if ch == '\\':
                    buf.append(text[j:j+2]); j += 2; continue
                if ch == q:
                    break
                buf.append(ch); j += 1
            out.append((i, j, q, ''.join(buf)))
            i = j + 1
            continue
        i += 1
    return out

strs = extract_strings(H)

# ---------- S1: CJK 字面量 ----------
def decode_esc(s):
    if '\\' not in s:
        return s
    try:
        return s.encode('utf-8').decode('unicode_escape')
    except Exception:
        return s

cjk_all = []      # (line, quote, content, wrapped_in_T)
for (a, b, q, raw) in strs:
    if not has_cjk(raw):
        continue
    # 是否被 T( ... ) 包裹：向前找最近的非空白
    pre = H[max(0, a-30):a]
    wrapped = re.search(r'T\(\s*$', pre) is not None
    cjk_all.append((line_of(a), q, raw, wrapped))

# ---------- S2: T() 字面量 × 字典 ----------
t_keys = {}
for (a, b, q, raw) in strs:
    pre = H[max(0, a-30):a]
    if re.search(r'T\(\s*$', pre):
        t_keys[decode_esc(raw)] = line_of(a)

s2_missing = []
for k, ln in sorted(t_keys.items(), key=lambda x: x[1]):
    miss = [l for l in LANGS if k not in dicts[l]]
    if miss:
        s2_missing.append((ln, k, miss))

# ---------- S3: 裸英文串写 DOM ----------
WRITE_RE = re.compile(
    r'(?:textContent|innerHTML|innerText|insertAdjacentHTML|outerHTML)\s*[+]?=|'
    r'insertAdjacentHTML\s*\(|toast\s*\(|alert\s*\(|title\s*[:=]\s*|placeholder\s*[:=]\s*|aria-label\s*[:=]\s*')

def looks_ui(s):
    """至少 2 连续字母、长度>=3、排除 URL/路径/类名/HTML 碎片"""
    if len(s) < 3:
        return False
    if not re.search(r'[A-Za-z]{2,}', s):
        return False
    if re.search(r'(api/|assets/|langs/|\.json|\.png|\.webp|\.mp3|onclick=|id=|class=|style=|http)', s):
        return False
    if re.fullmatch(r'[\sA-Za-z0-9_\-\.\$/]+', s) and not re.search(r'[ ,.!?\']', s):
        # 纯标识符样
        return False
    return True

s3 = []
for (a, b, q, raw) in strs:
    if has_cjk(raw):
        continue
    # 只看「写入语境」前 60 字符内出现写入动词
    pre = H[max(0, a-60):a]
    if not WRITE_RE.search(pre):
        continue
    dec = decode_esc(raw)
    # 去标签取纯文本
    plain = re.sub(r'<[^>]+>', ' ', dec)
    plain = plain.strip()
    if not looks_ui(plain):
        continue
    if plain in all_keys:
        continue  # 字典已有（MutationObserver 会翻）
    # 排除模板变量拼接残片
    if re.fullmatch(r'[^\w]*(\{?\w*\}?)[^\w]*', plain):
        continue
    wrapped = re.search(r'T\(\s*$', pre) is not None
    s3.append((line_of(a), plain[:110], wrapped))

# ---------- S4: 静态区 ----------
static = re.sub(r'<script[\s\S]*?</script>', '<S/>', H, flags=re.S)
static = re.sub(r'<style[\s\S]*?</style>', '<S/>', static, flags=re.S)
s4_cjk, s4_esc = [], []
for m in re.finditer(r'>([^<>]*[\u4e00-\u9fff][^<>]*)<', static):
    txt = m.group(1).strip()
    if txt:
        s4_cjk.append((H.count('\n', 0, m.start()) + 1, txt[:90]))
for m in re.finditer(r'u\{[0-9A-Fa-f]{4,6}\}|\\u[0-9A-Fa-f]{4}', static):
    s4_esc.append((H.count('\n', 0, m.start()) + 1, m.group(0)))

# ---------- 输出 ----------
out = io.open(os.path.join(os.path.dirname(__file__), '_scan_report.txt'), 'w', encoding='utf-8')
w = out.write

w('=' * 70 + '\nS1 裸中文（未 T() 包裹，全部语言都会看到中文）：%d 条\n' % sum(1 for x in cjk_all if not x[3]))
w('=' * 70 + '\n')
for ln, q, raw, wrapped in cjk_all:
    tag = 'T()  ' if wrapped else 'RAW  '
    w('L%-6d %s %s%r\n' % (ln, tag, q, raw[:120]))
w('\n（T() 包裹的中文 key 共 %d 条，见 S2 核对）\n\n' % sum(1 for x in cjk_all if x[3]))

w('=' * 70 + '\nS2 T() 字面量 × 6 字典 缺失：%d 条\n' % len(s2_missing))
w('=' * 70 + '\n')
for ln, k, miss in s2_missing:
    w('L%-6d %r  missing in %s\n' % (ln, k[:100], ','.join(miss)))

w('\n' + '=' * 70 + '\nS3 裸英文写 DOM 且字典无 key：%d 条\n' % len(s3))
w('=' * 70 + '\n')
for ln, txt, wrapped in s3:
    w('L%-6d %s %s\n' % (ln, 'T()' if wrapped else 'RAW ', repr(txt)))

w('\n' + '=' * 70 + '\nS4 静态区 CJK 文本节点：%d 条 | 转义泄漏：%d 条\n' % (len(s4_cjk), len(s4_esc)))
w('=' * 70 + '\n')
for ln, txt in s4_cjk:
    w('L%-6d %r\n' % (ln, txt))
for ln, e in s4_esc:
    w('L%-6d ESCAPE-LEAK %s\n' % (ln, e))
out.close()

print('S1 raw CJK:', sum(1 for x in cjk_all if not x[3]), '| S1 T()-wrapped CJK:', sum(1 for x in cjk_all if x[3]))
print('S2 T-keys total:', len(t_keys), '| missing:', len(s2_missing))
print('S3 raw EN candidates:', len(s3))
print('S4 static CJK nodes:', len(s4_cjk), '| escape leaks:', len(s4_esc))
print('report -> _scan_report.txt')
