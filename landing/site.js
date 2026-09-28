/* ============================================================================
   Sinoky 官方网站 · 共享脚本（无依赖、无外链、可离线）
   ----------------------------------------------------------------------------
   双语实现说明（为什么用 data-zh 而不是 key 字典）：
     官网只有两种语言（EN 主 / ZH 辅），文案量不大但语气要求高。用「key → 字典」
     需要在 5 个页面维护一份 key 台账，漏一个 key 就静默显示原文；而把中文直接写在
     元素上（data-zh），漏译在肉眼上立刻可见，且页面在**禁用 JS** 时仍呈现完整英文
     ——英文正是目标用户的默认语言。英文原文保留在 data-en（首次运行写入），
     来回切换不会因为二次取值而丢失原文。
   ============================================================================ */

(function () {
  'use strict';

  var LANG_KEY = 'sinoky_site_lang';

  /* ───────── 语言 ───────── */

  function params() {
    try { return new URLSearchParams(location.search); } catch (e) { return null; }
  }

  function initialLang() {
    var p = params();
    var q = p && (p.get('lang') || '').toLowerCase();
    if (q === 'zh' || q === 'en') return q;
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) {}
    return 'en'; // 目标用户是外国人 ⇒ 英文为默认
  }

  function applyLang(lang) {
    var html = document.documentElement;

    /* 先处理「含标签的文案」（data-zh-html），再处理纯文本（data-zh）。
       顺序不能反：innerHTML 替换会重建子树，先跑会把后面捕获的纯文本节点变成游离节点。
       约定：data-zh-html 元素的子树内**不得**再出现 data-zh（check_site.cjs 有断言）。 */
    document.querySelectorAll('[data-zh-html]').forEach(function (el) {
      if (el.dataset.enHtml === undefined) el.dataset.enHtml = el.innerHTML;
      el.innerHTML = (lang === 'zh') ? el.dataset.zhHtml : el.dataset.enHtml;
    });

    var nodes = document.querySelectorAll('[data-zh]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.dataset.en === undefined) el.dataset.en = el.textContent;
      el.textContent = (lang === 'zh') ? el.dataset.zh : el.dataset.en;
    }
    // 属性类文案：只做两处（placeholder / meta description），显式优于抽象
    document.querySelectorAll('[data-zh-placeholder]').forEach(function (el) {
      if (el.dataset.enPlaceholder === undefined) el.dataset.enPlaceholder = el.getAttribute('placeholder') || '';
      el.setAttribute('placeholder', lang === 'zh' ? el.dataset.zhPlaceholder : el.dataset.enPlaceholder);
    });
    document.querySelectorAll('meta[data-zh-content]').forEach(function (m) {
      if (m.dataset.enContent === undefined) m.dataset.enContent = m.getAttribute('content') || '';
      m.setAttribute('content', lang === 'zh' ? m.dataset.zhContent : m.dataset.enContent);
    });
    // 标题
    var tzh = html.dataset.titleZh;
    if (tzh && html.dataset.titleEn === undefined) html.dataset.titleEn = document.title;
    if (tzh) document.title = (lang === 'zh') ? tzh : html.dataset.titleEn;

    html.lang = (lang === 'zh') ? 'zh-Hans' : 'en';
    html.setAttribute('data-lang', lang);

    var btns = document.querySelectorAll('[data-setlang]');
    for (var k = 0; k < btns.length; k++) {
      btns[k].setAttribute('aria-pressed', String(btns[k].dataset.setlang === lang));
    }
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}

    /* 通知其它脚本：文案已被整段替换，凡是「JS 填进去的动态数据」都要重新填一遍。
       （下载页的版本号／体积／MD5 就属于这类：它们所在的节点带 data-zh，
         applyLang 会把 textContent 重置回占位符「—」，必须由数据方自己补回来。） */
    try {
      document.dispatchEvent(new CustomEvent('sinoky:lang', { detail: { lang: lang } }));
    } catch (e) {}
  }

  function initLang() {
    var btns = document.querySelectorAll('[data-setlang]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { applyLang(this.dataset.setlang); });
    }
    // 无条件跑一遍：既建 data-en 基线（供来回切换还原），也写 aria-pressed
    applyLang(initialLang());
  }

  /* ───────── 移动端导航 ───────── */

  function initNav() {
    var burger = document.querySelector('.burger');
    if (!burger) return;
    burger.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
        document.body.classList.remove('nav-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ───────── 滚动淡入（尊重 prefers-reduced-motion） ───────── */

  function initFade() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var els = document.querySelectorAll('.fade');
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(function (e) { e.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ───────── 工具：复制 / 轻提示 ───────── */

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#0f1319;' +
      'color:#eef2f7;padding:10px 16px;border-radius:10px;font-size:13.4px;z-index:9999;' +
      'border:1px solid #2c3542;box-shadow:0 12px 32px rgba(0,0,0,.5)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || 'Copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      ta.remove();
    }
  }

  /* ───────── 应用内浏览器（微信/QQ/微博等）提示 ───────── */

  function initInApp() {
    var ua = navigator.userAgent || '';
    if (/MicroMessenger|QQ\/|Weibo|MiuiBrowser|HeyTapBrowser|VivoBrowser|HuaweiBrowser|Quark/i.test(ua)) {
      document.body.classList.add('is-inapp');
    }
  }

  /* ───────── 出口 ───────── */

  window.SinokySite = { applyLang: applyLang, copyText: copyText, toast: toast };

  function boot() { initLang(); initNav(); initFade(); initInApp(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
