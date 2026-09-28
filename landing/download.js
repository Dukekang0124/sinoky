/* ============================================================================
   Sinoky 官方网站 · 下载页脚本
   ----------------------------------------------------------------------------
   数据来源只有一处：产品根目录的 version.json（静态、公开、CI 在发版时回写）。
   这里**不自己拼版本号**，也不写死任何 APK 文件名 —— 一旦写死，
   下次发版就会出现「官网让人下载上一个版本」这种最不该发生的错。

   version.json 的 apk 段形状（由 apk.yml 回写）：
     { versionCode, version, url, md5, size, force }
   ============================================================================ */

(function () {
  'use strict';

  var RELEASES = 'https://github.com/Dukekang0124/sinoky/releases/latest';
  var state = { apk: null, ok: false, last: null, failed: false };

  function $(sel) { return document.querySelector(sel); }
  function fmtSize(n) {
    if (!n) return '';
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
  }

  /* ── 设备判定（只用于「哪条路径标成你的」+ 主按钮排序提示，不隐藏任何路径） ── */
  function device() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }
  function markDevice() {
    var dev = device();
    document.documentElement.setAttribute('data-device', dev);
    var cards = document.querySelectorAll('[data-for]');
    for (var i = 0; i < cards.length; i++) {
      var hit = cards[i].getAttribute('data-for') === dev;
      cards[i].classList.toggle('is-you', hit);
      // 标注语是双语元素，交给 site.js 的 data-zh 机制：这里只切显隐
      var badge = cards[i].querySelector('.you-badge');
      if (badge) badge.hidden = !hit;
    }
    // 桌面浏览器上，主按钮改成「去手机上打开」更合理
    if (dev === 'desktop') {
      var bar = $('#primary-hint');
      if (bar) bar.hidden = false;
    }
  }

  /* ── 拉 version.json 并填充 ──
     三种状态必须区分清楚，别把它们混成一种：
       A. 读到了，且 apk 段的 md5/size 齐全（CI 已回写）→ 全部字段显真值
       B. 读到了，但 apk 段的 md5/size 还空着（发版到出包之间的**合法中间态**）
          → 体积与校验值**整项隐藏**，由 #apk-pending 明确说明；绝不留一个「—」给用户猜
       C. 没读到（网络/HTTP 出错）→ #load-fail 显式说明，按钮退到官方发布页
     把 B 当成 A 会显示「MD5 校验值 —」（用户以为页面坏了）；当成 C 会误报故障。
     这就是 C3 那条闸门「缺数据必须有显式降级说明，不能静默留一个 —」要守的东西。 ── */
  function fill(v) {
    if (v) state.last = v; else v = state.last;
    var apk = (v && v.apk) || {};
    state.apk = apk;

    var setText = function (sel, txt) { var el = $(sel); if (el && txt) el.textContent = txt; };
    var hide = function (sel, on) { var el = $(sel); if (el) el.hidden = !!on; };
    var ver = apk.version || v.version || '';
    var size = fmtSize(apk.size);
    var metaPending = !apk.md5 || !apk.size;

    setText('#apk-ver', ver ? 'v' + ver : '');
    setText('#web-ver', v.version ? 'v' + v.version : '');
    setText('#apk-build', apk.versionCode ? String(apk.versionCode) : '');
    setText('#apk-updated', v.updated || '');
    setText('#apk-size', size);
    setText('#apk-size-inline', size);
    setText('#apk-md5', apk.md5 || '');
    setText('#apk-md5-block', apk.md5 || '');

    /* 待回写态：把这两项收起来（含它们各自的标签），并给出显式说明 */
    var collapse = function (on) {
      ['#mi-size', '#size-inline-wrap', '#apk-md5-dt', '#apk-md5', '#md5-card']
        .forEach(function (s) { hide(s, on); });
      var ig = $('#integrity-grid');
      if (ig) ig.classList.toggle('is-single', on);
    };
    collapse(metaPending);
    /* 🔴 拉取失败（#load-fail）与「元数据待回写」是两种**不同成因**，
       两条说明同时出现会给用户互相矛盾的解释（一条说没读到、一条说还在产出）。
       所以失败态只做字段收敛，由 #load-fail 单独解释。 */
    hide('#apk-pending', !(metaPending && !state.failed));

    // 直链按钮：只在真的拿到 url 时才写 href，否则保持指向 release 目录（缺文件比错链接安全）
    var url = apk.url;
    var links = document.querySelectorAll('[data-apk-link]');
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute('href', url || RELEASES);
      if (url) links[i].setAttribute('download', '');
      else links[i].removeAttribute('download');
    }

    // 文件名（用于「保存到哪个文件」的说明）
    var fname = url ? url.split('/').pop() : 'Sinoky-release.apk';
    setText('#apk-filename', fname);
    document.querySelectorAll('[data-apk-filename]').forEach(function (el) { el.textContent = fname; });

    // 强制更新标记
    if (apk.force) {
      var fb = $('#force-badge');
      if (fb) fb.hidden = false;
    }

    // 校验命令里的文件名
    document.querySelectorAll('[data-apk-filename-cmd]').forEach(function (el) { el.textContent = fname; });

    state.ok = !!(url && apk.md5 && apk.size);
  }

  function load() {
    var url = '../version.json?t=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (v) { state.failed = false; fill(v); })
      .catch(function () {
        // 降级：不留空白，把按钮指向 Release 页，并明确告诉用户发生了什么
        state.failed = true;
        var note = $('#load-fail');
        if (note) note.hidden = false;
        document.querySelectorAll('[data-apk-link]').forEach(function (el) {
          el.setAttribute('href', RELEASES);
        });
        /* 这里没有数据可展示，体积与校验值不再各留一个「—」，
           而是整项收起来；#load-fail 已经说清楚了原因。 */
        ['#mi-size', '#size-inline-wrap', '#apk-md5-dt', '#apk-md5', '#md5-card'].forEach(function (s) {
          var el = $(s); if (el) el.hidden = true;
        });
        var ig = $('#integrity-grid');
        if (ig) ig.classList.add('is-single');
        ['#apk-ver', '#apk-build', '#apk-updated', '#web-ver'].forEach(function (s) {
          var el = $(s); if (el) el.textContent = '—';
        });
      });
  }

  /* ── 复制当前页地址（桌面 → 手机的常规路径） ── */
  function initCopy() {
    var btn = $('#copy-link');
    if (!btn) return;
    var input = $('#page-url');
    if (input) input.value = location.origin + location.pathname;
    btn.addEventListener('click', function () {
      var lang = document.documentElement.getAttribute('data-lang');
      window.SinokySite.copyText(input ? input.value : location.href, lang === 'zh' ? '链接已复制' : 'Link copied');
    });
  }

  function boot() {
    markDevice();
    initCopy();
    load();
    var r = $('#releases-link'); if (r) r.setAttribute('href', RELEASES);

    /* 切换语言会把带 data-zh 的节点整段重置 ⇒ 已填的动态数据要补回来 */
    document.addEventListener('sinoky:lang', function () { fill(null); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
