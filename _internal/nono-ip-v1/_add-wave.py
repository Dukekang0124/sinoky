# -*- coding: utf-8 -*-
"""v0.23.5 首访招手邀请（S1-M3，P0）落地脚本（幂等）

做四件事：
  ① patch.js 追加 §12 —— 首访零开口时，把「Hi, I'm Nono 🐼 介绍自己 + 派作业」
     换成「我先说中文『你好！』→ 邀请你『Say it back to me』」（wave 招手姿态）
  ② patch.js 的 §8 inviteOk() 加 1 行位阶条件 —— 让「导览邀请」给「招手邀请」让位
     （两个邀请都在 home、都在 boot 后 8 秒，不定先后就在首屏叠两层浮层）
  ③ langs/{zh,es,ru,vi,id,th}.json 各补 2 个 key（en 是源文，无需）
  ④ 顺手修正 _add-recall.py 内嵌的 §11 —— 它停留在「修 bug 前」的版本
     （还有 NONO.lockUntil 自锁、bootRecall 不重试两处），与 patch.js 已不一致。
     不修的话，将来在新分支重放 v0.23.4 会灌进有 bug 的代码。

为什么单独写脚本、不走 apply-nono-ip.py：
  与 _add-recall.py 同理 —— apply-nono-ip.py 的 NEW_VER/OLD_VER 是 v0.23.0→v0.23.1
  的常量，step_index() 会在当前版本上断言失败。本脚本自带锚点与幂等标记。

三重闸门（写盘前）：
  ① 每处替换的锚点命中数必须 == 1（②处为「已替换则跳过」）
  ② JSON 必须能 json.loads 通过（改前改后各一次）
  ③ 行尾「原样保持」—— 只保证「新插入的行与文件既有行尾一致」，不做全量转换

幂等：以 §12 的注释标记 / 各语言 key 是否存在判定，重复运行 0 字节变化。
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))            # .../sinoky-app/_internal/nono-ip-v1
APP = os.path.abspath(os.path.join(ROOT, '..', '..'))        # .../sinoky-app
PATCH = os.path.join(ROOT, 'patch.js')
RECALL_SCRIPT = os.path.join(ROOT, '_add-recall.py')
LANGDIR = os.path.join(APP, 'langs')
LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th']

MARK = '12. 首访招手邀请'
MARK_SEC8 = 'v0.23.5 位阶'

# ---------------------------------------------------------------- §12 JS 片段
SEC12 = r'''  /* ---------- 12. 首访招手邀请：「我先说中文，你回我一句」（S1-M3，P0） ----------
     规划原文（2026-09-13 诺诺IP融合规划 §3.1）：
       现状（实测）"Hi, I'm Nono 🐼 Your first line today: 你好 (nǐ hǎo).
                     Tap it and say it out loud."
         —— 这句是「关于诺诺的」：介绍自己 + 派作业，占掉首屏却换不来开口。
       改为 [诺诺 wave 招手] 先说中文「你好！(nǐ hǎo)」→ 再邀请「Say it back to me.」
         —— 第一秒就建立「我说 → 你说」的对话节律，为 S3「我问你答」铺路。
     差别就是这一句：把首次打开的 60 秒从「看介绍」变成「已经开过口了」。
     首句开口率是本产品唯一的北极星（S1 决定「会不会有第二句」）。

     位阶（与 §8 导览邀请的关系）—— 两个邀请都在 home、都在 boot 后 8 秒，
     不定先后就会在首屏叠两层浮层：
       §8「诺诺带你认识产品」按 Edify Gate 是「不 edify 但必需」⇒ 二级位置、绝不占主路径；
       本层「邀请你回一句」直接产出开口 ⇒ 主路径。
       定案：零开口用户先收招手邀请；导览邀请等「已开口 或 今天已被邀请过」再出现
       （§8 inviteOk() 里加 1 行条件，见同批改动）。

     时机：boot 后 8 秒起检查（给用户看完首屏、过引导卡的缓冲），不满足则每 2.5s 重试，
       最多 ~90s 窗口 —— 一次性 setTimeout 在冷启动时序竞争下会永久失败
       （v0.23.4 实测教训，见 skill cold-start-timing-race-diagnosis）。
       窗口用尽仍未发出（例如引导卡一直没关）⇒ 交还原分支，
       保证「首访一定有一句问候」这条底线不因为本层而破。
     条件：home && 零开口 && 首启引导卡已过（sinoky_tour === '1'）&& 面板没开
           && 麦克风没在忙 && 今天没发过。
     出口：「Say it back」→ nonoPracticeKey('arrival#0')
       （SCENES 首场景首句 = 你好 / Nǐ hǎo / Hello!）——
       不选场景、直接回一句；判分后 S.nono.last.key 记 arrival#0
       ⇒ 次日由 §11「诺诺记得你」接上（首次开口 → 被记住，闭环）。
     埋点：S.feat.nonoWave（本地计数，随进度/会话结束 flush，零新增 KV 写）。
     i18n：新增 2 个 key × 6 语言（见 _add-wave.py）；
       「你好！」是目标语内容，按主代码惯例不译（与 8 姿态表 wave.cn 一致）。
     ========================================================================== */
  var WAVE = {
    hz: '你好！',                  /* 目标语内容：不译 */
    py: 'nǐ hǎo',
    invite: 'Say it back to me.', /* → T()，已入 6 语言字典 */
    btn: 'Say it back'            /* → T()，已入 6 语言字典 */
  };
  var WAVE_DELAY = 8000, WAVE_RETRY = 2500, WAVE_TRIES = 33;   /* 8s 起 · 2.5s 一次 · 约 90s 窗口 */
  var waveTimer = null, waveLeft = 0, waveFb = false;

  /* 零开口 = 一句都没练过。这既是首访的判据，也覆盖「装了但一直没开口」的老用户
     —— 这类人正是最需要被邀请一次的（I-018）。 */
  function waveZeroSpeak() {
    var n = 0;
    try {
      var ph = (typeof S !== 'undefined' && S && S.phrases) || {};
      Object.keys(ph).forEach(function (k) { n += ((ph[k] || []).length); });
    } catch (e) {}
    return n === 0;
  }
  window.nonoWave = function () {
    try {
      if (!waveZeroSpeak()) return false;                            /* 已开过口 → 不需要邀请 */
      if ((typeof window.nonoView === 'function' ? window.nonoView() : '') !== 'home') return false;
      var N = window.NONO || {};
      if (N.closed) return false;                                    /* 尊重「关掉陪伴」开关 */
      if (rLGet('sinoky_tour') !== '1') return false;                /* 首启引导卡还没过 → 不抢（I-014） */
      if (rLGet('sinoky_nono_wave') === rToday()) return false;      /* 每天最多邀请一次 */
      /* 面板若已被**用户**用在别处（练习 / 聊天 / 导览）→ 不抢。
         这里**故意不**检查「面板是否已开」：主代码的「今日句」nonoDailyLine()
         比注入层更早执行（go('home') 是同步的），它会先说一句随机句并占住面板；
         2026-09-13 实测：包装 window.nonoDailyLine 拦不住它（主代码调的是内部绑定）。
         而对一句都没说过的人，那句随机句恰恰是该被本邀请替换掉的东西 ⇒ 允许覆盖。 */
      if (panelOpen() && (N.mode === 'practice' || N.mode === 'chat' || N.mode === 'tour')) return false;
      if (typeof window.nonoBusy === 'function' && window.nonoBusy()) return false;
      var dd = (typeof window.nonoDaily === 'function') ? window.nonoDaily() : null;
      if (dd && dd.n >= 4) return false;                             /* 走 nonoShow ⇒ 吃面板配额，满则让位 */

      rLSet('sinoky_nono_wave', rToday());
      stageCount('nonoWave');
      window.nonoShow(
        '<b>' + WAVE.hz + '</b> (' + WAVE.py + ')<br>' + T(WAVE.invite),
        { pose: 'wave', priority: 'result',
          actions: [
            /* onclick 是双引号包裹的属性 ⇒ fn 里的字符串只能用单引号 */
            { t: '🎙️ ' + T(WAVE.btn), fn: "nonoPracticeKey('arrival#0')" },
            { t: T('Later'), fn: 'nonoMin()', ghost: true }
          ] });
      return true;
    } catch (e) { return false; }   /* 任何异常都退回原逻辑，绝不影响开口 */
  };
  function waveTick() {
    if (window.nonoWave()) { waveTimer = null; return; }
    if (waveLeft-- > 0) { waveTimer = setTimeout(waveTick, WAVE_RETRY); return; }
    waveTimer = null;
    /* 窗口用尽仍未发出 → 交还原分支（原分支 = 老的「Hi, I'm Nono 🐼」问候）。
       注意 _ncg2 指向 §3 包装后的函数，不是本函数 ⇒ 不会递归。 */
    if (waveFb && typeof _ncg2 === 'function') { try { _ncg2.call(window, false); } catch (e) {} }
  }
  function waveKick(fb) {
    if (fb) waveFb = true;
    if (waveTimer) return;                       /* 已在等 → 不重复排（但保留可能升级的兜底许可） */
    waveLeft = WAVE_TRIES;
    waveTimer = setTimeout(waveTick, WAVE_DELAY);
  }
  if (typeof window.nonoContextGreet === 'function') {
    var _ncg2 = window.nonoContextGreet;
    window.nonoContextGreet = function (manual) {
      if (!manual) {
        try {
          /* 首访零开口：拦下原「介绍自己 + 派作业」气泡（它会立刻 show 并吃掉配额），
             改由 waveKick 在 8 秒后发「招手邀请」。
             两者是同一件事的两种说法 ⇒ 由 waveTick 二选一，绝不两头都不发。 */
          if ((typeof window.nonoView === 'function' ? window.nonoView() : '') === 'home'
              && waveZeroSpeak() && rLGet('sinoky_nono_wave') !== rToday()) {
            waveKick(true);
            return;
          }
        } catch (e) {}
      }
      return _ncg2.apply(this, arguments);
    };
  }
  /* 冷启动补一次：首访用户「打开就停在 home」，不经过 go() ⇒ 上面那条包装不会触发。
     前置做廉价判断（不满足就没必要排 90 秒定时器）；故意不检查 sinoky_tour ——
     让窗口覆盖「用户点掉引导卡」的那一刻，而不是一开局就放弃。 */
  (function () {
    var kick = function () {
      try {
        if (!waveZeroSpeak() || rLGet('sinoky_nono_wave') === rToday()) return;
        waveKick(false);
      } catch (e) {}
    };
    if (document.readyState === 'complete') setTimeout(kick, 1600);
    else window.addEventListener('load', function () { setTimeout(kick, 1600); });
  })();
'''

SEC8_OLD = ("    if (panel && panel.style.display === 'block') return false;   /* 面板开着就不叠一层 */\n"
            "    return true;\n"
            "  }\n")
SEC8_NEW = ("    if (panel && panel.style.display === 'block') return false;   /* 面板开着就不叠一层 */\n"
            "    /* v0.23.5 位阶：零开口用户先收「招手邀请」（§12，直接促开口）——\n"
            "       导览邀请是「介绍功能」，按 Edify Gate 属二级位置，等「已开口 或\n"
            "       今天已被邀请过」再出现。两个邀请都在 home、都在 boot 后 8 秒，\n"
            "       不定先后就会在首屏叠两层浮层。 */\n"
            "    if (typeof waveZeroSpeak === 'function' && waveZeroSpeak()\n"
            "        && rLGet('sinoky_nono_wave') !== rToday()) return false;\n"
            "    return true;\n"
            "  }\n")

# ---------------------------------------------------------------- i18n 2 键 × 6 语言
# key 用英文源文（与 applyI18n 的匹配口径一致）。
# 译文风格对齐既有条目：祈使/邀请式、简短、无主语（参见 'Practice again' / 'Let us say this one together.'）。
# 「你好！」是目标语内容 ⇒ 不译，只译诺诺的邀请与按钮。
I18N = {
    'Say it back to me.': {
        'zh': '说给我听。',
        'es': 'Repítelo conmigo.',
        'ru': 'Повтори за мной.',
        'vi': 'Nói lại cho tôi nghe.',
        'id': 'Ucapkan kembali padaku.',
        'th': 'พูดตามฉันสิ',
    },
    'Say it back': {
        'zh': '回一句',
        'es': 'Repetir',
        'ru': 'Повторить',
        'vi': 'Nói lại',
        'id': 'Ulangi',
        'th': 'พูดตาม',
    },
}

# ---------------------------------------------------------------- _add-recall.py 的 §11 同步
# 两处差异：① 删掉 NONO.lockUntil 自锁（v0.23.4 冷启动实测教训）
#           ② bootRecall 由「一次性」改为「带重试」
R11_OLD_LOCK = "      if (Date.now() < (N.lockUntil || 0)) return false;           /* 刚出过结果反馈，不抢 */\n"
R11_NEW_LOCK = ("      /* ⚠️ 这里**故意不检查 NONO.lockUntil**（2026-09-13 实测教训）：\n"
                "         lockUntil 的本意是「刚出过结果反馈，别被功能说明抢走」，设它的都是\n"
                "         priority:'result' 的气泡。而本函数发出的也是 result 级内容，且只在首页、\n"
                "         每天最多一次 —— 与结果条（在 scene / practice 页）根本不在同一屏，不存在打断。\n"
                "         实测：冷启动时 boot 早期先有一次 result 气泡把 lockUntil 设成 +2500ms，\n"
                "         与本函数的触发时刻只差几十毫秒 ⇒ 连续两轮冷启动都被这个「同类锁」锁死，\n"
                "         症状是「打开 App 什么都没有」。真正的打扰护栏是下面的 nonoBusy()。 */\n")

R11_OLD_BOOT = ("  /* 冷启动补一次：既有 nonoDailyLine 只在 go('home') 时被调用，\n"
                "     而「打开 app 就停在 home」这条最常见路径不经过 go() ⇒ 召回的黄金时刻会错过。\n"
                "     这里在 load 后补一次（同样每天一次、同样不额外占配额）；\n"
                "     首启引导卡还没结束（sinoky_tour != 1）时不抢 —— I-014：新用户不被遮挡。 */\n"
                "  (function () {\n"
                "    function bootRecall() {\n"
                "      try { if (rLGet('sinoky_tour') !== '1') return; window.nonoRecall(); } catch (e) {}\n"
                "    }\n"
                "    if (document.readyState === 'complete') setTimeout(bootRecall, 2400);\n"
                "    else window.addEventListener('load', function () { setTimeout(bootRecall, 2400); });\n"
                "  })();\n")

R11_NEW_BOOT = ("  /* 冷启动补一次：既有 nonoDailyLine 只在 go('home') 时被调用，\n"
                "     而「打开 app 就停在 home」这条最常见路径不经过 go() ⇒ 召回的黄金时刻会错过。\n"
                "     这里在 load 后补一次（同样每天一次、同样不额外占配额）。\n"
                "     带重试（最多 4 次 / 间隔 2.8s）：boot 早期视图可能还没落定、或麦克风正忙，\n"
                "     一次没轮到就再试，而不是放弃 —— 首屏那一眼是召回最值钱的时刻。\n"
                "     首启引导卡还没结束（sinoky_tour != 1）时不抢 —— I-014：新用户不被遮挡。 */\n"
                "  (function () {\n"
                "    var n = 0;\n"
                "    function bootRecall() {\n"
                "      n++;\n"
                "      try {\n"
                "        if (rLGet('sinoky_tour') !== '1') return;\n"
                "        if (rLGet('sinoky_nono_recall') === rToday()) return;      /* 今天已经说过 → 收工 */\n"
                "        if (window.nonoRecall()) return;                           /* 说成功 → 收工 */\n"
                "        if (n < 4) setTimeout(bootRecall, 2800);\n"
                "      } catch (e) {}\n"
                "    }\n"
                "    var kick = function () { setTimeout(bootRecall, 2400); };\n"
                "    if (document.readyState === 'complete') kick();\n"
                "    else window.addEventListener('load', kick);\n"
                "  })();\n")


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
        print('  [patch.js] 已含 §12 → 跳过（幂等）')
        return False
    eol = eol_of(raw)
    t = raw.replace('\r\n', '\n')

    # ① §8 位阶（1 行）—— 命中数必须 == 1
    n8 = t.count(SEC8_OLD)
    if n8 != 1:
        print('  !! [patch.js] §8 inviteOk 锚点命中 %d 次（要求 1）→ 中止' % n8)
        sys.exit(1)
    t = t.replace(SEC8_OLD, SEC8_NEW)

    # ② 追加 §12 —— 锚点 = 文件结尾的 IIFE 收口
    anchor = ("    if (document.readyState === 'complete') kick();\n"
              "    else window.addEventListener('load', kick);\n"
              "  })();\n"
              "\n"
              "})();\n")
    n12 = t.count(anchor)
    if n12 != 1:
        print('  !! [patch.js] 结尾锚点命中 %d 次（要求 1）→ 中止' % n12)
        sys.exit(1)
    t = t.replace(anchor,
                  "    if (document.readyState === 'complete') kick();\n"
                  "    else window.addEventListener('load', kick);\n"
                  "  })();\n\n" + SEC12 + "\n})();\n")
    if not t.rstrip().endswith('})();'):
        print('  !! [patch.js] 结尾异常（IIFE 未闭合）→ 中止')
        sys.exit(1)
    out = write_same_eol(PATCH, t, eol)
    print('  [patch.js] §8 位阶 +1 处 · §12 已追加  eol=%r  +%d 字符'
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
            print('  [%s.json] 2 键齐全 → 跳过（幂等）' % lg)
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
        print('  [%s.json] +%d 键（%d → %d）  eol=%r  +%d 字符'
              % (lg, len(missing), len(d), len(d2), 'CRLF' if eol == '\r\n' else 'LF', len(out) - len(raw)))
    return changed


def step_fix_recall_script():
    """把 _add-recall.py 内嵌的 §11 同步为 patch.js 的当前（修 bug 后）版本。

    为什么必须做：_add-recall.py 是「v0.23.4 怎么落地的」唯一可重放的记录。
    若它内嵌的代码停留在旧版，将来在新分支重放就会灌进「lockUntil 自锁 +
    bootRecall 不重试」两处真 bug（均为冷启动实测才发现）。
    幂等：两处均已替换则跳过。
    """
    if not os.path.exists(RECALL_SCRIPT):
        print('  [_add-recall.py] 不存在 → 跳过')
        return False
    raw = read_text(RECALL_SCRIPT)
    if R11_NEW_BOOT in raw and R11_NEW_LOCK in raw:
        print('  [_add-recall.py] §11 已是当前版本 → 跳过（幂等）')
        return False
    eol = eol_of(raw)
    t = raw.replace('\r\n', '\n')
    hits = 0
    if R11_OLD_LOCK in t:
        if t.count(R11_OLD_LOCK) != 1:
            print('  !! [_add-recall.py] lockUntil 行命中 >1 → 中止'); sys.exit(1)
        t = t.replace(R11_OLD_LOCK, R11_NEW_LOCK); hits += 1
    if R11_OLD_BOOT in t:
        if t.count(R11_OLD_BOOT) != 1:
            print('  !! [_add-recall.py] bootRecall 块命中 >1 → 中止'); sys.exit(1)
        t = t.replace(R11_OLD_BOOT, R11_NEW_BOOT); hits += 1
    if hits == 0:
        print('  [_add-recall.py] 未找到待修的旧片段（可能已手工改过）→ 跳过')
        return False
    out = write_same_eol(RECALL_SCRIPT, t, eol)
    print('  [_add-recall.py] §11 同步 %d 处（lockUntil 自锁 / bootRecall 重试）  +%d 字符'
          % (hits, len(out) - len(raw)))
    return True


def step_normalize():
    """清理 langs/*.json 的既有行尾污染：裸 CR（不在 CRLF 里的 \\r）。

    现状（2026-09-13 实测）：清理前 6 个语言文件各含 573 处 `\\r\\r\\n` + 574 处裸 CR。
    成因是历史上某轮 i18n 脚本在**已是 CRLF 的文件**上做 `\\n -> \\r\\n` 替换，
    重复累积的伪幂等（与「注入块首换行 +2 B」同类）。

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


print('=== ① patch.js（§8 位阶 + §12） ===')
a = step_patch()
print('=== ② langs/*.json（2 键 × 6 语言） ===')
b = step_langs()
print('=== ③ _add-recall.py（§11 同步为当前版本） ===')
d = step_fix_recall_script()
print('=== ④ 行尾净化 ===')
c = step_normalize()
print('=== ⑤ 终检 ===')
raw = read_text(PATCH)
print('  patch.js  含 §12=%s  含 §8 位阶=%s  bytes=%d'
      % (MARK in raw, MARK_SEC8 in raw, len(raw.encode('utf-8'))))
for lg in LANGS:
    txt = read_text(os.path.join(LANGDIR, lg + '.json'))
    dd = json.loads(txt)
    hit = sum(1 for k in I18N if k in dd)
    print('  %-4s json键=%-4d 新键命中=%d/2' % (lg, len(dd), hit))
print('改动：patch.js=%s  语言文件=%d 个  _add-recall.py=%s'
      % ('是' if a else '否(已是)', b, '是' if d else '否(已是)'))
