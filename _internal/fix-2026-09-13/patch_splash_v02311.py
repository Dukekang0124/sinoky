# -*- coding: utf-8 -*-
r"""
patch_splash_v02311.py —— 把开屏从「CSS 文字字标 + 透明角色图」换成「一整张满版开屏图」

背景（2026-09-13 康哥指令：「a8_9x16.webp 用这个图做开启图」）：
  产品开屏（index.html:1134 的 #splash）此前引用 assets/brand/nono-splash.webp
  —— 那是 560x820 RGBA 的**角色素材**（带 alpha），靠 CSS 拼「深青底 + Sino<k>y 字标 + 角色图」当开屏。
  而 assets/splash/a8_9x16.webp 是 1080x1920 RGB 的**满版开屏设计稿**（自带 LOGO + 云纹山峦 + 诺诺），
  却是零引用的孤儿文件。本补丁把开屏切到这张整图。

四个关键事实（都是实测，不是推断）：
  ① 整图四角实测色 = rgb(14,55,57) = #0E3739 —— contain 时上下补色必须用它，否则出现横向色带。
  ② 图自带 LOGO ⇒ DOM 里的 .sp-brand（CSS 文字字标）正常态必须隐藏，否则开屏出现两套字标。
     但**不能删**：图加载失败（首访慢网/离线未预热）时要降级显示它，避免整屏空白。
  ③ 图 101 KB vs 旧角色图 48 KB ⇒ 旧的「固定 420ms 淡出」会在慢网下出现「图刚出来就淡出」。
     改为「≥420ms 且图已就绪」才淡出 + 1600ms 硬上限兜底（不拖住首屏）。
  ④ sw.js 必须把开屏图纳入预缓存 —— 开屏图若未预热，**离线启动开屏就是空的**。
     （CACHE 版本号由 bump 脚本随版本一起改，否则旧 SW 不更新清单。）

幂等：每处先查「新文本是否已在」→ 在则 skip；再查「旧文本是否存在且唯一」→ 是则替换。
使用：python patch_splash_v02311.py [--check]
"""
import io
import os
import sys

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

PATCHES = [
    # ── ① index.html：开屏基础 CSS（A8 段的四条规则）
    (
        'index.html · 开屏基础 CSS',
        'index.html',
        r'''/* v0.10.0：A8 开屏 splash —— 首屏品牌图，app 初始化后淡出 */
#splash{position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;align-items:center;justify-content:center;transition:opacity .45s ease}
#splash.hide{opacity:0;pointer-events:none}
#splash img{width:auto;height:78vh;max-width:92vw;object-fit:contain;border-radius:18px}''',
        r'''/* v0.10.0：A8 开屏 splash —— 首屏品牌图，app 初始化后淡出
   v0.23.11：改为一整张满版开屏图 assets/splash/a8_9x16.webp（1080x1920 = 9:16）。
   底色取图内四角实测色 #0E3739(rgb 14,55,57)：手机竖屏 contain 时上下补色与图边缘无缝
   （9:16 屏如 1080x1920 则完全贴合，一像素都不补）。
   注意两处 #splash 规则（此处 + 后面「启动屏」段）必须同步 —— 只改一处会留下旧值静默回流。 */
#splash{position:fixed;inset:0;z-index:9999;background:#0E3739;display:flex;align-items:center;justify-content:center;transition:opacity .45s ease}
#splash.hide{opacity:0;pointer-events:none}
#splash img{width:auto;height:100%;max-width:100%;object-fit:contain;border-radius:0}''',
    ),
    # ── ② index.html：启动屏主题段（后者覆盖前者，是实际生效的一套）
    (
        'index.html · 启动屏主题段',
        'index.html',
        r'''/* 启动屏：主视觉接回（深青品牌底 + Sino<k>y 衬线字标） */
#splash{background:#17423D;flex-direction:column;gap:1.6vh}
#splash img{width:100%;max-width:430px;height:auto;max-height:70vh;border-radius:0}
#splash .sp-brand{font-family:"Songti SC","STSong","Noto Serif SC","SimSun",serif;font-size:30px;font-weight:800;letter-spacing:.6px;color:#F5F1E8;line-height:1}
#splash .sp-brand b{color:var(--red);font-weight:800}''',
        r'''/* 启动屏：v0.23.11 起主视觉 = 满版开屏图（a8_9x16.webp）整屏，CSS 字标退役为降级态。
   底色必须与图内底色一致（#0E3739），否则 contain 补色处出现横向色带。 */
#splash{background:#0E3739;flex-direction:column;gap:0}
#splash img{width:auto;height:100%;max-width:100%;object-fit:contain;border-radius:0}
#splash .sp-brand{display:none;font-family:"Songti SC","STSong","Noto Serif SC","SimSun",serif;font-size:30px;font-weight:800;letter-spacing:.6px;color:#F5F1E8;line-height:1}
#splash .sp-brand b{color:var(--red);font-weight:800}
/* 降级：开屏图加载失败（首访慢网 / 离线未预热）时退回 CSS 字标 + 深青底，不留白屏 */
#splash.sp-fallback .sp-brand{display:block}
#splash.sp-fallback img{display:none}''',
    ),
    # ── ③ index.html：开屏 DOM（换图源 + onerror 改降级而非整块移除）
    (
        'index.html · 开屏 DOM',
        'index.html',
        r'''<div id="splash"><div class="sp-brand">Sino<b>k</b>y</div><img src="assets/brand/nono-splash.webp" alt="Sinoky" onerror="this.parentNode.remove()"></div>''',
        r'''<div id="splash"><div class="sp-brand">Sino<b>k</b>y</div><img src="assets/splash/a8_9x16.webp" alt="Sinoky" onerror="this.parentNode.classList.add('sp-fallback')"></div>''',
    ),
    # ── ④ index.html：淡出时机（等图就绪 + 硬上限兜底）
    (
        'index.html · 淡出时机',
        'index.html',
        r'''/* v0.10.0：A8 开屏 splash —— 初始化完成后淡出 */
setTimeout(function(){ var s=document.getElementById('splash'); if(s){ s.classList.add('hide'); setTimeout(function(){ if(s&&s.parentNode) s.parentNode.removeChild(s); }, 520); } }, 420);''',
        r'''/* v0.10.0：A8 开屏 splash —— 初始化完成后淡出
   v0.23.11：开屏图 101 KB（旧角色图 48 KB），固定 420ms 会在慢网下「图刚出来就淡出」。
   改为「>=420ms 且图已就绪」才淡出；1600ms 硬上限兜底，绝不把首屏拖住。
   已缓存时 img.complete 立即为真 ⇒ 行为与旧版完全一致（420ms）。 */
(function(){
  var MIN_MS = 420, MAX_MS = 1600, t0 = Date.now();
  var s = document.getElementById('splash');
  if (!s) return;
  var img = s.querySelector('img');
  var pending = !(img && img.complete && img.naturalWidth > 0);
  function dismiss(){
    if (s.dataset.gone) return;
    s.dataset.gone = '1';
    s.classList.add('hide');
    setTimeout(function(){ if (s.parentNode) s.parentNode.removeChild(s); }, 520);
  }
  function go(){
    var wait = Math.max(0, MIN_MS - (Date.now() - t0));
    if (wait) setTimeout(dismiss, wait); else dismiss();
  }
  if (pending) {
    img.addEventListener('load', go);
    img.addEventListener('error', function(){ s.classList.add('sp-fallback'); go(); });
  } else {
    go();
  }
  setTimeout(dismiss, MAX_MS);
})();''',
    ),
    # ── ⑤ sw.js：开屏图纳入预缓存（离线启动也要有开屏）
    (
        'sw.js · 预缓存清单',
        'sw.js',
        r'''  './assets/brand/nono-splash.webp',''',
        r'''  /* v0.23.11 满版开屏图（首屏第一眼，必须离线可用；未预热则离线启动开屏是空的） */
  './assets/splash/a8_9x16.webp',
  './assets/brand/nono-splash.webp',''',
    ),
    # ── ⑥ capacitor.config.json：原生闪屏底色对齐，消除启动瞬间色跳
    (
        'capacitor.config.json · 原生闪屏底色',
        'capacitor.config.json',
        r'''      "backgroundColor": "#141a24",''',
        r'''      "backgroundColor": "#0E3739",''',
    ),
]


def main():
    check_only = '--check' in sys.argv
    changed = skipped = 0
    for label, rel, old, new in PATCHES:
        path = os.path.join(APP, rel)
        txt = io.open(path, encoding='utf-8').read()
        if new in txt:
            print('  ⏭  skip  %-38s 已是目标态' % label)
            skipped += 1
            continue
        n = txt.count(old)
        if n == 0:
            print('  ❌ FAIL  %-38s 未找到旧文本（文件已漂移？）' % label)
            return 1
        if n > 1:
            print('  ❌ FAIL  %-38s 旧文本出现 %d 次，不唯一，拒绝盲改' % (label, n))
            return 1
        if check_only:
            print('  ⚠️  to-do %-38s 需要改（--check 模式未写盘）' % label)
            continue
        io.open(path, 'w', encoding='utf-8', newline='').write(txt.replace(old, new))
        print('  ✅ 改   %-38s %s' % (label, rel))
        changed += 1
    print('\n  改动 %d 处 / 跳过 %d 处' % (changed, skipped))
    return 0


if __name__ == '__main__':
    sys.exit(main())
