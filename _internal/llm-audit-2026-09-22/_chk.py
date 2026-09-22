import re, subprocess, os
s = open('index.html', encoding='utf-8').read()
blocks = re.findall(r'<script>(.*?)</script>', s, re.S)
print('inline script blocks:', len(blocks))
allok = True
for i, b in enumerate(blocks):
    fp = '_internal/llm-audit-2026-09-22/_s%d.js' % i
    open(fp,'w',encoding='utf-8').write(b)
    r = subprocess.run(['C:/Users/Admin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe','--check',fp], capture_output=True, text=True)
    if r.returncode!=0:
        allok=False; print('FAIL', i, r.stderr[:300])
    else:
        print('OK', i, '(chars %d)'%len(b))
print('ALL_OK' if allok else 'HAS_FAILURE')
