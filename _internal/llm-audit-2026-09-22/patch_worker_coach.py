# -*- coding: utf-8 -*-
"""P0-A Worker 改造：给 /api/chat 加 mode='coach' 教练点评模式。
幂等：已含 COACH_SYSTEM 则整文件跳过。逐处 count 断言防错配。
LF 视图编辑 + 落盘还原换行风格（坑28）。
"""
import io, sys

MARK = "COACH_SYSTEM ="
COACH = ("const COACH_SYSTEM = '你是“诺诺”，一只教外国初学者说中文的熊猫口语教练。"
         "用户刚跟读了一句中文，你会看到他的评分数据。请用诺诺鼓励、朋友的口吻，"
         "给一句不超过 30 字的中文为主简短点评：指出他最该改进的那一个点"
         "（声调、声母、流利度或完整度），并给一句具体小建议。可以夹 1-2 个英文关键词"
         "（如 tone、rhythm）。不要抛开放式问题，不要写长篇解释。';")

OLD_CHAT = ("const CHAT_SYSTEM = '你是“诺诺”，一只教外国初学者说中文的熊猫。请用简单、口语化的简体中文回复，"
            "每轮1-3句。不要写英文解释，不要纠正对方语法（除非对方主动问）。每轮结尾抛一个开放式的简单问题，"
            "鼓励对方用中文回答。语气像朋友聊天，自然友好。';")

def rep(tag, old, new, expect=1):
    global src
    if old not in src:
        if new in src:
            print('SKIP[%s] already applied' % tag); return
        sys.exit('ABORT[%s] old not found' % tag)
    n = src.count(old)
    if n != expect:
        sys.exit('ABORT[%s] old count=%d expect=%d' % (tag, n, expect))
    src = src.replace(old, new, 1)
    print('OK[%s]' % tag)

for path in ['_worker.js', 'www/_worker.js']:
    raw = io.open(path, encoding='utf-8', newline='').read()
    if MARK in raw:
        print(path, '== already patched, skip =='); continue
    nl = '\r\n' if '\r\n' in raw else '\n'
    src = raw.replace('\r\n', '\n')

    rep('coach-const', OLD_CHAT, OLD_CHAT + '\n' + COACH)
    rep('coach-sig', 'async function chatGLM(userText, hist, env) {',
                        'async function chatGLM(userText, hist, env, mode) {')
    rep('coach-sys', "  const messages = [{ role: 'system', content: CHAT_SYSTEM }];",
                        "  const sysPrompt = (mode === 'coach') ? COACH_SYSTEM : CHAT_SYSTEM;\n"
                        "  const messages = [{ role: 'system', content: sysPrompt }];")
    rep('coach-route', 'const { text, uid, hist } = await req.json();',
                         'const { text, uid, hist, mode } = await req.json();')
    rep('coach-call', 'const reply = await chatGLM(String(text).trim(), history, env);',
                         'const reply = await chatGLM(String(text).trim(), history, env, mode);')

    out = src.replace('\n', nl)
    io.open(path, 'w', encoding='utf-8', newline='').write(out)
    print(path, '== patched ==')

print('DONE')
