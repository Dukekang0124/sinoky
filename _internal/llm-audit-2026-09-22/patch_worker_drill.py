# -*- coding: utf-8 -*-
"""v0.23.17 Worker 加 drill 出题模式（幂等，整体 guard + count 断言）。
改根 _worker.js；同步本地 www/_worker.js（不入 git，APK CI 重建会覆盖，但本地 APK 构建需一致）。
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W = os.path.join(ROOT, '_worker.js')
WW = os.path.join(ROOT, 'www', '_worker.js')

DRILL_SYS = r'''const DRILL_SYSTEM = '你是"诺诺"，一只教外国初学者说中文的熊猫出题教练。用户在某方面有发音弱点（如三声、声母、流利度）。请基于这个弱点，造一句超简单、日常、不超过 8 个字的中文练习句，让 ta 开口练这个弱点。格式严格为：中文句子 | English translation。不要解释，不要多余标点。例：你好吗 | How are you';'''

CHAT_BRANCH_OLD = "  const sysPrompt = (mode === 'coach') ? COACH_SYSTEM : CHAT_SYSTEM;"
CHAT_BRANCH_NEW = ("  const sysPrompt = (mode === 'coach') ? COACH_SYSTEM : "
  "(mode === 'drill') ? DRILL_SYSTEM : CHAT_SYSTEM;")

SENTINEL = '/* ===== v0.23.17 DRILL_SYSTEM (AI 复习出题) ===== */'

def patch_one(path, label):
    if not os.path.exists(path):
        print('SKIP (no file) %s' % path); return
    s = open(path, encoding='utf-8').read()
    if SENTINEL in s:
        print('ALREADY_PATCHED %s' % label); return
    if DRILL_SYS in s:
        print('ABORT [%s] DRILL_SYSTEM literal already present but sentinel missing' % label); sys.exit(1)
    anchor = "const COACH_SYSTEM = "
    i = s.find(anchor)
    if i < 0:
        print('ABORT [%s] COACH_SYSTEM anchor not found' % label); sys.exit(1)
    j = s.find(';', i)
    if j < 0:
        print('ABORT [%s] COACH_SYSTEM line end not found' % label); sys.exit(1)
    s = s[:j+1] + '\n' + SENTINEL + '\n' + DRILL_SYS + '\n' + SENTINEL + '_END\n' + s[j+1:]
    if CHAT_BRANCH_OLD not in s:
        print('ABORT [%s] chatGLM branch anchor not found' % label); sys.exit(1)
    s = s.replace(CHAT_BRANCH_OLD, CHAT_BRANCH_NEW, 1)
    open(path, 'w', encoding='utf-8').write(s)
    print('APPLIED %s' % label)

patch_one(W, 'root')
patch_one(WW, 'www')
print('DONE')
