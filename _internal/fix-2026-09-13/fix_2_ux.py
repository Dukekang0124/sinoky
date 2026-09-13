# -*- coding: utf-8 -*-
"""
v0.23.8 修复批次 · 组 2：UX 评审遗留（审计 P2-3）

⚠️ 重要前置事实（本轮核实结论）：
   UX 评审文档把 M8 / M9 / M10 / M12-ESC 列为「未修」，但**代码里 v0.3.35 那一轮就修了**
   （见 index.html L5846 "v0.3.35 M8"、L5900 "v0.3.35 M9"、L5911 "v0.3.35 M10"、
     L5924 "v0.3.35：ESC 关闭任意浮层"）。这是第 12~14 处「文档说没做、实际做了」的错位。
   本脚本只修**真正还没做的 5 处**：
     M12a 11 个纯图标按钮没有 aria-label（屏幕阅读器读到的是「🐼」这种字符）
     M13  sw.js 无条件把失败请求回落成 index.html ⇒ .json/.js 拿到 HTML，上层 JSON.parse 报
          `Unexpected token '<'`，用户看到解析错误而不是「离线不可用」
     M14  限流 40 次/60s 按 IP——公司/校园网共享出口的多用户会互相挤掉
     L3   Sentences 做到最后一题直接绕回第一题，没有任何「已练完」提示
     L6   S.days 日期数组只增不减（一年 365 条）

改动文件：index.html / sw.js / _worker.js / langs/*.json（L3 新增一条 toast 文案，6 语言）
幂等：每处先查「新内容是否已存在」，存在即跳过。
用法：python fix_2_ux.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(os.path.dirname(HERE))
IDX = os.path.join(APP, 'index.html')
SW = os.path.join(APP, 'sw.js')
WRK = os.path.join(APP, '_worker.js')
LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th']


def read(p):
    with open(p, 'r', encoding='utf-8', newline='') as f:
        s = f.read()
    return s.replace('\r\n', '\n').replace('\r', '\n')


def write(p, s):
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def sub_once(s, old, new, label):
    """精确替换一次；目标态已存在则跳过（真正幂等）。

    ★ 踩坑：本脚本多处 new 是 old 的**超串**（如 L6 在原句后追加注释），
      于是旧判据 `new in s and old not in s` 永远不成立 —— old 仍是 new 的前缀，
      每跑一轮就把注释块再插一遍（实证：L6 块在 index.html / _worker.js 各重复 2 次）。
      正确语义只该问一件事：**目标态到了没有**。
    """
    if new in s:
        print('  [skip] %s（已是新版）' % label)
        return s
    n = s.count(old)
    assert n >= 1, '%s：锚点未命中' % label
    assert n == 1, '%s：锚点命中 %d 次（不唯一）' % (label, n)
    print('  [ok]   %s' % label)
    return s.replace(old, new, 1)


# ═════════════════════ M12a：图标按钮补 aria-label ═════════════════════
def fix_m12(idx):
    print('M12a  aria-label')
    pairs = [
        # 1) 阅读器关闭
        ('onclick="closeReader()">\u2715</button>',
         'onclick="closeReader()" aria-label="Close the reader">\u2715</button>',
         'closeReader'),
        # 2) 诺诺面板最小化（原来只有 title —— title 不能可靠替代 aria-label）
        ('onclick="nonoMin()" title="Minimise">\u2013</button>',
         'onclick="nonoMin()" title="Minimise" aria-label="Minimise the assistant">\u2013</button>',
         'nonoMin'),
        # 3) 诺诺面板关闭
        ('onclick="nonoClose()" title="Hide for today">\u2715</button>',
         'onclick="nonoClose()" title="Hide for today" aria-label="Hide the assistant for today">\u2715</button>',
         'nonoClose'),
        # 4) 诺诺聊天切文本输入（复用同一个 T('Type')，这样标签跟着界面语言走）
        ("onclick=\"nonoChatTextToggle()\" title=\"'+T('Type')+'\">\u270f\ufe0f</button>",
         "onclick=\"nonoChatTextToggle()\" title=\"'+T('Type')+'\" aria-label=\"'+T('Type')+'\">\u270f\ufe0f</button>",
         'nonoChatTextToggle'),
        # 5) 已收藏字卡移除
        ("onclick=\"fcRemove(\\'' + esc(hz) + '\\')\">\u2715</button>",
         "onclick=\"fcRemove(\\'' + esc(hz) + '\\')\" aria-label=\"Remove from saved\">\u2715</button>",
         'fcRemove'),
        # 6) 字卡「听」按钮 —— 全站唯一**纯图标**的 🔊（其余 9 处都带 Hear/Play 等可见文字，
        #    屏幕阅读器能读到；只有这一个是光秃秃的 emoji，等于无标签按钮）
        ("'<button class=\"btn ghost mini\" onclick=\"speak(\\'' + esc(hz) + '\\',this)\">\U0001f50a</button>'",
         "'<button class=\"btn ghost mini\" onclick=\"speak(\\'' + esc(hz) + '\\',this)\" aria-label=\"Play audio\">\U0001f50a</button>'",
         'fc mini speak'),
    ]
    for old, new, label in pairs:
        idx = sub_once(idx, old, new, label)

    # 7) 所有「跟诺诺练这一句」的 🐼 按钮（6 处，语义相同 ⇒ 统一标签）
    #    本段天然幂等（已带 aria-label 的原样返回），但计数要报「真正补了几个」，
    #    否则重跑时永远打印「扫描 6 处，已补」⇒ 看着像每次都改，误导幂等判断。
    stat = {'scan': 0, 'add': 0}

    def add_aria(m):
        stat['scan'] += 1
        attrs = m.group(1)
        if 'aria-label' in attrs:
            return m.group(0)
        stat['add'] += 1
        return '<button' + attrs + ' aria-label="Practise this line with Nono">\U0001f43c</button>'

    idx = re.sub(r'<button([^>]*?)>\U0001f43c</button>', add_aria, idx)
    print('  [%s]   \U0001f43c 按钮：扫描 %d 处，本次新补 %d 处'
          % ('ok' if stat['add'] else 'skip', stat['scan'], stat['add']))
    return idx


# ═════════════════════ M13：sw.js 回落策略 ═════════════════════
def fix_m13(sw):
    print('M13   sw.js offline fallback')
    old = """      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });"""
    new = """      return caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        /* v0.23.8（UX 评审 M13）：只给「文档导航」回落 app shell。
           旧实现无条件回落 index.html —— 于是 data/strokes/*.json、vendor/*.js、
           data/flashcards.*.json 抓不到时也拿到一坨 HTML，上层 r.json() 抛
           `Unexpected token '<'`，用户看到的是解析错误而不是「离线不可用」。
           数据/脚本请求改为直接失败，让调用方走自己的降级文案。 */
        var acc = e.request.headers.get('accept') || '';
        var isDoc = e.request.mode === 'navigate' || acc.indexOf('text/html') > -1;
        return isDoc ? caches.match('./index.html') : Response.error();
      });"""
    return sub_once(sw, old, new, 'fallback')


# ═════════════════════ M14：限流阈值 ═════════════════════
def fix_m14(wrk):
    print('M14   rate limit per IP')
    old = 'const RATE_MAX = 40;'
    new = 'const RATE_MAX = 120;'
    if old in wrk:
        assert wrk.count(old) == 1, 'RATE_MAX 锚点不唯一'
        wrk = wrk.replace(old, new, 1)
        print('  [ok]   40 \u2192 120')
    else:
        assert 'const RATE_MAX = 120;' in wrk, 'RATE_MAX 锚点未命中'
        print('  [skip] 已是 120')

    # 注释也要跟着改，否则「最多 40 次」会把后来的人带偏
    oldc = re.search(r'^const RATE_MAX = 120;.*$', wrk, re.M)
    assert oldc, '找不到 RATE_MAX 行'
    newc = ('const RATE_MAX = 120;         // \u6bcf IP \u7a97\u53e3\u5185\u6700\u591a 120 \u6b21\u3002'
            'v0.23.8\uff08UX \u8bc4\u5ba1 M14\uff09\uff1a\u539f\u4e3a 40 \u2014\u2014 \u516c\u53f8/\u6821\u56ed\u7f51\u5171\u4eab\u51fa\u53e3\n'
            '                              // \u591a\u7528\u6237\u4f1a\u4e92\u76f8\u6324\u6389\u3002'
            '\u9632\u5237\u4ecd\u7531 Origin allowlist + DO \u5f3a\u4e00\u81f4\u8ba1\u6570\u627f\u62c5\uff0c'
            '\u5355\u7528\u6237\u6b63\u5e38\u4f7f\u7528\u8fdc\u4e0d\u4f1a\u5230 120\u3002')
    if 'v0.23.8\uff08UX \u8bc4\u5ba1 M14\uff09' in wrk:
        print('  [skip] 注释已是新版')
    else:
        wrk = wrk[:oldc.start()] + newc + wrk[oldc.end():]
        print('  [ok]   \u6ce8\u91ca\u5df2\u540c\u6b65')
    return wrk


# ═════════════════════ L3：Sentences 完成提示 ═════════════════════
L3_KEY = 'That is the whole set \u2014 back to the first one. Nice work!'
L3_TR = {
    'zh': '\u8fd9\u4e00\u7ec4\u7ec3\u5b8c\u4e86 \u2014\u2014 \u56de\u5230\u7b2c\u4e00\u9898\u3002\u505a\u5f97\u597d\uff01',
    'es': 'Ese era el \u00faltimo \u2014 volvemos al primero. \u00a1Buen trabajo!',
    'ru': '\u042d\u0442\u043e \u0431\u044b\u043b\u0430 \u0432\u0441\u044f \u0441\u0435\u0440\u0438\u044f \u2014 \u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043c\u0441\u044f \u043a \u043f\u0435\u0440\u0432\u043e\u0439. \u041e\u0442\u043b\u0438\u0447\u043d\u0430\u044f \u0440\u0430\u0431\u043e\u0442\u0430!',
    'vi': 'H\u1ebft c\u1ea3 b\u1ed9 r\u1ed3i \u2014 quay l\u1ea1i c\u00e2u \u0111\u1ea7u nh\u00e9. L\u00e0m t\u1ed1t l\u1eafm!',
    'id': 'Itu tadi seluruh setnya \u2014 kembali ke yang pertama. Kerja bagus!',
    'th': '\u0e19\u0e31\u0e48\u0e19\u0e04\u0e37\u0e2d\u0e0a\u0e38\u0e14\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14 \u2014 \u0e01\u0e25\u0e31\u0e1a\u0e44\u0e1b\u0e02\u0e49\u0e2d\u0e41\u0e23\u0e01 \u0e40\u0e01\u0e48\u0e07\u0e21\u0e32\u0e01!',
}


def fix_l3(idx):
    print('L3    Sentences wrap-around notice')
    old = """function sentNext(){
  var list = (SENT_TEMPLATES && SENT_TEMPLATES[SENT_MODE]) || [];
  if(!list.length) return;
  SENT_IDX = (SENT_IDX + 1) % list.length;
  renderSentence();
}"""
    new = ("function sentNext(){\n"
           "  var list = (SENT_TEMPLATES && SENT_TEMPLATES[SENT_MODE]) || [];\n"
           "  if(!list.length) return;\n"
           "  var wasLast = SENT_IDX >= list.length - 1;   /* v0.23.8\uff08UX \u8bc4\u5ba1 L3\uff09 */\n"
           "  SENT_IDX = (SENT_IDX + 1) % list.length;\n"
           "  renderSentence();\n"
           "  /* v0.23.8\uff08UX \u8bc4\u5ba1 L3\uff09\uff1a\u505a\u5230\u6700\u540e\u4e00\u9898\u4f1a\u65e0\u58f0\u7ed5\u56de\u7b2c\u4e00\u9898\uff0c\n"
           "     \u770b\u8d77\u6765\u50cf\u5361\u4f4f\u4e86\u3002\u53ea\u5728\u771f\u7684\u7ed5\u56de\u65f6\u8bf4\u4e00\u58f0\uff08\u4e0d\u662f\u6bcf\u6362\u4e00\u9898\u90fd\u5f39\uff09\u3002 */\n"
           "  if(wasLast) toast(T('" + L3_KEY + "'));\n"
           "}")
    idx = sub_once(idx, old, new, 'sentNext')
    return idx


def fix_l3_dicts():
    print('L3    \u5b57\u5178\u52a0 1 \u6761\uff08\u00d7 6 \u8bed\u8a00\uff09')
    for l in LANGS:
        p = os.path.join(APP, 'langs', l + '.json')
        s = read(p)
        if ('"%s"' % L3_KEY) in s:
            print('  [skip] %s' % l)
            continue
        assert s.rstrip().endswith('}'), '%s \u672b\u5c3e\u4e0d\u662f }' % l
        # 定位「最后一个 value 行」：倒数第二个非空行的末尾补逗号
        i = s.rstrip().rfind('\n')
        head, tail = s[:i], s[i:]          # head 以最后一个字段行结尾，tail 是 "\n}"
        head = head.rstrip() + ','
        val = L3_TR[l]
        assert val, l
        out = head + '\n  ' + json.dumps(L3_KEY, ensure_ascii=False) + ': ' + json.dumps(val, ensure_ascii=False) + tail
        write(p, out)
        # 立刻回读校验（防脚本写入编码事故）
        back = json.loads(read(p))
        assert back.get(L3_KEY) == val, '%s \u56de\u8bfb\u5931\u8d25\uff1a%r' % (l, back.get(L3_KEY))
        print('  [ok]   %s  %s' % (l, val))


# ═════════════════════ L6：S.days 上限 ═════════════════════
def fix_l6(idx, wrk):
    print('L6    S.days upper bound')
    old = '  if(S.days.indexOf(d)===-1){ S.days.push(d); }'
    new = (old + '\n'
           '  /* v0.23.8\uff08UX \u8bc4\u5ba1 L6\uff09\uff1a\u65e5\u671f\u6570\u7ec4\u8bbe 400 \u5929\u4e0a\u9650\u3002'
           '\u5206\u4eab\u5361\u70ed\u529b\u56fe\u53ea\u770b\u6700\u8fd1 14 \u5929\u3001MAU \u770b 30 \u5929\uff0c\n'
           '     400 \u5929\u8fdc\u8d85\u4efb\u4f55\u7528\u9014\uff1b\u4e0d\u8bbe\u9650\u5219\u4e00\u5e74 365 \u6761\u53ea\u589e\u4e0d\u51cf\u3002 */\n'
           '  if(S.days.length > 400) S.days = S.days.slice(-400);')
    idx = sub_once(idx, old, new, 'index S.days')

    o2 = '  if (s.days.indexOf(today) < 0) s.days.push(today);'
    n2 = (o2 + '\n'
          '  // v0.23.8\uff08UX \u8bc4\u5ba1 L6\uff09\uff1a\u4e0e\u524d\u7aef\u540c\u53e3\u5f84\uff0c\u65e5\u671f\u6570\u7ec4\u4e0a\u9650 400 \u5929\n'
          '  if (s.days.length > 400) s.days = s.days.slice(-400);')
    wrk = sub_once(wrk, o2, n2, 'worker s.days')
    return idx, wrk


if __name__ == '__main__':
    print('APP =', APP)
    idx, sw, wrk = read(IDX), read(SW), read(WRK)

    idx = fix_m12(idx)
    sw = fix_m13(sw)
    wrk = fix_m14(wrk)
    idx = fix_l3(idx)
    fix_l3_dicts()
    idx, wrk = fix_l6(idx, wrk)

    write(IDX, idx)
    write(SW, sw)
    write(WRK, wrk)
    print('\n\u5199\u76d8\u5b8c\u6210\uff1aindex.html %d B | sw.js %d B | _worker.js %d B'
          % (len(idx.encode('utf-8')), len(sw.encode('utf-8')), len(wrk.encode('utf-8'))))
