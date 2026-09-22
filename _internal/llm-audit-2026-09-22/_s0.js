
/* v0.3.35 S6：vConsole 改为按需开启（?debug=1 或 localStorage sinoky-debug=1），默认完全不加载。
   原因①：它的悬浮按钮固定在右下角，正好压在底部导航最右侧的 Progress 按钮上 —— 390px 宽的
          手机上老外根本点不到 Progress（Playwright 实测 click 被 .vc-switch 拦截，报
          "intercepts pointer events"）。这是"导航项点不动"的第三层根因（前两层见反馈按钮注释）。
   原因②：调试面板对老外是纯噪音，还把内部日志暴露给普通用户。
   排查线上问题时打开 sinoky.pages.dev/?debug=1 即可，开启状态记在本地，方便连续排查。 */
(function(){
  var on = false;
  try{
    on = /(\?|&)debug=1(&|$)/.test(location.search) || localStorage.getItem('sinoky-debug') === '1';
  }catch(e){}
  if(!on) return;
  var sc = document.createElement('script');
  sc.src = 'vendor/vconsole.min.js';
  sc.onload = function(){
    try{
      window.vConsole = new window.VConsole({ theme:'dark' });
      var t = setInterval(function(){
        var sw = document.querySelector('.vc-switch');
        if(sw){ sw.style.bottom = 'calc(84px + env(safe-area-inset-bottom))'; clearInterval(t); }
      }, 300);
    }catch(e){ console.warn('vConsole init failed', e); }
  };
  document.head.appendChild(sc);
})();
