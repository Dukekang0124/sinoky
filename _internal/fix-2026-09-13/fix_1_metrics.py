# -*- coding: utf-8 -*-
"""
v0.23.8 修复批次 · 组 1：度量闭环（审计 P0-2 + P0-3）

审计缺口：
  P0-2  MAU 埋点从未实现      → summarizeStats() 只算 DAU，没有 7/30 天活跃窗口
  P0-3  真实设备 vs 自测不可区分 → 27 台里真实占比未知

改动文件（均在 sinoky-app/）：
  index.html   新增 SELF_SRC（URL 带一次 ?src=test 即永久生效，?src=real 可清除）
               + buildStat() 回报带 src
  _worker.js   recordStat 记 src（test 不可逆）+ 幂等签名 sig 含 src
               + summarizeStats 重写（加 mau7/mau30 + real 真实口径）
  stats.html   看板加「真实 vs 自测」与 MAU 卡片

隐私口径（与既有写库红线一致）：
  新增字段只有 src: 'test' | 'real' 两个字符串常量，不含任何身份/内容信息；
  MAU 是「读时聚合」—— 复用 summarizeStats 既有的全表遍历，零新增 KV 写。

幂等：以标记块先删后插；summarizeStats 以函数锚点整段替换。
用法：python fix_1_metrics.py [--reapply]
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(os.path.dirname(HERE))          # .../sinoky-app
IDX = os.path.join(APP, 'index.html')
WRK = os.path.join(APP, '_worker.js')
STA = os.path.join(APP, 'stats.html')

MARK_A = 'v0.23.8 FIX \u00b7 \u81ea\u6d4b\u8bbe\u5907\u6807\u8bb0'
MARK_END = 'v0.23.8 FIX end'


def read(p):
    with open(p, 'r', encoding='utf-8', newline='') as f:
        s = f.read()
    return s.replace('\r\n', '\n').replace('\r', '\n')   # 项目红线：纯 LF


def write(p, s):
    # 项目红线：源文件必须是纯 LF（CRLF 会破坏注入块与结构断言）
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def drop_block(s, start_mark, end_mark):
    """删掉 [start_mark 所在注释块, end_mark 所在注释块] 整段（含前后空白行收敛）。"""
    i = s.find(start_mark)
    if i < 0:
        return s, False
    # 回溯到该行行首（前面可能是 '/* ' 或 '<!-- '）
    ls = s.rfind('\n', 0, i)
    ls = 0 if ls < 0 else ls + 1
    j = s.find(end_mark, i)
    assert j > 0, '\u627e\u5230\u8d77\u59cb\u6807\u8bb0\u4f46\u627e\u4e0d\u5230\u7ed3\u675f\u6807\u8bb0'
    le = s.find('\n', j)
    le = len(s) if le < 0 else le + 1
    # \u541e\u6389\u7d27\u8ddf\u5176\u540e\u7684\u7a7a\u884c\uff1a\u5426\u5219\u6bcf\u91cd\u63d2\u4e00\u6b21\u5c31\u591a\u4e00\u4e2a\u6362\u884c\uff08\u4f2a\u5e42\u7b49 +1B/\u6b21\uff09
    while s.startswith('\n', le):
        le += 1
    return s[:ls] + s[le:], True


# ─────────────────────────── 1. index.html ───────────────────────────
SELF_BLOCK = """/* ===== v0.23.8 FIX \u00b7 \u81ea\u6d4b\u8bbe\u5907\u6807\u8bb0\uff08\u5ba1\u8ba1 P0-3\uff09=====
   \u95ee\u9898\uff1a\u770b\u677f\u4e0a\u7684\u201c\u8bbe\u5907\u6570 / \u7559\u5b58 / \u5317\u6781\u661f\u201d\u91cc\u6df7\u7740\u6211\u81ea\u5df1\u7684\u6d4b\u8bd5\u673a\uff0c
        \u770b\u4e0d\u51fa\u771f\u5b9e\u7528\u6237\u5230\u5e95\u6709\u51e0\u4e2a \u21d2 \u6240\u6709\u7ed3\u8bba\u90fd\u53ef\u80fd\u662f\u81ea\u5df1\u5237\u51fa\u6765\u7684\u3002
   \u505a\u6cd5\uff1aURL \u5e26\u4e00\u6b21 ?src=test \u5373\u6c38\u4e45\u751f\u6548\uff08\u5b58\u672c\u5730\uff09\uff0c?src=real \u53ef\u6e05\u9664\u3002
        \u4e0a\u62a5\u53ea\u591a\u4e00\u4e2a 'test'/'real' \u5b57\u7b26\u4e32\uff0c\u4e0d\u542b\u4efb\u4f55\u8eab\u4efd\u6216\u5185\u5bb9\u4fe1\u606f\uff1b\u96f6\u65b0\u589e\u8bf7\u6c42\u3001\u96f6 KV \u5199\u3002
   \u7528\u6cd5\uff1a\u5f00\u4e00\u6b21 https://sinoky.pages.dev/?src=test \u5c31\u884c\uff08\u4e4b\u540e\u5e26\u4e0d\u5e26\u53c2\u6570\u90fd\u7b97\u81ea\u6d4b\uff09\u3002 */
var SELF_SRC = 'real';
try {
  if (lsGet('sinoky_self') === '1') SELF_SRC = 'test';
  var _srcQ = (location.search.match(/[?&]src=(test|real)(?:&|$)/) || [])[1];
  if (_srcQ === 'test') { lsSet('sinoky_self', '1'); SELF_SRC = 'test'; }
  else if (_srcQ === 'real') { lsSet('sinoky_self', ''); SELF_SRC = 'real'; }
} catch (e) { /* \u8bfb\u4e0d\u4e86\u5c31\u9ed8\u8ba4 real */ }
/* ===== v0.23.8 FIX end ===== */

"""


def patch_index(reapply):
    s = read(IDX)
    s, dropped = drop_block(s, MARK_A, MARK_END)
    if dropped:
        print('[index] \u65e7 SELF_SRC \u5757\u5df2\u79fb\u9664\uff08\u91cd\u65b0\u63d2\u5165\uff09')

    anchor = 'function buildStat(){'
    assert s.count(anchor) == 1, '\u9501\u5b9a buildStat \u5931\u8d25\uff08\u547d\u4e2d %d \u6b21\uff09' % s.count(anchor)
    s = s.replace(anchor, SELF_BLOCK + anchor, 1)

    o1 = ("    return { phrases: phrases, scenes: scenes, tone: (S.tone && S.tone.total) || 0, "
          "day1Done: day1Done, feat: S.feat || {} };")
    n1 = ("    return { phrases: phrases, scenes: scenes, tone: (S.tone && S.tone.total) || 0, "
          "day1Done: day1Done, feat: S.feat || {}, src: SELF_SRC };")
    if o1 in s:
        assert s.count(o1) == 1, 'buildStat \u4e3b return \u547d\u4e2d %d \u6b21' % s.count(o1)
        s = s.replace(o1, n1, 1)
    else:
        assert n1 in s, 'buildStat \u4e3b return \u951a\u70b9\u672a\u547d\u4e2d\uff08\u65e7\u5f62/\u65b0\u5f62\u90fd\u4e0d\u5728\uff09'

    o2 = "  }catch(e){ return { phrases: 0, scenes: {}, tone: 0, day1Done: false, feat: {} }; }"
    n2 = "  }catch(e){ return { phrases: 0, scenes: {}, tone: 0, day1Done: false, feat: {}, src: 'real' }; }"
    if o2 in s:
        assert s.count(o2) == 1, 'buildStat catch return \u547d\u4e2d %d \u6b21' % s.count(o2)
        s = s.replace(o2, n2, 1)
    else:
        assert n2 in s, 'buildStat catch return \u951a\u70b9\u672a\u547d\u4e2d'

    write(IDX, s)
    print('[index] OK  %d B' % len(s.encode('utf-8')))


# ─────────────────────────── 2. _worker.js ───────────────────────────
NEW_SUMMARIZE = '''async function summarizeStats(env) {
  const DAY = 86400000;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const list = await env.PROFILES.list({ prefix: 's:' });
  const keys = (list && list.keys) || [];

  let users = 0, dau = 0, phraseSum = 0, toneUsers = 0, day1Users = 0;
  let e1 = 0, r1 = 0, e3 = 0, r3 = 0, e7 = 0, r7 = 0, firstDayDone = 0;
  const sceneDist = {};
  const featDist = {};   /* v0.3.36 功能使用分布 */

  /* v0.23.8 FIX（\u5ba1\u8ba1 P0-2 / P0-3）\uff1a
     - MAU\uff1a\u6700\u8fd1 7 / 30 \u4e2a\u81ea\u7136\u65e5\u5185\u81f3\u5c11\u6d3b\u8dc3 1 \u5929\uff08\u6d3b\u8dc3\u65e5 = days \u6570\u7ec4\uff09\u3002
       \u8fd9\u662f\u201c\u8bfb\u65f6\u805a\u5408\u201d\u2014\u2014\u590d\u7528\u672c\u51fd\u6570\u65e2\u6709\u7684\u5168\u8868\u904d\u5386\uff0c**\u96f6\u65b0\u589e KV \u5199**\u3002
     - real \u771f\u5b9e\u53e3\u5f84\uff1a\u628a\u81ea\u6d4b\u673a\uff08src=test\uff09\u4ece\u6bd4\u7387\u91cc\u5254\u9664\u3002
       \u5426\u5219\u81ea\u5df1\u5728\u81ea\u5df1\u673a\u5668\u4e0a\u5237\u7684\u6570\u5b57\u4f1a\u5047\u88c5\u6210\u7528\u6237\u884c\u4e3a\uff0c\u5224\u505c\u7ebf\u5c31\u662f\u81ea\u6b3a\u3002 */
  const dayAgo = (n) => new Date(now - n * DAY).toISOString().slice(0, 10);
  const c7 = dayAgo(6), c30 = dayAgo(29);   /* \u542b\u4eca\u5929\u5171 7 / 30 \u5929 */
  let mau7 = 0, mau30 = 0, mau7Real = 0, mau30Real = 0;
  let usersReal = 0, usersTest = 0, dauReal = 0, day1Real = 0, toneReal = 0, phraseSumReal = 0;

  for (const k of keys) {
    const raw = await env.PROFILES.get(k.name);
    if (!raw) continue;
    let s; try { s = JSON.parse(raw); } catch (e) { continue; }
    users++;
    const isTest = String(s.src || '') === 'test';
    if (isTest) usersTest++; else usersReal++;
    const days = Array.isArray(s.days) ? s.days : [];
    if (days.indexOf(today) >= 0) { dau++; if (!isTest) dauReal++; }
    const ph = Number(s.phrases) || 0;
    phraseSum += ph;
    if (!isTest) phraseSumReal += ph;
    if ((Number(s.tone) || 0) > 0) { toneUsers++; if (!isTest) toneReal++; }
    if (s.day1Done) { day1Users++; if (!isTest) day1Real++; }
    if (s.scenes) for (const sc in s.scenes) sceneDist[sc] = (sceneDist[sc] || 0) + (Number(s.scenes[sc]) || 0);
    if (s.feat) for (const f in s.feat) featDist[f] = (featDist[f] || 0) + (Number(s.feat[f]) || 0);

    /* MAU\uff1adays \u91cc\u6709\u65e0\u6d3b\u8dc3\u65e5\u843d\u5728\u7a97\u53e3\u5185\u3002
       'YYYY-MM-DD' \u7684\u5b57\u5178\u5e8f\u5373\u65f6\u95f4\u5e8f \u21d2 \u76f4\u63a5\u6bd4\u5b57\u7b26\u4e32\uff08\u907f\u5f00 Date \u89e3\u6790\uff09\u3002 */
    let a7 = false, a30 = false;
    for (const d of days) {
      if (d >= c7) { a7 = true; a30 = true; break; }
      if (d >= c30) a30 = true;
    }
    if (a7) { mau7++; if (!isTest) mau7Real++; }
    if (a30) { mau30++; if (!isTest) mau30Real++; }

    const first = Number(s.first) || 0;
    if (!first) continue;
    const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
    const inDays = (offset) => days.indexOf(dayOf(first + offset * DAY)) >= 0;
    // \u6ee1 N \u5929\u624d\u8ba1\u5165\u5206\u6bcd\uff08eligible\uff09\uff0c\u5426\u5219\u65b0\u7528\u6237\u4f1a\u628a\u7559\u5b58\u7387\u62c9\u4f4e\u3001\u5f97\u51fa\u9519\u8bef\u7ed3\u8bba
    if (now - first >= 1 * DAY) { e1++; if (inDays(1)) r1++; }
    if (now - first >= 3 * DAY) { e3++; if (inDays(3)) r3++; }
    if (now - first >= 7 * DAY) { e7++; if (inDays(7)) r7++; }
    // \u9996\u65e5\u5b8c\u6210\u9996\u6b21\u6311\u6218\uff1a\u5f00\u53e3\u65f6\u95f4\u8ddd\u9996\u6b21\u6d3b\u8dc3 \u22641 \u5929
    if (s.firstPhraseAt && (Number(s.firstPhraseAt) - first) <= DAY && (now - first) >= 1 * DAY) firstDayDone++;
  }

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);   // \u5206\u6bcd\u4e3a 0 \u65f6\u8fd4\u56de null\uff08\u800c\u4e0d\u662f\u5047\u7684 0%\uff09
  const d1 = pct(r1, e1), d3 = pct(r3, e3), d7 = pct(r7, e7);
  const ppu = users ? Math.round((phraseSum / users) * 10) / 10 : 0;
  const fdr = pct(firstDayDone, e1), tur = pct(toneUsers, users);

  /* v0.23.8\uff1a\u771f\u5b9e\u53e3\u5f84\uff08\u6392\u9664\u81ea\u6d4b\u673a\uff09—\u2014 \u5224\u505c\u7ebf\u53ea\u8be5\u770b\u8fd9\u4e00\u7ec4 */
  const rUsers = usersReal;
  const rPpu = rUsers ? Math.round((phraseSumReal / rUsers) * 10) / 10 : 0;
  const rDay1 = pct(day1Real, rUsers);

  return {
    ok: true, asOf: new Date(now).toISOString(),
    users, dau, phraseSum,
    mau7, mau30,
    real: {
      users: usersReal, test: usersTest, dau: dauReal,
      mau7: mau7Real, mau30: mau30Real,
      phrasesPerUser: rPpu, day1DoneRate: rDay1, toneUsageRate: pct(toneReal, rUsers),
      note: 'real = \u6392\u9664 src=test \u7684\u81ea\u6d4b\u8bbe\u5907\uff1b\u672c\u673a\u81ea\u6d4b\u8bf7\u7528 ?src=test \u6253\u5f00\u4e00\u6b21\uff08\u6c38\u4e45\u751f\u6548\uff09'
    },
    retention: {
      d1: d1, d3: d3, d7: d7,
      eligible: { d1: e1, d3: e3, d7: e7 },   // \u5206\u6bcd\uff1a\u6ee1\u5bf9\u5e94\u5929\u6570\u7684\u7528\u6237\u6570
      note: '\u7559\u5b58\u5728"\u6ee1 N \u5929"\u7684\u7528\u6237\u91cc\u7b97\uff0c\u5206\u6bcd\u968f\u5185\u6d4b\u63a8\u8fdb\u9010\u6e10\u53d8\u5927'
    },
    northStar: { phrasesPerUser: ppu, target: 10 },
    toneUsageRate: tur,
    firstDayCompletionRate: fdr,
    day1DoneRate: pct(day1Users, users),
    sceneDist,
    featDist,
    // \u5224\u505c\u7ebf\uff08OB \u00a76.2\uff09\u4e00\u773c\u5bf9\u7167\uff1bnull \u8868\u793a\u6837\u672c\u8fd8\u4e0d\u591f\uff0c\u522b\u6025\u7740\u4e0b\u7ed3\u8bba
    gate: {
      d7:        { target: 15, actual: d7,  pass: d7  !== null && d7  >= 15, enough: e7  > 0 },
      northStar: { target: 10, actual: ppu, pass: ppu >= 10,                enough: users > 0 },
      firstDay:  { target: 60, actual: fdr, pass: fdr !== null && fdr >= 60, enough: e1  > 0 },
      tone:      { target: 40, actual: tur, pass: tur !== null && tur >= 40, enough: users > 0 }
    }
  };
}


'''


def patch_worker(reapply):
    s = read(WRK)

    o = "  let s = { first: 0, last: 0, days: [], phrases: 0, tone: 0, day1Done: false, scenes: {} };"
    n = "  let s = { first: 0, last: 0, days: [], phrases: 0, tone: 0, day1Done: false, scenes: {}, src: '' };"
    if o in s:
        assert s.count(o) == 1
        s = s.replace(o, n, 1)
        print('[worker] recordStat \u521d\u59cb\u5bf9\u8c61\u52a0 src')
    else:
        assert n in s, 'recordStat \u521d\u59cb\u5bf9\u8c61\u951a\u70b9\u672a\u547d\u4e2d'

    o = "  if (st.day1Done) s.day1Done = true;\n"
    n = ("  if (st.day1Done) s.day1Done = true;\n"
         "  /* v0.23.8 FIX\uff1a\u81ea\u6d4b\u8bbe\u5907\u6807\u8bb0\u3002src=test \u4e0d\u53ef\u9006\u2014\u2014\u81ea\u6d4b\u673a\u4e0d\u4f1a\u201c\u53d8\u56de\u201d\u771f\u5b9e\u7528\u6237\uff0c\n"
         "     \u5426\u5219\u4e00\u6b21\u8bef\u70b9 ?src=real \u5c31\u628a\u5386\u53f2\u81ea\u6d4b\u6570\u636e\u6d17\u6210\u771f\u5b9e\u6570\u636e\u3002 */\n"
         "  if (String(st.src || '') === 'test') s.src = 'test';\n"
         "  else if (!s.src) s.src = 'real';\n")
    if o + "  /* v0.23.8 FIX" not in s:
        assert s.count(o) == 1, 'day1Done \u951a\u70b9\u547d\u4e2d %d \u6b21' % s.count(o)
        s = s.replace(o, n, 1)
        print('[worker] recordStat \u8bb0 src')
    else:
        print('[worker] recordStat \u8bb0 src \u5df2\u5b58\u5728\uff0c\u8df3\u8fc7')

    o = ("  const sig = (o) => JSON.stringify([\n"
         "    o.phrases || 0, o.tone || 0, !!o.day1Done,\n"
         "    o.feat || {}, o.scenes || {}, (o.days || []).slice().sort()\n"
         "  ]);")
    n = ("  const sig = (o) => JSON.stringify([\n"
         "    o.phrases || 0, o.tone || 0, !!o.day1Done,\n"
         "    o.feat || {}, o.scenes || {}, (o.days || []).slice().sort(),\n"
         "    o.src || ''   /* v0.23.8\uff1a\u81ea\u6d4b\u6807\u8bb0\u53d8\u5316\u4e5f\u8981\u843d\u76d8 */\n"
         "  ]);")
    if o in s:
        assert s.count(o) == 1
        s = s.replace(o, n, 1)
        print('[worker] sig \u52a0 src')
    else:
        assert "o.src || ''   /* v0.23.8" in s, 'sig \u951a\u70b9\u672a\u547d\u4e2d'
        print('[worker] sig \u5df2\u542b src\uff0c\u8df3\u8fc7')

    i = s.find('async function summarizeStats(env) {')
    assert i > 0, '\u627e\u4e0d\u5230 summarizeStats'
    j = s.find('/* ===== v0.14.7 \u8bfa\u8bfa\u81ea\u7531\u5bf9\u8bdd', i)
    assert j > i, '\u627e\u4e0d\u5230 summarizeStats \u4e0b\u754c'
    s = s[:i] + NEW_SUMMARIZE + s[j:]
    print('[worker] summarizeStats \u5df2\u91cd\u5199')

    write(WRK, s)
    print('[worker] OK  %d B' % len(s.encode('utf-8')))


# ─────────────────────────── 3. stats.html ───────────────────────────
CARD_BLOCK = """    <h2>Real vs self-test <span style="text-transform:none;font-weight:400;color:#6b7f94">mark a test device: open with ?src=test once</span></h2>
    <div class="grid">
      <div class="card"><div class="n" id="rusers">&#8212;</div><div class="l">Real users</div><div class="h">excludes self-test</div></div>
      <div class="card"><div class="n" id="tusers">&#8212;</div><div class="l">Self-test devices</div></div>
      <div class="card"><div class="n" id="rmau30">&#8212;</div><div class="l">MAU 30d (real)</div><div class="h">monthly active</div></div>
      <div class="card"><div class="n" id="rmau7">&#8212;</div><div class="l">MAU 7d (real)</div><div class="h">weekly active</div></div>
      <div class="card"><div class="n" id="mau30">&#8212;</div><div class="l">MAU 30d (all)</div></div>
      <div class="card"><div class="n" id="mau7">&#8212;</div><div class="l">MAU 7d (all)</div></div>
      <div class="card"><div class="n" id="rppu">&#8212;</div><div class="l">Phrases / real user</div><div class="h">north star, clean</div></div>
      <div class="card"><div class="n" id="rday1">&#8212;</div><div class="l">Finished Day 1 (real)</div></div>
    </div>

"""

JS_BLOCK = """
  /* v0.23.8 FIX\uff1a\u771f\u5b9e\u53e3\u5f84\uff08\u6392\u9664 src=test \u81ea\u6d4b\u8bbe\u5907\uff09+ MAU \u7a97\u53e3 */
  (function(){
    var R = j.real || {};
    function num(id, v){ document.getElementById(id).textContent = (v == null ? '\u2014' : v); }
    function pctOf(id, v){ document.getElementById(id).textContent = (v == null ? '\u2014' : v + '%'); }
    num('rusers', R.users); num('tusers', R.test);
    num('rmau30', R.mau30); num('rmau7', R.mau7);
    num('mau30', j.mau30);  num('mau7', j.mau7);
    num('rppu', R.phrasesPerUser); pctOf('rday1', R.day1DoneRate);
  })();
"""


def patch_stats(reapply):
    s = read(STA)

    anchor = '    <h2>Retention (only counts users old enough)</h2>'
    assert s.count(anchor) == 1, 'stats \u951a\u70b9\uff08Retention\uff09\u672a\u547d\u4e2d'
    if 'id="rusers"' in s:
        print('[stats] \u5f00\u7247\u5757\u5df2\u5b58\u5728\uff0c\u8df3\u8fc7')
    else:
        s = s.replace(anchor, CARD_BLOCK + anchor, 1)
        print('[stats] \u5f00\u7247\u5757\u5df2\u63d2\u5165')

    janchor = "  setRet('d1', r.d1, e.d1); setRet('d3', r.d3, e.d3); setRet('d7', r.d7, e.d7);"
    assert s.count(janchor) == 1, 'stats JS \u951a\u70b9\u672a\u547d\u4e2d'
    if "num('rusers'" in s:
        print('[stats] \u6e32\u67d3 JS \u5df2\u5b58\u5728\uff0c\u8df3\u8fc7')
    else:
        s = s.replace(janchor, janchor + JS_BLOCK, 1)
        print('[stats] \u6e32\u67d3 JS \u5df2\u63d2\u5165')

    write(STA, s)
    print('[stats] OK  %d B' % len(s.encode('utf-8')))


if __name__ == '__main__':
    print('APP =', APP)
    patch_index('--reapply' in sys.argv)
    patch_worker('--reapply' in sys.argv)
    patch_stats('--reapply' in sys.argv)
    print('\\n\u5b8c\u6210\u3002\u5efa\u8bae\u63a5\u7740\u8dd1\uff1anode --check _worker.js')
