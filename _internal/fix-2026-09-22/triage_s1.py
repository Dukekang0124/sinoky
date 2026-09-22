# -*- coding: utf-8 -*-
"""S1 分诊：从 1552 条裸 CJK 里只捞「写入 DOM 语境」的 UI 串"""
import io, re, os

SRC = os.path.join(os.path.dirname(__file__), '..', '..', 'index.html')
H = io.open(SRC, encoding='utf-8').read()
line_of = lambda idx: H.count('\n', 0, idx) + 1

def extract_strings(text):
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i+1] == '/':
            j = text.find('\n', i); i = j if j > 0 else n; continue
        if c == '/' and i + 1 < n and text[i+1] == '*':
            j = text.find('*/', i); i = (j + 2) if j > 0 else n; continue
        if c in '"\'`':
            q = c; j = i + 1; buf = []
            while j < n:
                ch = text[j]
                if ch == '\\': buf.append(text[j:j+2]); j += 2; continue
                if ch == q: break
                buf.append(ch); j += 1
            out.append((i, j, q, ''.join(buf))); i = j + 1; continue
        i += 1
    return out

def has_cjk(s): return any('\u4e00' <= c <= '\u9fff' for c in s)

WRITE_RE = re.compile(
    r'(?:textContent|innerHTML|innerText|insertAdjacentHTML|outerHTML)\s*[+]?=|'
    r'insertAdjacentHTML\s*\(|toast\s*\(|alert\s*\(|confirm\s*\(|title\s*[:=]\s*|placeholder\s*[:=]\s*|aria-label\s*[:=]\s*|\?[\s\S]{0,40}:[\s\S]{0,40}[\'"`]')

hits = []
for (a, b, q, raw) in extract_strings(H):
    if not has_cjk(raw): continue
    # 语句级判定：上一个 ; 或 { 或 } 之后到当前位置的片段里出现写入动词 → UI 语境
    seg_start = max(H.rfind(';', 0, a), H.rfind('{', 0, a), H.rfind('}', 0, a), a - 1200)
    seg = H[seg_start:a]
    kind = None
    if re.search(r'(?:textContent|innerHTML|innerText|outerHTML)\s*[+]?=', seg): kind = 'assign'
    elif re.search(r'insertAdjacentHTML\s*\(', seg): kind = 'adjacent'
    elif re.search(r'toast\s*\(', seg): kind = 'toast'
    elif re.search(r'alert\s*\(', seg): kind = 'alert'
    elif re.search(r'(?:title|placeholder|aria-label)\s*[:=]', seg): kind = 'attr'
    if not kind: continue
    # 模板串（backtick）整个都算 UI
    hits.append((line_of(a), kind, q, raw))

# 去重（同串多行）
seen = {}
for ln, kind, q, raw in hits:
    key = raw
    if key not in seen: seen[key] = (ln, kind, q)
    else:
        ln0, kind0, q0 = seen[key]
        seen[key] = (min(ln0, ln), kind0 if kind0 == 'assign' else kind, q0)

out = io.open(os.path.join(os.path.dirname(__file__), '_s1_ui_triage.txt'), 'w', encoding='utf-8')
for raw, (ln, kind, q) in sorted(seen.items(), key=lambda x: x[1][0]):
    out.write('L%-6d %-8s %s%r\n' % (ln, kind, q, raw[:140]))
out.close()
print('UI-context raw CJK unique:', len(seen))
