#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sinoky v0.23.8 FIX · 组 6：错误上报断点 + 漏斗四步埋点（审计 P3-13）

════════════════════════════════════════════════════════════════════════
先说一个被审计漏掉的事实：错误捕获**早就有了**
════════════════════════════════════════════════════════════════════════
index.html L5962-5974（v0.3.8 起）：
    window.addEventListener('error',              → logErr('error',  …))
    window.addEventListener('unhandledrejection', → logErr('promise',…))
    logErr → ERR_LOG（localStorage 'sinoky-errs'，上限 20 条）
注释自陈：「老外遇到 JS 崩溃我们看不到，**只能靠这里存下来随反馈一起发**」

⇒ 真正的缺口不是「没捕获」，是**上报路径断了**：
   错误只躺在用户浏览器里，只有用户**主动提交反馈**时才被带走 ——
   而恰好是崩溃的用户不会去提交反馈。这是典型的「选择偏差采样」。

════════════════════════════════════════════════════════════════════════
为什么不按原方案做（window.onerror → /api/err → Analytics Engine）
════════════════════════════════════════════════════════════════════════
原方案要 ① 在 CF Pages 加 Analytics Engine binding（**人工后台动作**）
        ② 新增一条上报通道（每条错误一次 POST）
而项目红线是「**每天 1000 KV 写，不能涨**」。本组改用**更省的等价方案**：

    把计数塞进「本来就在发的 stat」—— /api/profile 每次已经带 buildStat()，
    后端在 summarizeStats() 里**读时聚合**。
    ⇒ 零新增请求、零新增 KV 键、零新增写配额压力。

**配额细节（值得记）**：漏斗四位每一位一生只从 0→1 一次（≤4 次状态变化），
错误数则用**粗桶**进 sig：0 / 1-2 / 3-9 / ≥10 四档。
否则「每多一条错误就多一次 KV 写」——错误越多写得越勤，正好在系统最脆弱时加压。

════════════════════════════════════════════════════════════════════════
漏斗四步的定义（对应产品的核心回路，不是随便挑的四个点）
════════════════════════════════════════════════════════════════════════
    open     打开了 App                ← 每次启动
    heard    听到过中文发音            ← speak() / playToneAudio() 真的播了
    spoke    开口说了（录音进 ASR）     ← asrText() —— 所有录音路径的唯一收口
    verified 被成功判分过              ← renderScore() —— 只有判分成功才会被调用

钩子位置的选择理由：
  · heard 挂 speak() + playToneAudio()：这两条是**全部**中文发音的出口
  · spoke 挂 asrText()：reader / 场景跟读 / 诺诺跟读 / 自由聊天四条录音路径**都**经过它
    （挂 MediaRecorder 会有 5 个 rec.start() 要改；挂这里只要 1 处，且语义更准：
      录音了但没送到 ASR 不算「开口」）
  · verified 挂 renderScore()：它只接受成功响应（错误分支显示 score-err，不走这里）

════════════════════════════════════════════════════════════════════════
存储位置：localStorage，**不进 S**
════════════════════════════════════════════════════════════════════════
不进 S 的理由：S 会被整体 put 到 p:<uid>，且服务端对已知字段做 max 合并；
塞进新嵌套对象有与合并逻辑互相干扰的风险。用独立的 localStorage 键，
buildStat() 读出来附在 stat 上即可 —— 改动面最小、语义最干净。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))
IDX = os.path.join(APP, 'index.html')
WRK = os.path.join(APP, '_worker.js')
STT = os.path.join(APP, 'stats.html')
MARK = 'v0.23.8 FIX'


def read(p):
    with io.open(p, encoding='utf-8', newline='') as f:
        s = f.read()
    return s.replace('\r\n', '\n').replace('\r', '\n')


def write(p, s):
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def sub_once(s, old, new, label):
    if new in s:
        print('  [skip] %s' % label)
        return s
    n = s.count(old)
    assert n >= 1, '%s：锚点未命中' % label
    assert n == 1, '%s：锚点命中 %d 次' % (label, n)
    print('  [ok]   %s' % label)
    return s.replace(old, new, 1)


# ══════════════════════ 前端 ══════════════════════
INFRA = '''
/* ===== v0.23.8 FIX · 错误计数 + 漏斗四步（审计 P3-13）=====
   原方案（window.onerror → /api/err → Analytics Engine writeDataPoint）需要 CF 后台
   加 binding（人工步骤）+ 新增一条上报通道。这里改用「复用已有的节流上报」：
   把计数附在 buildStat() 上，随 /api/profile 一起走，后端读时聚合。
   ⇒ 零新增请求、零新增 KV 键。详见 _internal/fix-2026-09-13/fix_6_metering.py 头注。

   另：错误捕获本身 v0.3.8 就有了（logErr + ERR_LOG），但它只存本地、
   只在用户主动提交反馈时才被带走 —— 而崩溃的用户恰恰不会提交反馈。
   这里补的是断掉的上报路径。 */
var FUNNEL = { open: 0, heard: 0, spoke: 0, verified: 0 };
try { var _fnRaw = lsGet('sinoky-funnel'); if (_fnRaw) FUNNEL = JSON.parse(_fnRaw) || FUNNEL; } catch (e) {}
function funMark(k){
  try { if (FUNNEL[k]) return; FUNNEL[k] = 1; lsSet('sinoky-funnel', JSON.stringify(FUNNEL)); } catch (e) {}
}
funMark('open');                       /* 执行到这里 = App 已成功打开 */

var ERRSTAT = { n: 0, last: '' };
try { var _esRaw = lsGet('sinoky-errstat'); if (_esRaw) ERRSTAT = JSON.parse(_esRaw) || ERRSTAT; } catch (e) {}
'''

FUNNEL_INFRA_ANCHOR = '/* ===== v0.23.8 FIX end ===== */\n'


def fix_front_infra(idx):
    print('F1    漏斗/错误 基建块（index.html）')
    return sub_once(idx, FUNNEL_INFRA_ANCHOR, FUNNEL_INFRA_ANCHOR + INFRA, '基建块')


def fix_hooks(idx):
    print('F2    四个钩子')
    # heard：speak()
    idx = sub_once(idx, 'function speak(text, btn){\n', "function speak(text, btn){\n  funMark('heard');   /* v0.23.8 漏斗：真的播了中文发音 */\n", 'hook speak')
    # heard：playToneAudio()（放行校验之后）
    idx = sub_once(idx,
                   "  var a = AUDIO || (AUDIO = new Audio());\n  try { a.pause(); } catch(e){}\n  a.volume = 1;\n  a.onplaying",
                   "  funMark('heard');   /* v0.23.8 漏斗 */\n  var a = AUDIO || (AUDIO = new Audio());\n  try { a.pause(); } catch(e){}\n  a.volume = 1;\n  a.onplaying",
                   'hook playToneAudio')
    # spoke：asrText()
    idx = sub_once(idx, 'async function asrText(buf, target){\n',
                   "async function asrText(buf, target){\n  /* v0.23.8 漏斗：所有录音路径（reader/场景跟读/诺诺跟读/自由聊天）都经过这里 */\n  funMark('spoke');\n",
                   'hook asrText')
    # verified：renderScore()
    idx = sub_once(idx, 'function renderScore(d){\n',
                   "function renderScore(d){\n  funMark('verified');   /* v0.23.8 漏斗：只有判分成功才会走到这里 */\n",
                   'hook renderScore')
    return idx


def fix_buildstat(idx):
    print('F3    buildStat 带上 funnel + err')
    old = "    return { phrases: phrases, scenes: scenes, tone: (S.tone && S.tone.total) || 0, day1Done: day1Done, feat: S.feat || {}, src: SELF_SRC };"
    new = "    return { phrases: phrases, scenes: scenes, tone: (S.tone && S.tone.total) || 0, day1Done: day1Done, feat: S.feat || {}, src: SELF_SRC,\n             /* v0.23.8 FIX（审计 P3-13）：漏斗四步 + 错误计数。零新增请求，随本条 stat 一起走。 */\n             funnel: FUNNEL, err: ERRSTAT };"
    return sub_once(idx, old, new, 'buildStat return')


def fix_logerr(idx):
    print('F4    logErr 单调计数')
    old = """    if(ERR_LOG.length > 20) ERR_LOG = ERR_LOG.slice(-20);
    localStorage.setItem('sinoky-errs', JSON.stringify(ERR_LOG));
  }catch(e){}"""
    new = """    if(ERR_LOG.length > 20) ERR_LOG = ERR_LOG.slice(-20);
    localStorage.setItem('sinoky-errs', JSON.stringify(ERR_LOG));
    /* v0.23.8 FIX：ERR_LOG 有 20 条上限、且从不上报；这里维护一个**单调计数** +
       最近一条，随 buildStat() 上云（后端读时聚合）。 */
    ERRSTAT.n = (ERRSTAT.n||0) + 1;
    ERRSTAT.last = (kind + ': ' + String(msg)).slice(0, 160);
    lsSet('sinoky-errstat', JSON.stringify(ERRSTAT));
  }catch(e){}"""
    return sub_once(idx, old, new, 'logErr')


# ══════════════════════ 后端 ══════════════════════
def fix_worker(idx_ignored):
    s = read(WRK)
    print('W0    recordStat：修浅拷贝别名（否则新字段永远写不进 KV）')
    s = sub_once(s,
                 "    if (raw) { try { s_before = JSON.parse(raw); s = Object.assign(s, s_before); } catch (e) { /* 脏数据则重建 */ } }",
                 """    if (raw) { try { s_before = JSON.parse(raw); s = Object.assign(s, s_before); } catch (e) { /* 脏数据则重建 */ } }
  /* v0.23.8 FIX（真实缺陷，本轮测试咬出来的）：Object.assign 是**浅拷贝** ——
     s.feat / s.scenes / s.err 这些嵌套对象与 s_before 的同名属性指向**同一个对象**。
     后面原地改 s.err.n 会把 s_before 一起改掉 ⇒ 脏检查
        before = sig(s_before)  与  sig(s)
     恒相等（两边看的是同一块内存）⇒ 这些字段的**单独变化永远触发不了写入**。
     （v0.3.36 / v0.3.39 起就在这个坑上，只是没人验过。）

     这里只隔离**本组新增**的 funnel / err：它们的写放大有上界
     （漏斗每位一生 0→1 一次，共 ≤4 次；错误用 3 档粗桶），不威胁每天 1000 写的配额。
     feat / scenes 的同一缺陷**本轮不动** —— 修它会让「只浏览场景、不说话」的用户
     每次 scene 计数变化都写一次 KV，那是**配额决策**，应交康哥单独拍板。 */
  if (s_before) {
    s.funnel = Object.assign({}, s_before.funnel || {});
    s.err = Object.assign({}, s_before.err || { n: 0, last: '' });
  }""",
                 '浅拷贝别名隔离')
    print('W1    recordStat：合并 funnel / err')
    s = sub_once(s,
                 "  let s = { first: 0, last: 0, days: [], phrases: 0, tone: 0, day1Done: false, scenes: {}, src: '' };",
                 "  let s = { first: 0, last: 0, days: [], phrases: 0, tone: 0, day1Done: false, scenes: {}, src: '', funnel: {}, err: { n: 0, last: '' } };",
                 'recordStat 默认值')
    s = sub_once(s,
                 "  // 首次开口时间：只在 phrases 首次 >0 时记录（用于\"首日完成首次挑战率\"）",
                 """  /* v0.23.8 FIX（审计 P3-13）：漏斗四步 —— OR 合并（走过就是走过）。 */
  if (st.funnel && typeof st.funnel === 'object') {
    s.funnel = s.funnel || {};
    for (const fk of ['open', 'heard', 'spoke', 'verified']) if (st.funnel[fk]) s.funnel[fk] = 1;
  }
  /* 错误计数：n 取 max（幂等）；last 跟随 n 较大的一侧。 */
  if (st.err && typeof st.err === 'object') {
    const en = Math.max(0, Number(st.err.n) || 0);
    s.err = s.err || { n: 0, last: '' };
    if (en > (s.err.n || 0)) { s.err.n = en; if (st.err.last) s.err.last = String(st.err.last).slice(0, 160); }
    else if (!s.err.last && st.err.last) s.err.last = String(st.err.last).slice(0, 160);
  }
  // 首次开口时间：只在 phrases 首次 >0 时记录（用于"首日完成首次挑战率"）""",
                 'recordStat 合并逻辑')
    print('W2    sig 加漏斗 + 错误粗桶')
    s = sub_once(s,
                 """    o.src || ''   /* v0.23.8：自测标记变化也要落盘 */
  ]);""",
                 """    o.src || '',   /* v0.23.8：自测标记变化也要落盘 */
    o.funnel || {},/* v0.23.8：漏斗四位各只从 0→1 一次 ⇒ 一生最多 4 次状态变化 */
    /* v0.23.8（配额纪律）：错误数**必须用粗桶进 sig**。若直接放 n，就会
       「每多一条错误 → 下一次上报多一次 KV 写」——错误越多写得越勤，
       正好在最脆弱的时候加压。四档封顶，写放大上界是常数。 */
    (function (n) { return n === 0 ? 0 : n < 3 ? 1 : n < 10 ? 2 : 3; })((o.err && o.err.n) || 0)
  ]);""",
                 'sig')
    print('W3    summarizeStats：聚合漏斗与错误')
    s = sub_once(s,
                 "  let usersReal = 0, usersTest = 0, dauReal = 0, day1Real = 0, toneReal = 0, phraseSumReal = 0;",
                 """  let usersReal = 0, usersTest = 0, dauReal = 0, day1Real = 0, toneReal = 0, phraseSumReal = 0;

  /* v0.23.8 FIX（审计 P3-13）：漏斗四步 + 错误聚合（同样是读时聚合，零新增写） */
  let fOpen = 0, fHeard = 0, fSpoke = 0, fVerif = 0;
  let fOpenReal = 0, fHeardReal = 0, fSpokeReal = 0, fVerifReal = 0;
  let errDevices = 0, errDevicesReal = 0, errTotal = 0;
  const errTop = {};""",
                 'summarizeStats 累加器')
    s = sub_once(s,
                 "    if (s.feat) for (const f in s.feat) featDist[f] = (featDist[f] || 0) + (Number(s.feat[f]) || 0);",
                 """    if (s.feat) for (const f in s.feat) featDist[f] = (featDist[f] || 0) + (Number(s.feat[f]) || 0);

    /* 漏斗（v0.23.8）：每一步都按"走到过这一步的设备数"计，比率以 open 为分母。 */
    const fu = s.funnel || {};
    if (fu.open)     { fOpen++;     if (!isTest) fOpenReal++; }
    if (fu.heard)    { fHeard++;    if (!isTest) fHeardReal++; }
    if (fu.spoke)    { fSpoke++;    if (!isTest) fSpokeReal++; }
    if (fu.verified) { fVerif++;    if (!isTest) fVerifReal++; }

    /* 错误（v0.23.8）：设备数 / 总次数 / 最近一条的分布（取 top 5） */
    const errN = (s.err && Number(s.err.n)) || 0;
    if (errN > 0) {
      errDevices++; errTotal += errN;
      if (!isTest) errDevicesReal++;
      const em = String((s.err && s.err.last) || 'unknown').slice(0, 80);
      errTop[em] = (errTop[em] || 0) + 1;
    }""",
                 'summarizeStats 累计')
    s = sub_once(s,
                 """    sceneDist,
    featDist,""",
                 """    sceneDist,
    featDist,
    /* v0.23.8 FIX（审计 P3-13）：漏斗四步 + 错误。比率分母统一用 open（"打开过的人里有多少…"）。 */
    funnel: {
      open: fOpen, heard: fHeard, spoke: fSpoke, verified: fVerif,
      heardRate: pct(fHeard, fOpen), spokeRate: pct(fSpoke, fOpen), verifiedRate: pct(fVerif, fOpen),
      note: 'open→heard→spoke→verified；verified = 判分成功过至少一次（唯一非自述的开口证据）'
    },
    funnelReal: {
      open: fOpenReal, heard: fHeardReal, spoke: fSpokeReal, verified: fVerifReal,
      spokeRate: pct(fSpokeReal, fOpenReal), verifiedRate: pct(fVerifReal, fOpenReal),
      note: 'real = 排除 src=test 自测设备'
    },
    errors: {
      devices: errDevices, devicesReal: errDevicesReal, total: errTotal,
      deviceRate: pct(errDevices, users),
      top: Object.keys(errTop).sort((a, b) => errTop[b] - errTop[a]).slice(0, 5)
             .map((k) => ({ msg: k, devices: errTop[k] })),
      note: '设备本地计数随 stat 上云（v0.23.8）；不是实时通道，采样偏差已消除但延迟到下次上报'
    },""",
                 'summarizeStats 返回')
    write(WRK, s)
    return idx_ignored


# ══════════════════════ 看板 ══════════════════════
def fix_stats():
    s = read(STT)
    print('S1    stats.html 新卡')
    s = sub_once(s,
                 "    <h2>Retention (only counts users old enough)</h2>",
                 """    <h2>Funnel <span style="text-transform:none;font-weight:400;color:#6b7f94">of those who opened &middot; real = excludes self-test</span></h2>
    <div class="grid">
      <div class="card"><div class="n" id="fu_open">&#8212;</div><div class="l">Opened</div><div class="h">real: <span id="fu_open_r">&#8212;</span></div></div>
      <div class="card"><div class="n" id="fu_heard">&#8212;</div><div class="l">Heard Chinese</div><div class="h">real: <span id="fu_heard_r">&#8212;</span></div></div>
      <div class="card"><div class="n" id="fu_spoke">&#8212;</div><div class="l">Spoke out loud</div><div class="h">real: <span id="fu_spoke_r">&#8212;</span></div></div>
      <div class="card"><div class="n" id="fu_verif">&#8212;</div><div class="l">Verified by score</div><div class="h">real: <span id="fu_verif_r">&#8212;</span></div></div>
      <div class="card"><div class="n" id="fu_spoke_rate">&#8212;</div><div class="l">Open &rarr; spoke</div><div class="h">all devices</div></div>
      <div class="card"><div class="n" id="fu_verif_rate">&#8212;</div><div class="l">Open &rarr; verified</div><div class="h">all devices</div></div>
      <div class="card"><div class="n" id="fu_spoke_rate_r">&#8212;</div><div class="l">Open &rarr; spoke (real)</div></div>
      <div class="card"><div class="n" id="fu_verif_rate_r">&#8212;</div><div class="l">Open &rarr; verified (real)</div></div>
    </div>

    <h2>Errors <span style="text-transform:none;font-weight:400;color:#6b7f94">reported with stats, not real-time</span></h2>
    <div class="grid">
      <div class="card"><div class="n" id="err_dev">&#8212;</div><div class="l">Devices with errors</div><div class="h">real: <span id="err_dev_r">&#8212;</span></div></div>
      <div class="card"><div class="n" id="err_total">&#8212;</div><div class="l">Total errors caught</div></div>
      <div class="card"><div class="n" id="err_rate">&#8212;</div><div class="l">Devices affected</div><div class="h">share of all users</div></div>
    </div>
    <table><tbody id="errtop"></tbody></table>

    <h2>Retention (only counts users old enough)</h2>""",
                 'stats 新卡')
    print('S2    stats.html 渲染 JS')
    s = sub_once(s,
                 """    num('rppu', R.phrasesPerUser); pctOf('rday1', R.day1DoneRate);
  })();""",
                 """    num('rppu', R.phrasesPerUser); pctOf('rday1', R.day1DoneRate);
  })();

  /* v0.23.8 FIX（审计 P3-13）：漏斗 + 错误。缺字段时一律显示 —（老接口降级安全）。 */
  (function(){
    var F = j.funnel, FR = j.funnelReal || {}, E = j.errors || {};
    function num(id, v){ var el = document.getElementById(id); if (el) el.textContent = (v == null ? '\\u2014' : v); }
    function pctOf(id, v){ var el = document.getElementById(id); if (el) el.textContent = (v == null ? '\\u2014' : v + '%'); }
    if (F) {
      num('fu_open', F.open); num('fu_heard', F.heard); num('fu_spoke', F.spoke); num('fu_verif', F.verified);
      pctOf('fu_spoke_rate', F.spokeRate); pctOf('fu_verif_rate', F.verifiedRate);
    }
    num('fu_open_r', FR.open); num('fu_heard_r', FR.heard); num('fu_spoke_r', FR.spoke); num('fu_verif_r', FR.verified);
    pctOf('fu_spoke_rate_r', FR.spokeRate); pctOf('fu_verif_rate_r', FR.verifiedRate);
    num('err_dev', E.devices); num('err_dev_r', E.devicesReal);
    num('err_total', E.total); pctOf('err_rate', E.deviceRate);
    var top = E.top || [];
    var tb = document.getElementById('errtop');
    if (tb) tb.innerHTML = top.length
      ? top.map(function(x){ return '<tr><td>' + x.msg.replace(/[<>]/g, '') + '</td><td>' + x.devices + ' device(s)</td></tr>'; }).join('')
      : '<tr><td style="color:#6b7f94">no errors reported yet</td><td></td></tr>';
  })();""",
                 'stats 渲染')
    write(STT, s)


if __name__ == '__main__':
    print('APP =', APP)
    idx = read(IDX)
    idx = fix_front_infra(idx)
    idx = fix_hooks(idx)
    idx = fix_buildstat(idx)
    idx = fix_logerr(idx)
    write(IDX, idx)
    fix_worker(idx)
    fix_stats()
    print('\n完成。index.html %d B | _worker.js %d B | stats.html %d B'
          % (len(idx.encode('utf-8')), len(read(WRK).encode('utf-8')), len(read(STT).encode('utf-8'))))
