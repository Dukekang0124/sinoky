# -*- coding: utf-8 -*-
# 修复 v0.23.16 块位置错误：原补丁把它插到了 </script> 之后（script 外，死代码）。
# 改为移到 v0.23.15 块的 </script> 之前（script 内，函数声明可 hoist）。
import os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'index.html')
src = open(SRC, encoding='utf-8').read()

block_re = re.compile(r'/\* ===== v0.23.16 L3 闭环度量.*?/\* ===== /v0.23.16 L3 ===== \*/', re.S)
matches = list(block_re.finditer(src))
if len(matches) == 0:
    print('ALREADY_FIXED_OR_MISSING'); sys.exit(0)
if len(matches) != 1:
    sys.exit('ABORT block count=%d' % len(matches))
block = matches[0].group(0)
last_close = src.rfind('</script>', 0, matches[0].start())
if last_close < matches[0].start():
    src = block_re.sub('', src, 1)
    src = re.sub(r'\n{3,}', '\n\n', src)
    anchor_re = re.compile(r'(</script>\s*<!-- ===== /v0.23.15 AI coach ===== -->)')
    m = anchor_re.search(src)
    if not m:
        sys.exit('ABORT anchor missing')
    src = anchor_re.sub(block + '\n' + r'\1', src, 1)
    open(SRC, 'w', encoding='utf-8').write(src)
    print('FIXED: v0.23.16 block moved inside <script>')
else:
    print('ALREADY_INSIDE_SCRIPT')
