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

  /* ---------- 3. 语境分支：补齐 6 个空缺视图（P0-2） ----------
     原 nonoContextGreet 只覆盖 7/13 视图，缺的 6 个里 v-scene（主练习页）、
     v-scenes-read（阅读打分）恰好是最需要促开口的两个位。
     这里只接管这 6 个视图并走边角提示（不展开面板、不吃每日 4 次配额）；
     其余视图原逻辑照跑。
     文案全部改成「动作召唤型」——原实现多为「说明书型」，占掉配额却换不来开口。 */
  var NEWVIEWS = { scene: 1, 'scenes-read': 1, practice: 1, explore: 1, days: 1, dialog: 1 };
  var VIEW_HINT = {
    scene:          { pose: 'listen', html: '<b>先听，再跟我念 3 遍。</b><br>Tap the mic and say it out loud.' },
    'scenes-read':  { pose: 'listen', html: '<b>读一句，说一句。</b><br>Reading it is not the same as saying it.' },
    practice:       { pose: 'cheer',  html: '<b>选一句，说 3 遍。</b><br>Slow the first time, real the third.' },
    explore:        { pose: 'point',  html: '<b>挑一个你明天就会用到的场景。</b>' },
    days:           { pose: 'cheer',  html: '<b>今天这一步，只要一句。</b><br>说给我听。' },
    dialog:         { pose: 'listen', html: '<b>一人一句 —— 你来演那个「你」。</b>' }
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
        g.addColorStop(0, 'rgba(194,54,43,0.16)');
        g.addColorStop(1, 'rgba(194,54,43,0)');
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
})();
