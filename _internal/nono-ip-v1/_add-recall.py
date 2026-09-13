# -*- coding: utf-8 -*-
"""v0.23.4「诺诺记得你」落地脚本（幂等）

做两件事：
  ① patch.js 追加 §11 —— 包装 nonoDailyLine()，读 S.nono 说出「记得你」的话
  ② langs/{zh,es,ru,vi,id,th}.json 各补 5 个 key（en 是源文，无需）

为什么单独写脚本、不走 apply-nono-ip.py：
  与 _apply-nono-stage.py 同理 —— apply-nono-ip.py 里 NEW_VER/OLD_VER 是
  v0.23.0→v0.23.1 的常量，step_index() 会在当前版本上断言失败。本脚本自带
  锚点与幂等标记，只做「追加」，不碰任何既有内容。

三重闸门（写盘前）：
  ① 锚点命中数必须 == 1
  ② JSON 必须能 json.loads 通过（改前改后各一次）
  ③ 行尾「原样保持」—— 不把 LF 全量转成 CRLF（那会造成整文件 diff）
     patch.js 会被 apply-nono-ip.py 内联进 index.html，注入块的行尾由上游脚本
     统一规范；本脚本只负责「新插入的行与文件既有行尾一致」。

幂等：以 §11 的注释标记 / 各语言 key 是否存在判定，重复运行 0 字节变化。
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))            # .../sinoky-app/_internal/nono-ip-v1
APP = os.path.abspath(os.path.join(ROOT, '..', '..'))        # .../sinoky-app
PATCH = os.path.join(ROOT, 'patch.js')
LANGDIR = os.path.join(APP, 'langs')
LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th']

MARK = '11. 「诺诺记得你」'

# ---------------------------------------------------------------- §11 JS 片段
SEC11 = r'''  /* ---------- 11. 「诺诺记得你」：把 S.nono 里存着却从没说过的话说出来 ----------
     查后结论：主代码从 v0.7.0 起就一直在写
       S.nono = { n 判分次数, best 历史最高分, last{key,score,at} 最近一次, weak{key:错次} }
     但**没有任何一处把它读出来讲给用户听** —— 用户练了 20 次、卡了某句 4 遍、
     最高拿过 92 分，诺诺一个字都没提过。于是它是「每次重置的 NPC」，
     而不是「记得你的对象」；而用户洞察 I-018 的原话恰是
       「I just need to be able to express myself… I don't have Chinese friends」
     —— 缺的正是「被记住」这一层。

     落点：包装 nonoDailyLine()（go('home') 时调用、每天一次的位置）
       · 不新建触发时机 ⇒ 除既有的每日 1 次气泡外不多占配额
       · 有素材就说 recall 版（带「练这一句」动作，直接回到卡住的那句）
       · 没素材就走原逻辑（今日句），一行不改
       · 同时写 sinoky_nono_daily 标记，避免原函数当天再给一条

     挑句优先级：weak（错得最多的那句）> last（最近一次）——
     「你卡住的那句」比「你最后练的那句」更像「我记着你」。
     埋点：S.feat.nonoRecall（本地计数，随进度/会话结束 flush，零新增 KV 写）。
     i18n：新增 5 个 key × 6 语言，已入 langs/*.json（见 _add-recall.py）。
     ========================================================================== */
  var RECALL = {
    hard:  'This line has tripped you up {c} times \u2014 today we crack it.',
    away:  'You last spoke Chinese {d} days ago \u2014 let\u2019s pick up where you stopped.',
    beat:  'Yesterday this line scored {s}. Beat it today?',
    stick: 'Yesterday this line scored {s}. One more try \u2014 it will stick.',
    btn:   'Practice that line'
  };
  function rLGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function rLSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function rToday() { return new Date().toISOString().slice(0, 10); }
  /* 与 S.nono.last.at 同口径（都取 UTC 日期串），避免半日偏移 */
  function rGap(fromISO, toISO) {
    var a = String(fromISO).split('-'), b = String(toISO).split('-');
    if (a.length !== 3 || b.length !== 3) return -1;
    return Math.round((Date.UTC(+a[0], +a[1] - 1, +a[2]) - Date.UTC(+b[0], +b[1] - 1, +b[2])) / 86400000);
  }
  function rPick(sn) {
    var w = sn.weak || {}, best = null, n = 0;
    Object.keys(w).forEach(function (k) { if ((w[k] || 0) > n) { n = w[k]; best = k; } });
    if (best && n >= 2) return { key: best, hard: true, n: n };
    if (sn.last && sn.last.key) return { key: sn.last.key, hard: false, n: 0 };
    return null;
  }
  window.nonoRecall = function () {
    try {
      if (typeof S === 'undefined' || !S || !S.nono) return false;
      var sn = S.nono;
      if (!sn.n) return false;                                     /* 从没判过分 → 不冒充「记得你」 */
      if ((typeof window.nonoView === 'function' ? window.nonoView() : '') !== 'home') return false;
      var N = window.NONO || {};
      if (N.closed) return false;                                  /* 尊重「关掉陪伴」开关 */
      /* ⚠️ 这里**故意不检查 NONO.lockUntil**（2026-09-13 实测教训）：
         lockUntil 的本意是「刚出过结果反馈，别被功能说明抢走」，设它的都是
         priority:'result' 的气泡。而本函数发出的也是 result 级内容，且只在首页、
         每天最多一次 —— 与结果条（在 scene / practice 页）根本不在同一屏，不存在打断。
         实测：冷启动时 boot 早期先有一次 result 气泡把 lockUntil 设成 +2500ms，
         与本函数的触发时刻只差几十毫秒 ⇒ 连续两轮冷启动都被这个「同类锁」锁死，
         症状是「打开 App 什么都没有」。真正的打扰护栏是下面的 nonoBusy()。 */
      if (typeof window.nonoBusy === 'function' && window.nonoBusy()) return false;
      var today = rToday();
      if (rLGet('sinoky_nono_recall') === today) return false;      /* 每天最多一次 */
      var dd = (typeof window.nonoDaily === 'function') ? window.nonoDaily() : null;
      if (dd && dd.n >= 4) return false;                           /* 当日气泡配额已满 → 不写标记 */
      var last = sn.last;
      if (!last || !last.at) return false;
      var gap = rGap(today, last.at);
      if (gap < 1 || gap > 60) return false;                       /* 今天刚练过不说；>60 天当新用户 */
      var pick = rPick(sn);
      if (!pick) return false;

      var sc = Math.round(last.score || 0);
      var tpl = pick.hard ? RECALL.hard
              : (gap >= 2 ? RECALL.away : (sc >= 70 ? RECALL.beat : RECALL.stick));
      var msg = T(tpl).replace('{d}', gap).replace('{s}', sc).replace('{c}', pick.n);

      rLSet('sinoky_nono_recall', today);
      try { localStorage.setItem('sinoky_nono_daily', JSON.stringify({ day: today, key: pick.key })); } catch (e) {}
      stageCount('nonoRecall');
      window.nonoShow(msg, {
        pose: gap >= 2 ? 'listen' : 'cheer',
        priority: 'result',
        actions: [
          /* onclick 是双引号包裹的属性 ⇒ fn 里只能用单引号，并转义 key 中的单引号 */
          { t: T(RECALL.btn), fn: 'nonoPracticeKey(\'' + String(pick.key).replace(/[\\']/g, '\\$&') + '\')' },
          { t: T('Later'), fn: 'nonoMin()', ghost: true }
        ]
      });
      return true;
    } catch (e) { return false; }   /* 任何异常都退回原逻辑，绝不影响开口 */
  };

  if (typeof window.nonoDailyLine === 'function') {
    var _ndl = window.nonoDailyLine;
    window.nonoDailyLine = function () {
      try { if (window.nonoRecall()) return; } catch (e) {}
      return _ndl.apply(this, arguments);
    };
  }

  /* 冷启动补一次：既有 nonoDailyLine 只在 go('home') 时被调用，
     而「打开 app 就停在 home」这条最常见路径不经过 go() ⇒ 召回的黄金时刻会错过。
     这里在 load 后补一次（同样每天一次、同样不额外占配额）。
     带重试（最多 4 次 / 间隔 2.8s）：boot 早期视图可能还没落定、或麦克风正忙，
     一次没轮到就再试，而不是放弃 —— 首屏那一眼是召回最值钱的时刻。
     首启引导卡还没结束（sinoky_tour != 1）时不抢 —— I-014：新用户不被遮挡。 */
  (function () {
    var n = 0;
    function bootRecall() {
      n++;
      try {
        if (rLGet('sinoky_tour') !== '1') return;
        if (rLGet('sinoky_nono_recall') === rToday()) return;      /* 今天已经说过 → 收工 */
        if (window.nonoRecall()) return;                           /* 说成功 → 收工 */
        if (n < 4) setTimeout(bootRecall, 2800);
      } catch (e) {}
    }
    var kick = function () { setTimeout(bootRecall, 2400); };
    if (document.readyState === 'complete') kick();
    else window.addEventListener('load', kick);
  })();
'''

# ---------------------------------------------------------------- i18n 5 键 × 6 语言
# key 用英文源文（与 applyI18n 的匹配口径一致）；译文里保留 {d}/{s}/{c} 占位符。
# 俄语「{c} 次」避免数词变格 → 用「не раз（不止一次）」，语法正确且语感更重。
I18N = {
    'This line has tripped you up {c} times — today we crack it.': {
        'zh': '这句你已经卡了 {c} 次 —— 今天把它拿下。',
        'es': 'Esta frase se te ha atragantado {c} veces — hoy la dominamos.',
        'ru': 'Ты не раз спотыкался на этой фразе — сегодня одолеем.',
        'vi': 'Câu này làm bạn vấp {c} lần rồi — hôm nay xử gọn nhé.',
        'id': 'Kalimat ini sudah {c} kali bikin kamu tersandung — hari ini kita kuasai.',
        'th': 'ประโยคนี้ทำให้คุณสะดุดมา {c} ครั้งแล้ว — วันนี้เอาชนะมันให้ได้',
    },
    'You last spoke Chinese {d} days ago — let’s pick up where you stopped.': {
        'zh': '你上次开口是 {d} 天前 —— 接着上次的继续。',
        'es': 'Hablaste chino por última vez hace {d} días — sigamos donde lo dejaste.',
        'ru': 'Ты в последний раз говорил по-китайски {d} дн. назад — продолжим с того места.',
        'vi': 'Lần cuối bạn nói tiếng Trung là {d} ngày trước — mình tiếp tục từ chỗ đó nhé.',
        'id': 'Terakhir kamu bicara bahasa Mandarin {d} hari lalu — ayo lanjut dari sana.',
        'th': 'ครั้งสุดท้ายที่คุณพูดภาษาจีนคือ {d} วันที่แล้ว — มาฝึกต่อจากจุดเดิมกัน',
    },
    'Yesterday this line scored {s}. Beat it today?': {
        'zh': '昨天这句 {s} 分。今天能超过它吗？',
        'es': 'Ayer esta frase sacó {s}. ¿La superas hoy?',
        'ru': 'Вчера эта фраза набрала {s}. Побьёшь сегодня?',
        'vi': 'Hôm qua câu này được {s}. Hôm nay vượt qua nhé?',
        'id': 'Kemarin kalimat ini dapat {s}. Hari ini bisa lebih tinggi?',
        'th': 'เมื่อวานประโยคนี้ได้ {s} คะแนน วันนี้ทำได้มากกว่านี้ไหม',
    },
    'Yesterday this line scored {s}. One more try — it will stick.': {
        'zh': '昨天这句 {s} 分。再来一次，就记住了。',
        'es': 'Ayer esta frase sacó {s}. Un intento más y se te queda.',
        'ru': 'Вчера эта фраза набрала {s}. Ещё разок — и запомнится.',
        'vi': 'Hôm qua câu này được {s}. Thử lại một lần là nhớ ngay.',
        'id': 'Kemarin kalimat ini dapat {s}. Coba sekali lagi, pasti nempel.',
        'th': 'เมื่อวานประโยคนี้ได้ {s} คะแนน ลองอีกครั้งเดียวจะจำได้เลย',
    },
    'Practice that line': {
        'zh': '练这一句',
        'es': 'Practicar esa frase',
        'ru': 'Отработать эту фразу',
        'vi': 'Luyện câu này',
        'id': 'Latih kalimat itu',
        'th': 'ฝึกประโยคนี้',
    },
}


def read_text(p):
    return io.open(p, 'rb').read().decode('utf-8')


def eol_of(raw):
    return '\r\n' if raw.count('\r\n') > 0 else '\n'


def write_same_eol(p, t_lf, eol):
    out = t_lf if eol == '\n' else t_lf.replace('\r\n', '\n').replace('\n', '\r\n')
    io.open(p, 'w', encoding='utf-8', newline='').write(out)
    return out


def step_patch():
    raw = read_text(PATCH)
    if MARK in raw:
        print('  [patch.js] 已含 §11 → 跳过（幂等）')
        return False
    eol = eol_of(raw)
    t = raw.replace('\r\n', '\n')
    anchor = ("    fab.addEventListener('click', function () { stageCount('nono'); }, false);\n"
              "  })();\n"
              "})();\n")
    n = t.count(anchor)
    if n != 1:
        print('  !! [patch.js] 锚点命中 %d 次（要求 1）→ 中止' % n)
        sys.exit(1)
    new = ("    fab.addEventListener('click', function () { stageCount('nono'); }, false);\n"
           "  })();\n\n" + SEC11 + "\n})();\n")
    t = t.replace(anchor, new)
    if not t.rstrip().endswith('})();'):
        print('  !! [patch.js] 结尾异常（IIFE 未闭合）→ 中止')
        sys.exit(1)
    out = write_same_eol(PATCH, t, eol)
    print('  [patch.js] 已追加 §11  eol=%r  +%d B'
          % ('CRLF' if eol == '\r\n' else 'LF', len(out) - len(raw)))
    return True


def step_langs():
    changed = 0
    for lg in LANGS:
        p = os.path.join(LANGDIR, lg + '.json')
        raw = read_text(p)
        eol = eol_of(raw)
        d = json.loads(raw)                                   # 闸门②（改前）
        missing = [k for k in I18N if k not in d]
        if not missing:
            print('  [%s.json] 5 键齐全 → 跳过（幂等）' % lg)
            continue
        t = raw.replace('\r\n', '\n')
        i = t.rstrip().rfind('}')
        if i < 0:
            print('  !! [%s.json] 找不到结尾 } → 中止' % lg)
            sys.exit(1)
        head, tail = t[:i], t[i:]
        add = ''
        for k in missing:
            add += ',\n  ' + json.dumps(k, ensure_ascii=False) + ': ' + json.dumps(I18N[k][lg], ensure_ascii=False)
        t2 = head.rstrip(' \t\n') + add + '\n' + tail.lstrip('\n')
        d2 = json.loads(t2)                                   # 闸门②（改后）
        if len(d2) != len(d) + len(missing):
            print('  !! [%s.json] 键数异常 %d → %d → 中止' % (lg, len(d), len(d2)))
            sys.exit(1)
        out = write_same_eol(p, t2, eol)
        changed += 1
        print('  [%s.json] +%d 键（%d → %d）  eol=%r  +%d B'
              % (lg, len(missing), len(d), len(d2), 'CRLF' if eol == '\r\n' else 'LF', len(out) - len(raw)))
    return changed


def step_normalize():
    """清理 `langs/*.json` 的既有行尾污染：裸 CR（不在 CRLF 里的 \\r）。

    现状（2026-09-13 实测）：6 个语言文件在索引里各有 **573 处 `\\r\\r\\n` + 574 处裸 CR**
    —— 即每行末尾多一个 CR。成因是历史上某个 i18n 脚本在**已是 CRLF 的文件**上
    做 `\\n -> \\r\\n` 替换，重复运行不断累积（与「块首换行 +2 B」同类的伪幂等）。

    为什么可以安全删：JSON 字符串内部的控制字符必须转义（裸 CR 会被 json.loads 拒绝），
    所以裸 CR 只可能出现在字符串外 ⇒ 删除只影响空白，不改词条。
    本函数把「删前删后的 dict 全等」作为写盘硬闸门，证明零内容改动。
    """
    fixed = 0
    for lg in LANGS:
        p = os.path.join(LANGDIR, lg + '.json')
        raw = read_text(p)
        if '\r' not in raw.replace('\r\n', ''):
            continue                                  # 无裸 CR → 一个字节都不动
        d0 = json.loads(raw)
        t = raw.replace('\r\n', '\n').replace('\r', '')
        d1 = json.loads(t)
        if d0 != d1:                                  # 闸门：清理不得改变任何词条
            print('  !! [%s.json] 清理裸 CR 会改变词条 → 中止' % lg)
            sys.exit(1)
        write_same_eol(p, t, eol_of(raw))
        fixed += 1
        print('  [%s.json] 清理裸 CR（dict 全等，词条零变化）' % lg)
    if not fixed:
        print('  六个语言文件均无裸 CR → 跳过（幂等）')
    return fixed


print('=== ① patch.js ===')
a = step_patch()
print('=== ② langs/*.json ===')
b = step_langs()
print('=== ③ 行尾净化 ===')
c = step_normalize()
print('=== ④ 终检 ===')
raw = read_text(PATCH)
print('  patch.js  含 §11=%s  bytes=%d' % (MARK in raw, len(raw.encode('utf-8'))))
for lg in LANGS:
    txt = read_text(os.path.join(LANGDIR, lg + '.json'))
    d = json.loads(txt)
    hit = sum(1 for k in I18N if k in d)
    print('  %-4s json键=%-4d 新键命中=%d/5' % (lg, len(d), hit))
print('改动：patch.js=%s  语言文件=%d 个' % ('是' if a else '否(已是)', b))
