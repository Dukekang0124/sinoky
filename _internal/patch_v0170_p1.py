# -*- coding: utf-8 -*-
"""v0.17.0 分享功能 P1（第六补丁）
四项：
  ① 竖版 1080×1920 —— draw(fmt) 参数化；页脚/角花锚定 H；内容区间按比例重排（不是拉伸）
  ② S5 报告卡 —— 2×2 数据格 + 14 天日历热力（全真实数据），带可用性门槛
  ③ APK 保存到相册 —— JS 侧 Capacitor 优先（另在 apk.yml 给 UpdatePlugin 加 @PluginMethod）
  ④ 接收者 deep link —— 分享链带 &l=scene:idx；落地 openScene 打开同一句（它自带高亮+滚动）
     + 未完成引导页时排队到 finishOnboard 之后
"""
import os, re, json, subprocess

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)
P = "index.html"
H = open(P, "rb").read().decode("utf-8")
assert H.count("\n") - H.count("\r\n") == 0, "文件不是完整 CRLF"
def crlf(s): return s.replace("\n", "\r\n")
def rep(old, new, n=1):
    global H
    o, w = crlf(old), crlf(new)
    c = H.count(o); assert c == n, f"命中 {c} 次（期望 {n}）：{old[:80]!r}"
    H = H.replace(o, w)

# ============================================================
# ① 竖版：draw(fmt) 参数化
# ============================================================
rep("""var SHARE = {
  theme:'line', code:'', ctx:null, _mounted:false, _cv:null, _nickT:null,
  KEY_NICK:'sinoky_share_nick'
};""",
"""var SHARE = {
  theme:'line', code:'', ctx:null, _mounted:false, _cv:null, _nickT:null,
  KEY_NICK:'sinoky_share_nick',
  FMT:'square',           /* 'square' 1080x1080 | 'story' 1080x1920 */
  pendingLine:null        /* 接收者 deep link：朋友分享来的那一句 */
};""")

rep("""SHARE.draw = function(){
  var S_ = SHARE.C, W = 1080, PAD = 84;
  var cv = document.createElement('canvas'); cv.width = W; cv.height = W;
  var ctx = cv.getContext('2d');
  if (!ctx) return null;
  var cx = W/2;

  /* ---- 背景与边饰（四角统一 inset 34 / R 56；页脚整体让出角花区间）---- */
  ctx.fillStyle = S_.bg; ctx.fillRect(0, 0, W, W);
  _corner(ctx, 34, 34, 0, .45);
  _corner(ctx, W-34, 34, Math.PI/2, .45);
  _corner(ctx, W-34, W-34, Math.PI, .45);
  _corner(ctx, 34, W-34, -Math.PI/2, .45);
  _hui(ctx, 150, 58, W-300, 22, .45);""",
"""/* 圆角矩形路径（ctx.roundRect 未必存在 → 自带兜底） */
function _rr(ctx, x, y, w, h, r){
  ctx.beginPath();
  if (ctx.roundRect){ ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}
/* 报告卡：2×2 数据格（全部真实数字） */
function _tiles(ctx, cx, y, h, rows){
  var W = 1080, PAD = 84, gap = 22;
  var cw = (W - PAD*2 - gap) / 2, ch = (h - gap) / 2;
  for (var r = 0; r < 2; r++){
    for (var c = 0; c < 2; c++){
      var x = PAD + c*(cw+gap), yy = y + r*(ch+gap), it = rows[r][c];
      ctx.save();
      ctx.strokeStyle = 'rgba(201,168,108,.28)'; ctx.lineWidth = 2;
      _rr(ctx, x, y, cw, ch, 18); ctx.stroke();
      ctx.restore();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = SHARE.C.gold; ctx.font = '600 78px ' + SHARE.SERIF;
      ctx.fillText(String(it.n), x + cw/2, yy + ch/2 - 20);
      ctx.fillStyle = 'rgba(245,241,232,.5)'; ctx.font = '400 28px ' + SHARE.SANS;
      ctx.fillText(it.l, x + cw/2, yy + ch/2 + 46);
    }
  }
}
/* 报告卡：最近 14 天热力（数据源 = S.days，真实开口日期） */
function _heat(ctx, cx, y, h, days){
  var W = 1080, PAD = 84, n = 14, gap = 9;
  var w = (W - PAD*2 - (n-1)*gap) / n;
  var today = Date.now();
  for (var i = 0; i < n; i++){
    var d = new Date(today - (n-1-i)*864e5).toISOString().slice(0,10);
    var hit = (days || []).indexOf(d) > -1;
    ctx.save();
    ctx.fillStyle = hit ? 'rgba(201,168,108,.86)' : 'rgba(201,168,108,.10)';
    _rr(ctx, PAD + i*(w+gap), y, w, 42, 10); ctx.fill();
    ctx.restore();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(245,241,232,.45)'; ctx.font = '400 26px ' + SHARE.SANS;
  ctx.fillText('last 14 days', cx, y + 84);
}

SHARE.draw = function(fmt){
  fmt = (fmt === 'story') ? 'story' : (fmt === 'square' ? 'square' : SHARE.FMT);
  var S_ = SHARE.C, W = 1080, PAD = 84;
  var H_ = (fmt === 'story') ? 1920 : 1080;
  var cv = document.createElement('canvas'); cv.width = W; cv.height = H_;
  var ctx = cv.getContext('2d');
  if (!ctx) return null;
  var cx = W/2;
  /* 竖版不是「把方图拉长」，而是重新分配留白：内容区间整体上移，中部留出呼吸 */
  var TOP = (fmt === 'story') ? 340 : 176;
  var BOT = (fmt === 'story') ? (H_ - 470) : 806;

  /* ---- 背景与边饰（四角统一 inset 34 / R 56；页脚整体让出角花区间）---- */
  ctx.fillStyle = S_.bg; ctx.fillRect(0, 0, W, H_);
  _corner(ctx, 34, 34, 0, .45);
  _corner(ctx, W-34, 34, Math.PI/2, .45);
  _corner(ctx, W-34, H_-34, Math.PI, .45);
  _corner(ctx, 34, H_-34, -Math.PI/2, .45);
  _hui(ctx, 150, 58, W-300, 22, .45);
  if (fmt === 'story') _hui(ctx, 150, H_-92, W-300, 22, .45);""")

# 内容区间：方图写死的 176/806 → TOP/BOT
rep("_stack(ctx, cx, items, 176, 806);", "_stack(ctx, cx, items, TOP, BOT);", n=4)
rep("    var yEnd = _stack(ctx, cx, items, 176, 592);",
    "    var yEnd = _stack(ctx, cx, items, TOP, TOP + Math.round((BOT - TOP) * 0.68));")

# 页脚锚定 H_
rep("""  /* ---- L1 品牌层：署名，不是主体（金线 852 / 字标 916 / URL 954 / 印 872，全在角花之上）---- */
  ctx.save(); ctx.strokeStyle = 'rgba(201,168,108,.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, 852); ctx.lineTo(W-PAD, 852); ctx.stroke(); ctx.restore();
  _brand(ctx, PAD, 916, 46);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(245,241,232,.42)'; ctx.font = '400 27px ' + SHARE.SANS;
  ctx.fillText('sinoky.pages.dev', PAD, 954);
  _seal(ctx, W - PAD - 92, 872, 92);
  return cv;
};""",
"""  /* ---- L1 品牌层：署名，不是主体（全部锚定 H_，方图/竖版自动适配）---- */
  ctx.save(); ctx.strokeStyle = 'rgba(201,168,108,.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, H_-228); ctx.lineTo(W-PAD, H_-228); ctx.stroke(); ctx.restore();
  _brand(ctx, PAD, H_-164, 46);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(245,241,232,.42)'; ctx.font = '400 27px ' + SHARE.SANS;
  ctx.fillText('sinoky.pages.dev', PAD, H_-126);
  _seal(ctx, W - PAD - 92, H_-208, 92);
  return cv;
};""")

# ============================================================
# ② 报告卡主题
# ============================================================
rep("SHARE.TNAME = { start:'Just started', line:'This line I said', streak:'My streak', city:'City unlocked', badge:'New badge' };",
    "SHARE.TNAME = { start:'Just started', line:'This line I said', streak:'My streak', city:'City unlocked', badge:'New badge', report:'My progress' };")

rep("""SHARE.pool = function(){
  var pool = [];
  var line = SHARE.lastLine();
  if (line && line.p && line.p.hz) pool.push({ id:'line', w:5 });      /* 社交货币最强 → 权重最高 */
  if ((S.streak||0) >= 2) pool.push({ id:'streak', w:2 });
  if (SHARE.litCity()) pool.push({ id:'city', w:2 });
  if (SHARE.topBadge()) pool.push({ id:'badge', w:1 });
  if (!pool.length) pool.push({ id:'start', w:1 });                    /* 零数据用户 → 起点卡，绝不出空卡 */
  return pool;
};""",
"""SHARE.pool = function(){
  var pool = [];
  var line = SHARE.lastLine();
  if (line && line.p && line.p.hz) pool.push({ id:'line', w:5 });      /* 社交货币最强 → 权重最高 */
  if ((S.streak||0) >= 2) pool.push({ id:'streak', w:2 });
  if (SHARE.litCity()) pool.push({ id:'city', w:2 });
  if (SHARE.topBadge()) pool.push({ id:'badge', w:1 });
  /* 报告卡：有足够积累才出现（避免刚学两句就发"报告"，数字太空） */
  if (SHARE.said() >= 8 || (S.days||[]).length >= 3) pool.push({ id:'report', w:2 });
  if (!pool.length) pool.push({ id:'start', w:1 });                    /* 零数据用户 → 起点卡，绝不出空卡 */
  return pool;
};""")

# 报告卡分支：插在 badge 分支之前
rep("""  } else if (SHARE.theme === 'badge' && d.badge){""",
"""  } else if (SHARE.theme === 'report'){
    var lit = 0; try{ lit = litCount(); }catch(e){}
    var bTot = d.badge ? d.badge.total : 0;
    push({ t:'MY PROGRESS', size:26, font:SHARE.SANS, color:S_.goldDim, gap:30 });
    if (d.nick) push({ t:d.nick, size:26, font:SHARE.SANS, color:'rgba(245,241,232,.55)', gap:22 });
    push({ h: (fmt === 'story' ? 380 : 300), hook:function(c, cc, y, hh){
      _tiles(c, cc, y, hh, [
        [{ n:(S.streak||0), l:'days in a row' }, { n:SHARE.said(), l:'phrases said' }],
        [{ n:lit, l:'landmarks' }, { n:bTot, l:'badges' }]
      ]);
    } });
    push({ h:150, hook:function(c, cc, y, hh){ _heat(c, cc, y, hh, S.days || []); } });
    _stack(ctx, cx, items, TOP, BOT);

  } else if (SHARE.theme === 'badge' && d.badge){""")

# ============================================================
# ③ draw 调用点带上 FMT + 文件名带尺寸
# ============================================================
rep("""SHARE.render = function(){
  SHARE.mount();
  var cv = SHARE.draw(); if (!cv) return;""",
"""SHARE.render = function(){
  SHARE.mount();
  var cv = SHARE.draw(SHARE.FMT); if (!cv) return;""")
rep("""SHARE.blob = function(){
  var cv = SHARE._cv || SHARE.draw();""",
"""SHARE.blob = function(){
  var cv = SHARE._cv || SHARE.draw(SHARE.FMT);""")
rep("""SHARE.doSave = function(){
  SHARE.blob().then(function(bl){
    if (!bl){ toast('Could not build the image \\u2014 try Share or Copy instead'); return; }
    try{
      var u = URL.createObjectURL(bl);
      var a = document.createElement('a');
      a.href = u; a.download = 'sinoky-' + SHARE.theme + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(u); }, 4000);
      toast('Image saved');
    }catch(e){
      toast('Long-press the card above to save it');
    }
  });
};""",
"""/* 保存：APK 原生壳走 MediaStore 写相册（需 apk.yml 里的 UpdatePlugin.saveImageToGallery），
   浏览器走 a[download]；两条都失败才提示长按。 */
SHARE.doSave = function(){
  var fname = 'sinoky-' + SHARE.theme + '-' + SHARE.FMT + '.png';
  /* 原生壳优先 */
  try{
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()){
      var p = Capacitor.Plugins && Capacitor.Plugins.UpdatePlugin;
      if (p && p.saveImageToGallery){
        var dataUrl = (SHARE._cv || SHARE.draw(SHARE.FMT)).toDataURL('image/png');
        p.saveImageToGallery({ dataUrl:dataUrl, filename:fname }).then(function(r){
          toast((r && r.saved) ? 'Saved to your gallery' : 'Could not save \\u2014 try Share instead');
        }).catch(function(){ toast('Could not save \\u2014 try Share instead'); });
        return;
      }
    }
  }catch(e){}
  SHARE.blob().then(function(bl){
    if (!bl){ toast('Could not build the image \\u2014 try Share or Copy instead'); return; }
    try{
      var u = URL.createObjectURL(bl);
      var a = document.createElement('a');
      a.href = u; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(u); }, 4000);
      toast('Image saved');
    }catch(e){
      toast('Long-press the card above to save it');
    }
  });
};
/* 尺寸切换 */
SHARE.setFmt = function(f){
  if (f !== 'square' && f !== 'story') return;
  SHARE.FMT = f;
  SHARE.render();
};""")
rep("""      var f = new File([bl], 'sinoky-' + SHARE.theme + '.png', { type:'image/png' });""",
    """      var f = new File([bl], 'sinoky-' + SHARE.theme + '-' + SHARE.FMT + '.png', { type:'image/png' });""")

# ============================================================
# ④ 面板加尺寸切换 + 预览自适应高度
# ============================================================
rep(""" + '<div class="sp-row"><span class="sp-tname" id="sp-tname"></span>'
 + '<button class="sp-swap" onclick="SHARE.swap()">Shuffle</button></div>'""",
""" + '<div class="sp-row"><span class="sp-tname" id="sp-tname"></span>'
 + '<button class="sp-swap" onclick="SHARE.swap()">Shuffle</button></div>'
 + '<div class="sp-fmtrow"><span class="sp-flab">Size</span>'
 + '<span class="sp-seg">'
 + '<button class="sp-fbtn" data-fmt="square" onclick="SHARE.setFmt(\\'square\\')">1:1</button>'
 + '<button class="sp-fbtn" data-fmt="story" onclick="SHARE.setFmt(\\'story\\')">9:16</button>'
 + '</span></div>'""")

rep("""  var tn = $('sp-tname');
  if (tn){ tn.textContent = SHARE.TNAME[SHARE.theme] || ''; try{ if (typeof applyI18n === 'function') applyI18n(tn); }catch(e){} }""",
"""  var tn = $('sp-tname');
  if (tn){ tn.textContent = SHARE.TNAME[SHARE.theme] || ''; try{ if (typeof applyI18n === 'function') applyI18n(tn); }catch(e){} }
  var fbs = document.querySelectorAll('#share-panel .sp-fbtn');
  for (var fi = 0; fi < fbs.length; fi++){
    fbs[fi].className = 'sp-fbtn' + (fbs[fi].getAttribute('data-fmt') === SHARE.FMT ? ' on' : '');
  }""")

rep("#share-panel .sp-prev img{ width:100%; max-width:276px; display:block; }",
    """#share-panel .sp-prev img{ width:auto; max-width:276px; max-height:46vh; display:block; }
#share-panel .sp-fmtrow{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 12px; }
#share-panel .sp-flab{ font-size:12px; color:var(--sub); }
#share-panel .sp-seg{ display:inline-flex; border:1px solid rgba(201,168,108,.35); border-radius:99px; overflow:hidden; }
#share-panel .sp-fbtn{ background:transparent; border:0; color:var(--sub); font-size:12px; padding:6px 15px; cursor:pointer; }
#share-panel .sp-fbtn.on{ background:rgba(194,54,43,.18); color:var(--paper); }""")

# ============================================================
# ⑤ deep link：分享链带 &l=，落地 openScene 打开同一句
# ============================================================
rep("""SHARE.link = function(){ return 'https://sinoky.pages.dev/?s=' + SHARE.code + '&t=' + SHARE.theme; };""",
"""SHARE.link = function(){
  var u = 'https://sinoky.pages.dev/?s=' + SHARE.code + '&t=' + SHARE.theme;
  /* 句子卡带上「是哪一句」→ 接收者打开就落到同一句，而不是泛泛的首页 */
  if (SHARE.theme === 'line'){
    var L = SHARE.lastLine();
    if (L && L.sc && L.sc.id) u += '&l=' + encodeURIComponent(L.sc.id) + ':' + L.i;
  }
  return u;
};""")

rep("""/* ============================================================
   归因：落地页读 ?s= 上报一次（sessionStorage 防重复），只计数，不识别个人
   ============================================================ */""",
"""/* ============================================================
   接收者 deep link：?l=<sceneId>:<idx>
   openScene(id, idx, from) 本身已实现「定位到 #ph-<idx> + 高亮 + 滚动居中」，
   所以这里只需正确调用它 —— 不重复实现高亮。
   未完成引导页时排到 finishOnboard 之后（否则会被引导页全屏覆盖）。
   ============================================================ */
SHARE.pendingLine = (function(){
  try{
    var q = new URLSearchParams(location.search || '');
    var raw = q.get('l') || '';
    var m = /^([A-Za-z0-9_]{1,40}):(\\d{1,3})$/.exec(raw);
    if (!m) return null;
    var sc = null;
    try{ sc = SCENES.filter(function(s){ return s.id === m[1]; })[0]; }catch(e){}
    var idx = parseInt(m[2], 10);
    if (!sc || !sc.phrases || !sc.phrases[idx]) return null;
    return { id:m[1], idx:idx };
  }catch(e){ return null; }
})();

SHARE.playDeepLink = function(){
  var p = SHARE.pendingLine;
  if (!p) return;
  SHARE.pendingLine = null;
  try{
    openScene(p.id, p.idx, 'home');
    setTimeout(function(){
      try{ toast('Your friend sent you this line \\u2014 say it out loud'); }catch(e){}
    }, 1000);
  }catch(e){}
};

(function(){
  if (!SHARE.pendingLine) return;
  if (S.onboarded){ setTimeout(function(){ SHARE.playDeepLink(); }, 900); return; }
  /* 引导页还没走完 → 排队（包装 finishOnboard，原逻辑照跑） */
  if (typeof window.finishOnboard !== 'function') return;
  var _fo = window.finishOnboard;
  window.finishOnboard = function(){
    var r = _fo.apply(this, arguments);
    try{ setTimeout(function(){ SHARE.playDeepLink(); }, 800); }catch(e){}
    return r;
  };
})();

/* ============================================================
   归因：落地页读 ?s= 上报一次（sessionStorage 防重复），只计数，不识别个人
   ============================================================ */""")

# ============================================================
# 写盘 + 守卫
# ============================================================
data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open(P, "wb").write(data)
H2 = data.decode("utf-8")
lone = data.count(b"\n") - data.count(b"\r\n")
print("裸 LF:", lone); assert lone == 0

scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', H2, re.I)
open("_internal/_s3.js", "w", encoding="utf-8").write(scripts[-1])
r = subprocess.run([r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe", "--check", "_internal/_s3.js"],
                   capture_output=True, text=True)
print("模块语法 rc:", r.returncode, (r.stderr or "")[:400].strip())
os.remove("_internal/_s3.js")
assert r.returncode == 0, "模块语法错误"

checks = [
  ("SHARE.draw = function(fmt)", 1), ("_stack(ctx, cx, items, TOP, BOT)", 4),
  ("function _tiles", 1), ("function _heat", 1), ("function _rr", 1),
  ("'report', w:2", 1), ("report:'My progress'", 1),
  ("H_-228", 1), ("H_-208", 1), ("fmt === 'story' ? 1920", 1),
  ("SHARE.FMT = f", 1), ("data-fmt=", 2),
]
for k, want in checks:
    got = H2.count(k)
    print(f"  {k!r}: {got} (期望 {want})")
    assert got == want, f"{k} 数量不符"
for k, least in [("SHARE.FMT", 5), ("saveImageToGallery", 2), ("sp-fbtn", 6),
                  ("SHARE.playDeepLink", 3), ("&l=", 1), ("sp-fmtrow", 2)]:
    got = H2.count(k)
    print(f"  {k!r}: {got} (>= {least})")
    assert got >= least, f"{k} 数量不足"
assert "176, 806" not in H2, "旧的写死内容区间还在"
assert "176, 592" not in H2, "旧的写死 scroll 区间还在"
assert "yScales" not in H2 and "ringCy" not in H2
print("结构校验通过")
