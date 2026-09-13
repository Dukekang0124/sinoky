/* ==========================================================================
   v0.22.0 诺诺 IP 产品内接入层
   --------------------------------------------------------------------------
   设计前提（不可违反）：
     ① 每日主动气泡上限 = 4 次（nonoShow 内部）。本层**一次都不加**。
     ② 主路径页（v-scene / v-scenes-read）诺诺只能占边角 —— 所以本层为此
        新做了 nonoHint()（边角胶囊，不展开 340px 面板），而非复用 nonoShow()。
     ③ 每次出场必须绑一句中文 —— POSE 表里每姿都有 cn 字段。
     ④ 纯追加：只覆盖（重新赋值）既有全局函数，旧实现原地保留可回退。
     ⑤ 不新增任何网络写请求（KV 写配额红线）。分享卡右上角只做 Canvas 合成。
     ⑥ 尊重用户的关闭开关：NONO.closed 为真时，本层所有主动提示一并静默。
     ⑦ i18n：UI 标签一律走 T()，且**只使用 langs/*.json 里确实存在的 key**
        （v0.22.0 新增 'No worries — try again' 一个 key × 6 语言）。
        ⚠️ aria-label 是例外 —— applyI18n 的属性扫描没有「反向还原」分支，
           所以属性值必须写**英文源文**（由 applyI18n 正向翻译），不能写 T() 结果。
   ========================================================================== */
(function () {
  'use strict';
  if (window.__NONO_IP_V1__) return;          /* 幂等守卫 */
  window.__NONO_IP_V1__ = true;

  var T = (typeof window.T === 'function') ? window.T : function (s) { return s; };
  var P = function (n) { return 'assets/mascot/' + n + '.webp'; };
  function panelOpen() {
    var p = document.getElementById('nono-panel');
    return !!(p && p.style.display === 'block');
  }

  /* ---------- 0. 8 姿态语义表：每姿绑一句中文（Edify Gate 在 IP 层的转译） ---------- */
  var POSE = {
    like:   { cn: '很好！再说一遍',       en: 'Nice! Say it once more' },
    cheer:  { cn: '你可以的，跟我念',     en: "You've got this — repeat after me" },
    think:  { cn: '先听，再说',           en: 'Listen first, then say it' },
    sorry:  { cn: '没关系，我们再来一次', en: 'No worries — try again' },
    listen: { cn: '我在听',               en: "I'm listening" },
    point:  { cn: '去这里 →',             en: 'This way →' },
    wave:   { cn: '你好！',               en: 'Hi there!' },
    note:   { cn: '记下来，明天复习',     en: 'Noted — review tomorrow' }
  };
  window.NONO_POSE = POSE;

  /* ---------- 1. 边角胶囊提示（氛围位：0 配额，绝不展开面板） ---------- */
  var tipEl = null, tipT = null, hintSeen = {};
  function ensureTip() {
    if (tipEl && tipEl.parentNode) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'nono-tip';
    tipEl.setAttribute('role', 'status');
    document.body.appendChild(tipEl);
    return tipEl;
  }
  window.nonoHint = function (msg, opt) {
    opt = opt || {};
    var N = window.NONO || {};
    if (N.closed) return;                       /* 用户关掉陪伴 → 本层一并静默 */
    if (opt.once && hintSeen[opt.once]) return;
    if (opt.once) hintSeen[opt.once] = 1;
    if (opt.pose) {                             /* 姿态先同步：面板开着时也能看到角色状态 */
      var p0 = document.getElementById('nono-pose');
      if (p0) p0.src = P(opt.pose);
    }
    /* 面板已展开 → 只切姿态、不出胶囊：否则胶囊会压在 340px 面板上（z-index 更低但视觉重叠） */
    if (panelOpen()) { window.nonoHintHide(); return; }
    var el = ensureTip();
    el.innerHTML = msg;
    el.classList.add('on');
    var fab = document.getElementById('nono-fab');
    if (fab) { fab.classList.add('bump'); setTimeout(function () { fab.classList.remove('bump'); }, 1200); }
    if (tipT) clearTimeout(tipT);
    tipT = setTimeout(function () { el.classList.remove('on'); }, opt.ms || 6500);
  };
  window.nonoHintHide = function () {
    if (tipEl) tipEl.classList.remove('on');
    if (tipT) { clearTimeout(tipT); tipT = null; }
  };

  /* ---------- 2. 状态机文案修正（P0-4：失败时诺诺不该说「我在帮忙」） ----------
     原实现 map.sorry = ['sorry','Nono is helping…'] —— 判分失败/低分（L4549 acc<70）
     时诺诺说自己在「帮忙」，语义错位。失败位唯一该说的是「再来一次」。
     同时 listening 从复用 think 改为真 listen 姿态（8 姿态引入后才有这张图）。 */
  var ST_MAP = {
    listening: ['listen', 'Nono is listening…'],
    thinking:  ['think',  'Nono is thinking…'],
    speaking:  ['like',   'Nono is speaking…'],
    cheer:     ['cheer',  'Nono is happy!'],
    sorry:     ['sorry',  'No worries — try again']
  };
  if (typeof window.nonoState === 'function') {
    window.nonoState = function (st) {
      var pose = document.getElementById('nono-pose');
      var stEl = document.getElementById('nono-state');
      if (!pose) return;
      pose.className = '';
      var m = ST_MAP[st];
      if (m) {
        pose.src = P(m[0]);
        pose.classList.add('st-' + st);
        if (stEl) { stEl.style.display = 'block'; stEl.innerHTML = '<div class="np-state">' + T(m[1]) + '</div>'; }
      } else {
        pose.src = P('like');
        if (stEl) stEl.style.display = 'none';
      }
    };
  }

  /* ---------- 3. 语境分支：补齐空缺视图（P0-2；v0.23.0 由 6 个扩到 9 个） ----------
     原 nonoContextGreet 只覆盖 7/17 视图，缺的里 v-scene（主练习页）、
     v-scenes-read（阅读打分）恰好是最需要促开口的两个位。
     这里只接管这些视图并走边角提示（不展开面板、不吃每日 4 次配额）；
     其余视图原逻辑照跑。
     文案全部改成「动作召唤型」——原实现多为「说明书型」，占掉配额却换不来开口。
     v0.23.0 补 3 个：sentences（收藏句）/ reading（文本查词）/ prog（勋章进度）——
     至此 16/17 视图有问候，只剩 v-onboard（首启全屏层，由 §8 导览承接，不需要气泡）。 */
  var NEWVIEWS = { scene: 1, 'scenes-read': 1, practice: 1, explore: 1, days: 1, dialog: 1,
                   sentences: 1, reading: 1, prog: 1 };
  var VIEW_HINT = {
    scene:          { pose: 'listen', html: '<b>先听，再跟我念 3 遍。</b><br>Tap the mic and say it out loud.' },
    'scenes-read':  { pose: 'listen', html: '<b>读一句，说一句。</b><br>Reading it is not the same as saying it.' },
    practice:       { pose: 'cheer',  html: '<b>选一句，说 3 遍。</b><br>Slow the first time, real the third.' },
    explore:        { pose: 'point',  html: '<b>挑一个你明天就会用到的场景。</b>' },
    days:           { pose: 'cheer',  html: '<b>今天这一步，只要一句。</b><br>说给我听。' },
    dialog:         { pose: 'listen', html: '<b>一人一句 —— 你来演那个「你」。</b>' },
    sentences:      { pose: 'note',   html: '<b>挑一句，说给我听。</b><br>You saved these — now say them out loud.' },
    reading:        { pose: 'listen', html: '<b>看懂了，也要说出来。</b><br>Understanding it is not the same as saying it.' },
    prog:           { pose: 'cheer',  html: '<b>每一枚勋章，都是你开口换来的。</b><br>Say one more line — the next one is close.' }
  };
  if (typeof window.nonoContextGreet === 'function') {
    var _ncg = window.nonoContextGreet;
    window.nonoContextGreet = function (manual) {
      if (manual) return _ncg.apply(this, arguments);   /* 用户主动点浮标 → 原逻辑（进跟读） */
      try {
        var v = (typeof window.nonoView === 'function') ? window.nonoView() : '';
        var N = window.NONO || {};
        var blocked = N.closed || (Date.now() < (N.lockUntil || 0));
        if (NEWVIEWS[v] && !blocked) {
          var cfg = VIEW_HINT[v];
          window.nonoHint(cfg.html, { pose: cfg.pose, once: 'vh_' + v, ms: 7000 });
          return;
        }
      } catch (e) { /* 任何异常都退回原逻辑，绝不影响开口 */ }
      return _ncg.apply(this, arguments);
    };
  }

  /* ---------- 4. 打分结果绑「再说一遍」（P0-3） ----------
     原结果反馈只有气泡、没有下一步动作 —— 高分后用户就走了。
     这里记住最后一次 scorePhrase(i) 的句子索引，「再说一遍」直接回到同一句。 */
  var lastPhraseIdx = null;
  if (typeof window.scorePhrase === 'function') {
    var _sp = window.scorePhrase;
    window.scorePhrase = function (i) {
      lastPhraseIdx = i;
      return _sp.apply(this, arguments);
    };
  }
  var againEl = null, againT = null;
  function ensureAgain() {
    if (againEl && againEl.parentNode) return againEl;
    againEl = document.createElement('div');
    againEl.id = 'nono-again';
    /* 按钮文字走 T()（applyI18n 会把它反向还原后重译，幂等）；
       aria-label 写英文源文（属性扫描无反向分支，写译文会在切语言后卡住） */
    againEl.innerHTML =
      '<button onclick="nonoAgain()">🎙️ ' + T('Practice again') + '</button>' +
      '<button class="ghost" onclick="nonoAgainHide()" aria-label="Close">✕</button>';
    document.body.appendChild(againEl);
    return againEl;
  }
  window.nonoAgainShow = function () {
    if (lastPhraseIdx === null) return;
    var N = window.NONO || {};
    if (N.closed) return;
    /* 结果动作条与边角气泡在 420px 视口下会重叠（实测 tip 右沿 344 / 动作条
       居中区 118~303）—— 出结果时收掉氛围位，让唯一该抢注意力的东西独占。 */
    window.nonoHintHide();
    ensureAgain().classList.add('on');
    if (againT) clearTimeout(againT);
    againT = setTimeout(function () { window.nonoAgainHide(); }, 30000);
  };
  window.nonoAgainHide = function () {
    if (againEl) againEl.classList.remove('on');
    if (againT) { clearTimeout(againT); againT = null; }
  };
  window.nonoAgain = function () {
    if (lastPhraseIdx === null) return;
    var i = lastPhraseIdx;
    window.nonoAgainHide();
    window.nonoHintHide();
    try { if (typeof window.nonoMin === 'function') window.nonoMin(); } catch (e) {}
    try { window.scorePhrase(i); } catch (e) {}
  };
  if (typeof window.renderScore === 'function') {
    var _rs = window.renderScore;
    window.renderScore = function (d) {
      var out = _rs.apply(this, arguments);
      try {
        var sc = (d && (d.overall != null ? d.overall : d.score)) || 0;
        if (sc > 0) window.nonoAgainShow();
      } catch (e) {}
      return out;
    };
  }

  /* ---------- 5. 分享卡加诺诺（P0-5） ----------
     原 SHARE.draw() 是纯 Canvas —— 无 drawImage、无 mascot 引用，
     产品唯一的社交传播出口零 IP。这里在 Canvas 合成末尾补一层角色。
     注意：不裁切、不重采样原绘制内容，只在右下留白区叠加。 */
  (function () {
    if (typeof window.SHARE === 'undefined' || typeof window.SHARE.draw !== 'function') return;
    var img = new Image();
    img.decoding = 'async';
    img.src = 'assets/brand/nono-share.webp';
    img.onload = function () {
      /* 若此刻分享面板已打开，重绘一次让角色出现（首次打开时图未就绪） */
      try {
        var m = document.getElementById('share-mask');
        if (m && m.style.display === 'block' && typeof window.SHARE.render === 'function') window.SHARE.render();
      } catch (e) {}
    };
    window.NONO_SHARE_IMG = img;
    var _draw = window.SHARE.draw;
    window.SHARE.draw = function (fmt) {
      var cv = _draw.apply(this, arguments);
      if (!cv || !img.complete || !img.naturalWidth) return cv;
      try {
        var ctx = cv.getContext('2d');
        if (!ctx) return cv;
        var W = cv.width, H = cv.height, PAD = 84;
        var h = Math.round(H * 0.20);                       /* 高 ≈ 卡高 20% */
        var w = Math.round(h * img.naturalWidth / img.naturalHeight);
        var x = W - PAD - w;
        var y = H - 250 - h;                                /* 底边落在品牌横线之上 */
        /* 角色底下的柔和朱砂光晕，避免直接压在深色底上显脏 */
        var g = ctx.createRadialGradient(x + w * 0.5, y + h * 0.55, h * 0.05,
                                         x + w * 0.5, y + h * 0.55, h * 0.72);
        g.addColorStop(0, 'rgba(230,57,70,0.16)');
        g.addColorStop(1, 'rgba(230,57,70,0)');
        ctx.save();
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.55, h * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.98;
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
      } catch (e) {}
      return cv;
    };
  })();

  /* ---------- 6. 空闲时预热高频姿态（避免首次切换闪白） ---------- */
  function warm() {
    ['like', 'cheer', 'think', 'listen'].forEach(function (n) {
      var i = new Image(); i.src = P(n);
    });
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warm, { timeout: 6000 });
  else setTimeout(warm, 3500);

  /* ---------- 7. 录音中把浮标也切到 listen（浮标与面板共用同一姿态语义） ---------- */
  (function () {
    var _ns = window.nonoState;
    if (typeof _ns !== 'function') return;
    window.nonoState = function (st) {
      var r = _ns.apply(this, arguments);
      try {
        var fab = document.getElementById('nono-fab');
        var fi = fab && fab.querySelector('img');
        if (fi) fi.classList.toggle('nono-fab-listening', st === 'listening');
      } catch (e) {}
      return r;
    };
  })();

  /* ---------- 8. 功能导览：诺诺带你认识产品（v0.23.0） ----------
     对应需求「引导用户了解并使用产品内的各项功能与学习内容」。
     为什么必须新做：产品有 17 个视图 / 14 天路径 / HSK1–3 字卡 / 声调曲线 /
     100 句生存中文，但首次进来的用户看不到全貌 —— 出场机制再完备，
     用户不知道「去哪、用什么」也没用。

     位阶（Edify Gate：不 edify 但必需的藏进二级位置，绝不占主路径）：
       ① 入口放二级 —— 诺诺面板模式菜单第三项（随时可回访）＋ 一条浮动邀请
          （只在 home 出现、可关闭、只出一次）；
       ② 不消耗每日 4 次主动气泡配额（自己渲染面板，不走 nonoShow）；
       ③ **每一站都绑一句中文** —— 功能说明与开口不分成两件事。

     状态落盘：'sinoky_nono_tour'='done'（逛完）或 'sinoky_nono_invite'='off'
       （关掉邀请）—— 任一成立即永久静音，不再打扰。 */
  var TOUR_KEY = 'sinoky_nono_tour', INVITE_KEY = 'sinoky_nono_invite';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* 6 站 = 6 个功能区。view 全部落在 go() 白名单内，点「带我去」即可直达。 */
  var TOUR = [
    { view: 'days', pose: 'cheer', hz: '今天只要一句', py: 'jīntiān zhǐyào yī jù',
      en: 'One line a day', gloss: 'One line is enough today',
      body: 'Your main path: 14 days, one survival line each. Finish them and you can answer people — not just recite words.' },
    { view: 'practice', pose: 'listen', hz: '跟我念', py: 'gēn wǒ niàn',
      en: 'Where you actually speak', gloss: 'Repeat after me',
      body: 'Real situations — taxi, clinic, hotpot. Tap the mic, say the line out loud, and I score your tone.' },
    { view: 'cards', pose: 'note', hz: '听一听，说一说', py: 'tīng yi tīng, shuō yi shuō',
      en: 'HSK character cards', gloss: 'Listen, then say it',
      body: 'HSK1 to HSK3 decks. Tap any character to hear it, then say it back — this builds the words behind the lines.' },
    { view: 'tone', pose: 'think', hz: '慢慢来', py: 'màn màn lái',
      en: 'Tone training', gloss: 'Take it slow',
      body: 'Say a word and I draw your tone curve in real time. This is the one thing that makes you sound Chinese.' },
    { view: 'cities', pose: 'point', hz: '你去哪儿？', py: 'nǐ qù nǎr?',
      en: 'Cities & scenes', gloss: 'Where are you going?',
      body: 'Pick a city you will actually visit, or read a short scene and look up any word. Learn the lines that come up there.' },
    { view: 'prog', pose: 'cheer', hz: '你做到了', py: 'nǐ zuò dào le',
      en: 'Badges & progress', gloss: 'You did it',
      body: 'Every badge is a line you actually said out loud. Come back and see how far you have come.' }
  ];
  window.NONO_TOUR = TOUR;

  function hideOtherAreas() {
    ['nono-chat', 'nono-practice', 'nono-state'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  /* 渲染第 i 站（i === TOUR.length 即收尾站） */
  window.nonoTour = function (i) {
    i = parseInt(i, 10) || 0;
    if (i < 0) i = 0;
    var N = window.NONO || {};
    N.closed = false;                       /* 用户主动要导览 ⇒ 解除「今天不再打扰」 */
    var panel = document.getElementById('nono-panel');
    var msg = document.getElementById('nono-msg');
    var acts = document.getElementById('nono-acts');
    if (!panel || !msg) return;
    hideOtherAreas();
    if (typeof window.nonoHintHide === 'function') window.nonoHintHide();
    var iv = document.getElementById('nono-invite');
    if (iv) iv.classList.remove('on');
    if (typeof window.nonoModeChips === 'function') window.nonoModeChips();
    panel.style.display = 'block';
    if (typeof window.nonoPanelFlex === 'function') window.nonoPanelFlex(false);
    msg.style.display = 'block';
    if (typeof window.nonoState === 'function') window.nonoState('idle');   /* 先清状态（会重置为 like） */

    if (i >= TOUR.length) {                 /* ---- 收尾站 ---- */
      lsSet(TOUR_KEY, 'done');
      msg.innerHTML = '<div class="nt-top">' + T('Tour') + '</div>' +
        '<h3 class="nt-h">' + T("You've seen the whole place.") + '</h3>' +
        '<p class="nt-b">Pick any button below and go say one line. <b>说一句就行。</b></p>';
      if (typeof window.nonoPose === 'function') window.nonoPose('wave');
      if (acts) acts.innerHTML =
        '<button onclick="nonoStartPractice()">🎙️ ' + T('Practise') + '</button>' +
        '<button class="ghost" onclick="nonoStartChat()">💬 ' + T('Chat') + '</button>' +
        '<button class="ghost" onclick="nonoMin()">' + T('Close') + '</button>';
      return;
    }

    var t = TOUR[i];
    var dots = '';
    for (var k = 0; k < TOUR.length; k++) dots += '<i class="' + (k <= i ? 'on' : '') + '"></i>';
    msg.innerHTML =
      '<div class="nt-top">' + T('Tour') + ' · ' + (i + 1) + '/' + TOUR.length + '</div>' +
      '<h3 class="nt-h">' + t.en + '</h3>' +
      '<p class="nt-b">' + t.body + '</p>' +
      '<div class="nt-cn"><b>' + t.hz + '</b><i>' + t.py + '</i><span>= ' + t.gloss + '</span></div>' +
      '<div class="nt-prog">' + dots + '</div>';
    if (typeof window.nonoPose === 'function') window.nonoPose(t.pose);
    if (acts) acts.innerHTML =
      '<button onclick="nonoTour(' + (i + 1) + ')">' +
        (i + 1 < TOUR.length ? T('Next →') : T('Finish')) + '</button>' +
      '<button class="ghost" onclick="nonoTourGo(\'' + t.view + '\')">' + T('Take me there') + '</button>' +
      '<button class="ghost" onclick="nonoMin()">' + T('Skip for now') + '</button>';
  };
  /* 直达那一站对应的视图，并收起面板（视图本身就是最好的说明） */
  window.nonoTourGo = function (v) {
    try { if (typeof window.go === 'function') window.go(v); } catch (e) {}
    if (typeof window.nonoMin === 'function') window.nonoMin();
  };

  /* 面板模式菜单挂第三项（覆盖原函数并保留原有两项的行为） */
  (function () {
    if (typeof window.nonoModeChips === 'function') {
      var _chips = window.nonoModeChips;
      window.nonoModeChips = function () {
        var r = _chips.apply(this, arguments);
        try {
          var el = document.getElementById('nono-modes');
          var w = el && el.querySelector('.nm-wrap');
          if (w && !w.querySelector('.nm-tour')) {
            var b = document.createElement('button');
            b.className = 'nm-chip nm-tour' + ((window.NONO || {}).mode === 'tour' ? ' on' : '');
            b.innerHTML = '🧭 ' + T('Tour');
            b.onclick = function () { window.NONO.mode = 'tour'; window.nonoTour(0); };
            w.appendChild(b);
          }
        } catch (e) {}
        return r;
      };
    }
  })();

  /* 浮动邀请：只在 home（落地页）出现 —— 主路径给句子，绝不抢 */
  var inviteEl = null, inviteTries = 0;
  function inviteOk() {
    if (lsGet(TOUR_KEY) === 'done' || lsGet(INVITE_KEY) === 'off') return false;
    if ((window.NONO || {}).closed) return false;
    var v = (typeof window.nonoView === 'function') ? window.nonoView() : 'home';
    if (v !== 'home') return false;
    var panel = document.getElementById('nono-panel');
    if (panel && panel.style.display === 'block') return false;   /* 面板开着就不叠一层 */
    return true;
  }
  function dismissInvite(remember) {
    if (remember) lsSet(INVITE_KEY, 'off');
    if (inviteEl) inviteEl.classList.remove('on');
  }
  function showInvite() {
    if (typeof window.nonoHintHide === 'function') window.nonoHintHide();  /* 与 #nono-tip 同位，先清掉 */
    if (!inviteEl || !inviteEl.parentNode) {
      inviteEl = document.createElement('div');
      inviteEl.id = 'nono-invite';
      inviteEl.setAttribute('role', 'button');
      inviteEl.innerHTML = '<span class="ni-x" aria-label="Dismiss">✕</span>' +
        '<b>' + T('Show me around') + '</b>' +
        '<span class="ni-en">' + T('Not sure where to start? Let me show you around.') + '</span>';
      document.body.appendChild(inviteEl);
    }
    inviteEl.onclick = function (e) {
      var tgt = e.target || {};
      var isX = (tgt.className || '').indexOf('ni-x') >= 0;
      dismissInvite(true);
      if (!isX) window.nonoTour(0);
    };
    setTimeout(function () { if (inviteEl) inviteEl.classList.add('on'); }, 40);
  }
  function inviteTick() {
    if (inviteOk()) { showInvite(); return; }
    if (inviteTries++ < 24) setTimeout(inviteTick, 6000);   /* 约 2.5 分钟内持续等条件成立 */
  }
  setTimeout(inviteTick, 8000);

  /* ---------- 9. 给既有「首视图轻引导」卡接上诺诺（v0.23.0） ----------
     查后结论：项目**本来就有**「引导用户了解产品功能」的机制 ——
       · tourHtml()（index.html L3214）：home 首视图一次性卡片，「👋 New here?
         60 SECONDS」，讲三步 + 四条操作指引；
       · tourNeeded()（L3208）控制只对零进度新用户出现；
       · endTour()（L3213）点一次即写 sinoky_tour 永不再现（I-014 边界：一次性、
         单卡片、不遮挡不弹窗）。
     ⇒ 不重造。只把陪伴角色接上去：让「介绍产品」这件事由诺诺来说。
     纯追加：包裹原函数，在卡片开头插一段诺诺行；原函数体、tourNeeded() /
     endTour() / sinoky_tour 标记一律原样，行为不变。 */
  (function () {
    if (typeof window.tourHtml !== 'function') return;
    var _th = window.tourHtml;
    window.tourHtml = function () {
      var h = _th.apply(this, arguments);
      try {
        var block = '<div class="nt-nono">' +
          '<img src="' + P('point') + '" alt="Nono">' +
          '<div><b>诺诺带你认识</b>' +
          '<span>I\u2019m Nono \uD83D\uDC3C \u2014 here are the three things that matter. ' +
          'Want the full map? Tap me any time.</span></div></div>';
        var i = h.indexOf('<div class="tour-steps">');
        if (i < 0) i = h.indexOf('<button');
        if (i > 0) h = h.slice(0, i) + block + h.slice(i);
      } catch (e) { /* 任何异常都退回原卡片，绝不弄坏既有引导 */ }
      return h;
    };
  })();

  /* ---------- 10. 修「陪伴入口被 Feedback 按钮压住」的既有布局缺陷 ----------
     实测（Playwright 量矩形）：#nono-dock(right:12px;bottom:78px) 与
     #fb-open(CSS right:12px;bottom:calc(72px+…)) 在**同一个右下角重叠**，
     且 #fb-open 在 DOM 里靠后、同为 z-index:60 ⇒ 压在浮标之上，浮标下半部点不准。
     根因不是本轮引入的：#nono-dock 是 v0.5.0 预留的位、#fb-open 是 v0.3.10
     上移到「导航栏上方」的位，两者从那时起就撞在右下角。
     #fb-open 自己的 JS 里 DEFAULT 写的是 left:12px（左下），注释也写
     「左下导航栏上方」，但 applyDefault() 只在【长按 700ms 复位】时被调用 ——
     首次访问（无 sinoky-fb-pos）时 CSS 的 right:12px 直接生效 ⇒ 从没落过左下。

     本层只做一次性纠正：不动原代码，不动它的拖拽/长按复位逻辑。
       有 sinoky-fb-pos（用户自己摆过位）⇒ 一律尊重，完全不干预；
       没有 ⇒ 按它自己注释里的设计意图落到左下，把右下让给陪伴角色。 */
  (function () {
    var btn = document.getElementById('fb-open');
    if (!btn) return;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('sinoky-fb-pos') || 'null'); } catch (e) {}
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return;
    btn.style.right = 'auto';
    btn.style.left = '12px';
    btn.style.top = 'auto';
    btn.style.bottom = 'calc(72px + env(safe-area-inset-bottom))';
  })();

  /* ==========================================================================
     v0.23.3 诺诺形象位（纯追加）
       ① 点面板里的头像 → 展开全身（assets/brand/nono-splash.webp，已入库）
       ② 两个使用计数走既有「功能级使用统计」（v0.3.36 的 S.feat）：
            S.feat.nono     = 与浮标互动的次数（入口吸引力）
            S.feat.nonoFull = 展开全身的次数（新形象位是否被发现）
          机制：只写 localStorage，随真实进度或会话结束 flush 上云，
          零新增网络写（守 KV 1000 写/天配额红线）。
       ③ 不新增任何用户可见文案 ⇒ 不需要新增 i18n key（零英文 fallback 验收线不动）。
     ========================================================================== */

  function stageCount(key) {
    try {
      if (typeof S === 'undefined' || !S) return;
      S.feat = S.feat || {};
      S.feat[key] = (S.feat[key] || 0) + 1;
      if (typeof saveStateLocal === 'function') saveStateLocal();
    } catch (e) {}
  }

  /* ---------- ① 形象位：点头像展开全身（「再点收回」） ----------
     状态判断只看 src，不引入任何额外标志：
       nonoState() / nonoHint() 每次都会重设 src，用 src 当唯一真相 ⇒
       状态一变自动收回全身，且不会残留「小尺寸全身图」的错误中间态。 */
  window.nonoStageToggle = function () {
    var el = document.getElementById('nono-pose');
    if (!el) return;
    var src = el.getAttribute('src') || '';
    if (src.indexOf('nono-splash') > -1) {
      el.src = P('like');
    } else {
      el.src = 'assets/brand/nono-splash.webp';
      stageCount('nonoFull');
    }
  };
  /* 事件委托绑在 document：面板头的图可能被重渲染，委托最稳 */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.id === 'nono-pose') window.nonoStageToggle();
  }, false);

  /* ---------- ② 入口计数：与浮标互动的次数 ----------
     挂在 click 上而不是包装 nonoToggle()：不覆盖任何既有函数，保持可回退。 */
  (function () {
    var fab = document.getElementById('nono-fab');
    if (!fab) return;
    fab.addEventListener('click', function () { stageCount('nono'); }, false);
  })();

  /* ---------- 11. 「诺诺记得你」：把 S.nono 里存着却从没说过的话说出来 ----------
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

})();
