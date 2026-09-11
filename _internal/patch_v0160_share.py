# -*- coding: utf-8 -*-
"""v0.16.0 分享功能 P0 —— 纯追加实施补丁（不改任何旧代码）

设计铁律（与 v0.15.0 的教训一致）：
  1. 新块必须放在 </body> 前 → 成为最后一个 <style>/<script>，source order 赢
  2. 全程 'rb' 读 / 'wb' 写；注入块用 \\n 写完后统一归一化为 CRLF，并断言裸 LF = 0
  3. 函数同名覆盖：后声明的 function 覆盖先前声明（全局绑定），
     所以 openShare/closeShare/copyShare/shareSinoky 用「重新声明」方式升级，不删旧码
  4. 包装类改造（markDone / nonoWatchBadges）用 window.xxx = function 覆盖并保留原函数引用
"""
import re, os, io

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)
P = "index.html"
b = open(P, "rb").read()
H = b.decode("utf-8")
assert H.count("\r\n") > 3000 and (H.count("\n") - H.count("\r\n")) == 0, "文件不是完整 CRLF，中止"
orig_len = len(H)

# ============================================================
# 1) 新样式块
# ============================================================
CSS = r'''
<style id="cn-share">
/* v0.16.0 分享功能 P0 —— 中式分享卡片 + 弹层重做。
   铁律：不新增设计语言。按钮全部复用 .btn/.btn.primary/.btn.ghost（v0.15.0 已加内嵌金环），
   输入框复用全局 input 胶囊（99px + 内嵌金线），只补版式与卡片预览框。 */
#share-panel{ width:min(92vw,406px); background:var(--card); color:var(--txt);
  border-radius:18px; padding:18px 16px 16px; display:none; border:1px solid rgba(201,168,108,.34);
  max-height:90vh; overflow:auto; }
#share-panel .sp-h{ font-family:"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",serif;
  font-size:17px; font-weight:600; margin:0 0 4px; }
#share-panel .sp-sub{ font-size:12px; color:var(--sub); line-height:1.55; margin-bottom:12px; }
#share-panel .sp-prev{ width:100%; border-radius:14px; overflow:hidden; background:#161a20;
  border:1px solid rgba(201,168,108,.3); display:flex; justify-content:center; }
#share-panel .sp-prev img{ width:100%; max-width:324px; display:block; }
#share-panel .sp-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:10px 0 12px; }
#share-panel .sp-tname{ font-size:12px; color:var(--gold); letter-spacing:.3px; }
#share-panel .sp-swap{ font-size:12px; padding:6px 15px; border-radius:99px; cursor:pointer;
  background:transparent; color:var(--txt); border:1px solid rgba(201,168,108,.45); }
#share-panel .sp-nick{ display:block; margin:0 0 12px; }
#share-panel .sp-nick input{ width:100%; box-sizing:border-box; font-size:13px; }
#share-panel .btn{ width:100%; margin-top:8px; }
#share-panel .sp-wx{ font-size:11px; color:var(--sub); line-height:1.55; margin-top:11px; }
#share-panel .sp-priv{ font-size:10.5px; color:var(--sub); opacity:.72; line-height:1.5; margin-top:8px; }
</style>
'''

# ============================================================
# 2) 分享模块 JS
# ============================================================
JS = r'''
<script id="cn-share-mod">
/* ============================================================
   v0.16.0 分享功能 P0（九思）
   纲领：分享的不是 App，是你说出的那句中文。
   - 卡片主体 = 用户真实开口过的句子（S.phrases），品牌只做署名（<12% 面积）
   - 五主题：start / line / streak / city / badge；从「当前可渲染」的池里加权随机，
     并支持手动切换 —— 纯随机会给新用户发出空卡（未解锁徽章却抽到徽章卡）
   - 零第三方依赖：Canvas 2D 原生合成。失败降级到已有 assets/share/*.webp，永不空手
   - 隐私：卡片绝不含 UID / 录音 / 设备信息；昵称存独立 localStorage，不上云
   - 归因：随机分享码（与 UID 无关联），一次分享一个码
   ============================================================ */
var SHARE = {
  theme:'line', code:'', ctx:null, _mounted:false, _cv:null, _nickT:null,
  KEY_NICK:'sinoky_share_nick'
};

/* ---------- 常量 ---------- */
SHARE.SERIF = '"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun",serif';
SHARE.SANS  = '-apple-system,"Segoe UI",Roboto,"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif';
SHARE.C = { bg:'#161a20', red:'#c2362b', gold:'#c9a86c', goldDim:'#8a7448', paper:'#f5f1e8', teal:'#8ab8b2' };

/* 徽章 id → 印章内单字 + 展示名（仅展示标签，判定条件仍复用 App 现有逻辑） */
SHARE.BADGE = {
  'first-speak':['开','First speak'], 'streak3':['连','3-day streak'], 'streak7':['连','7-day streak'],
  'streak14':['连','14-day streak'], 'perfect':['准','Perfect tone'], 'survivor':['存','Survivor · Day 6'],
  'tone-master':['调','Tone master'], 'graduate':['成','Graduate · Day 30'], 'centurion':['百','100-day streak'],
  'first_city':['城','First landmark'], 'explorer':['游','5 landmarks'], 'map_master':['图','All landmarks'],
  'reversal-king':['转','Reversal king'], 'real-world':['野','In the wild'], 'polyglot-path':['通','All paths']
};
SHARE.TNAME = { start:'Just started', line:'This line I said', streak:'My streak', city:'City unlocked', badge:'New badge' };

/* ---------- 基础读取（全部只用真实数据，绝不编造） ---------- */
SHARE.said = function(){
  var n = 0; try{ Object.keys(S.phrases||{}).forEach(function(k){ n += (S.phrases[k]||[]).length; }); }catch(e){}
  return n;
};
SHARE.badgeOn = function(){
  try{ return Object.keys(JSON.parse(localStorage.getItem('sinoky_badges_on') || '{}')); }catch(e){ return []; }
};
SHARE.nick = function(){ try{ return localStorage.getItem(SHARE.KEY_NICK) || ''; }catch(e){ return ''; } };
SHARE.setNick = function(v){
  /* 只做长度与空白清理，不做激进过滤：昵称是用户自己的展示名，且绝不上云、绝不进链接 */
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').slice(0, 16);
  try{ localStorage.setItem(SHARE.KEY_NICK, s); }catch(e){}
  if (SHARE._nickT) clearTimeout(SHARE._nickT);
  SHARE._nickT = setTimeout(function(){ SHARE.render(); }, 320);
  return s;
};

/* 最近一次开口的那一句：优先用触发时带来的上下文，退化到「最后一个有记录的场景的末句」 */
SHARE.lastLine = function(){
  var c = SHARE.ctx;
  if (c && c.sc && typeof c.i === 'number' && c.sc.phrases && c.sc.phrases[c.i]) return { sc:c.sc, i:c.i, p:c.sc.phrases[c.i] };
  var found = null;
  try{
    for (var n=0; n<SCENES.length; n++){
      var sc = SCENES[n], arr = (S.phrases||{})[sc.id];
      if (arr && arr.length && sc.phrases && sc.phrases[arr[arr.length-1]]) found = { sc:sc, i:arr[arr.length-1], p:sc.phrases[arr[arr.length-1]] };
    }
  }catch(e){}
  return found;
};
/* 最近通关的城市（该城全部句子都说过） */
SHARE.litCity = function(){
  try{
    var cities = (typeof cityList === 'function') ? cityList() : [];
    var lit = cities.filter(function(sc){ return (S.phrases[sc.id]||[]).length >= (sc.phrases||[]).length && (sc.phrases||[]).length > 0; });
    if (!lit.length) return null;
    var c = lit[lit.length-1], arr = S.phrases[c.id] || [], li = arr[arr.length-1], cp = (c.phrases||[])[li];
    return { sc:c, cn:(c.city || String(c.title||'').split(' \u00b7 ')[0]), en:String(c.title||'').split(' \u00b7 ')[0], line: cp ? { hz:cp.hz, py:cp.py, en:cp.en } : null };
  }catch(e){ return null; }
};
SHARE.topBadge = function(){
  var on = SHARE.badgeOn();
  if (!on.length) return null;
  var id = on[on.length-1];                       /* 本地记录是追加写入，末尾即最近解锁 */
  var m = SHARE.BADGE[id] || ['徽', id];
  return { id:id, seal:m[0], name:m[1], total:on.length };
};

/* ---------- 主题池：可用性过滤 + 权重 ---------- */
SHARE.pool = function(){
  var pool = [];
  var line = SHARE.lastLine();
  if (line && line.p && line.p.hz) pool.push({ id:'line', w:5 });      /* 社交货币最强 → 权重最高 */
  if ((S.streak||0) >= 2) pool.push({ id:'streak', w:2 });
  if (SHARE.litCity()) pool.push({ id:'city', w:2 });
  if (SHARE.topBadge()) pool.push({ id:'badge', w:1 });
  if (!pool.length) pool.push({ id:'start', w:1 });                    /* 零数据用户 → 起点卡，绝不出空卡 */
  return pool;
};
SHARE.pick = function(prefer){
  var pool = SHARE.pool(), i;
  if (prefer) for (i=0;i<pool.length;i++) if (pool[i].id===prefer){ SHARE.theme=prefer; return; }
  var tot = 0; pool.forEach(function(p){ tot += p.w; });
  var r = Math.random()*tot, acc = 0;
  for (i=0;i<pool.length;i++){ acc += pool[i].w; if (r <= acc){ SHARE.theme = pool[i].id; return; } }
  SHARE.theme = pool[0].id;
};
SHARE.swap = function(){
  var pool = SHARE.pool(), ids = pool.map(function(p){ return p.id; });
  var i = ids.indexOf(SHARE.theme);
  SHARE.theme = ids[(i+1) % ids.length];
  SHARE.render();
};

/* ---------- 归因码：随机，与 UID 无任何关联 ---------- */
SHARE.newCode = function(){
  var a = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '';
  try{
    var buf = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i=0;i<8;i++) s += a[buf[i] % a.length];
  }catch(e){ for (var j=0;j<8;j++) s += a[Math.floor(Math.random()*a.length)]; }
  return s;
};
SHARE.link = function(){ return 'https://sinoky.pages.dev/?s=' + SHARE.code + '&t=' + SHARE.theme; };
SHARE.text = function(){
  var line = SHARE.lastLine();
  if (SHARE.theme === 'line' && line && line.p && line.p.hz){
    return '"' + line.p.hz + '" (' + (line.p.py||'') + ')\n' +
           'I said this in Chinese today. Learning to actually speak it with Sinoky (free) \u2192 ' + SHARE.link();
  }
  return 'I\u2019m learning to actually speak Chinese with Sinoky (free beta) \u2192 ' + SHARE.link();
};

/* ============================================================
   Canvas 合成器（1080×1080）—— 零依赖
   ============================================================ */
function _hui(ctx, x, y, w, s, alpha){
  /* 回纹 = 「回」字：外方 + 内方，二方连续。描边式，不填充（不压内容） */
  ctx.save(); ctx.strokeStyle = 'rgba(201,168,108,' + alpha + ')'; ctx.lineWidth = 2;
  var step = s + Math.round(s*0.42);
  for (var px = x; px + s <= x + w; px += step){
    ctx.strokeRect(px + 0.5, y + 0.5, s - 1, s - 1);
    ctx.strokeRect(px + s*0.3, y + s*0.3, s*0.4, s*0.4);
  }
  ctx.restore();
}
function _corner(ctx, cx, cy, rot, alpha){
  /* 如意云头角花：两卷云 + 一段弧，只描边 */
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.strokeStyle = 'rgba(201,168,108,' + alpha + ')'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, 76); ctx.bezierCurveTo(0, 26, 26, 0, 76, 0); ctx.stroke();
  ctx.beginPath(); ctx.arc(30, 30, 13, Math.PI, Math.PI*2.45); ctx.stroke();
  ctx.beginPath(); ctx.arc(58, 14, 8, Math.PI, Math.PI*2.45); ctx.stroke();
  ctx.restore();
}
function _brand(ctx, x, y, size){
  /* Sino<k>y —— k 用朱砂，其余纸色 */
  ctx.save();
  ctx.font = '600 ' + size + 'px ' + SHARE.SERIF;
  ctx.textBaseline = 'alphabetic';
  var a = 'Sino', k = 'k', y2 = 'y';
  var wa = ctx.measureText(a).width, wk = ctx.measureText(k).width;
  ctx.fillStyle = SHARE.C.paper; ctx.fillText(a, x, y);
  ctx.fillStyle = SHARE.C.red;   ctx.fillText(k, x + wa, y);
  ctx.fillStyle = SHARE.C.paper; ctx.fillText(y2, x + wa + wk, y);
  ctx.restore();
}
function _seal(ctx, x, y, s){
  /* 朱砂印：实底 + 内细金线 + 单字 */
  var r = Math.round(s * 0.2);
  ctx.save();
  ctx.fillStyle = SHARE.C.red;
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, s, s, r); } else { ctx.rect(x, y, s, s); }
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,241,232,.5)'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x + s*0.13, y + s*0.13, s*0.74, s*0.74, r*0.55); } else { ctx.rect(x + s*0.13, y + s*0.13, s*0.74, s*0.74); }
  ctx.stroke();
  ctx.fillStyle = SHARE.C.paper; ctx.font = '600 ' + Math.round(s*0.5) + 'px ' + SHARE.SERIF;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('\u8bfa', x + s/2, y + s/2 + 1);
  ctx.restore();
}
function _fit(ctx, txt, maxW, start, min, font){
  var s = start;
  while (s > min){ ctx.font = s + 'px ' + font; if (ctx.measureText(txt).width <= maxW) break; s -= 4; }
  return s;
}
function _wrapCJK(ctx, txt, maxW, font, size){
  /* 汉字按字数折行，最多 2 行（超过 18 字不再缩，交给 fit 缩小） */
  var chars = String(txt || '').split('');
  if (chars.length <= 9) return [String(txt || '')];
  var half = Math.ceil(chars.length / 2);
  return [chars.slice(0, half).join(''), chars.slice(half).join('')];
}
function _twoline(ctx, lines, x, y, lh){
  for (var i=0;i<lines.length;i++) ctx.fillText(lines[i], x, y + i*lh);
}

SHARE.draw = function(){
  var S_ = SHARE.C, W = 1080, PAD = 84;
  var cv = document.createElement('canvas'); cv.width = W; cv.height = W;
  var ctx = cv.getContext('2d');
  if (!ctx) return null;

  /* 底 */
  ctx.fillStyle = S_.bg; ctx.fillRect(0, 0, W, W);
  /* 四角如意云头 */
  _corner(ctx, 52, 52, 0, .45);
  _corner(ctx, W-52, 52, Math.PI/2, .45);
  _corner(ctx, W-52, W-52, Math.PI, .45);
  _corner(ctx, 52, W-52, -Math.PI/2, .45);
  /* 顶部回纹带 */
  _hui(ctx, 150, 58, W-300, 22, .45);
  /* 底部金线 */
  ctx.save(); ctx.strokeStyle = 'rgba(201,168,108,.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, 896); ctx.lineTo(W-PAD, 896); ctx.stroke(); ctx.restore();

  var d = {
    said:SHARE.said(), streak:(S.streak||0), nick:SHARE.nick(),
    line:SHARE.lastLine(), city:SHARE.litCity(), badge:SHARE.topBadge()
  };
  var cx = W/2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  var label = '', hz = '', py = '', en = '', sub = '', stat = '';

  if (SHARE.theme === 'line' && d.line){
    label = 'I SAID THIS OUT LOUD';
    hz = d.line.p.hz || ''; py = d.line.p.py || ''; en = d.line.p.en || '';
    stat = d.said > 0 ? ('Phrases said: ' + d.said) : '';
  } else if (SHARE.theme === 'streak'){
    label = 'DAY STREAK'; sub = String(d.streak);
    stat = 'Phrases said: ' + d.said + (d.badge ? ('  \u00b7  Badges: ' + d.badge.total) : '');
  } else if (SHARE.theme === 'city' && d.city){
    label = 'CITY UNLOCKED'; hz = d.city.cn; py = d.city.en;
    if (d.city.line){ en = d.city.line.hz || ''; sub = d.city.line.en || ''; }
    stat = 'Landmarks lit: ' + (function(){ try{ return litCount(); }catch(e){ return 0; } })();
  } else if (SHARE.theme === 'badge' && d.badge){
    label = 'BADGE UNLOCKED'; hz = d.badge.seal; py = d.badge.name;
    stat = 'Badges: ' + d.badge.total;
  } else {
    label = 'JUST STARTED'; hz = '\u4f60\u597d\uff01'; py = 'N\u01d0 h\u01ceo!';
    en = 'Hello \u2014 I\u2019m starting to learn Chinese.';
    stat = 'Free during beta';
  }

  /* 标签 */
  ctx.fillStyle = S_.goldDim; ctx.font = '400 26px ' + SHARE.SANS;
  ctx.fillText(label, cx, 214);
  if (d.nick){
    ctx.fillStyle = 'rgba(245,241,232,.55)'; ctx.font = '400 26px ' + SHARE.SANS;
    ctx.fillText(d.nick, cx, 254);
  }

  if (SHARE.theme === 'streak'){
    /* 大数字 + 龙鳞（进度 = 奖励 = 鎏金；透明度随 streak 递增） */
    ctx.fillStyle = S_.gold; ctx.font = '600 200px ' + SHARE.SERIF;
    ctx.fillText(sub, cx, 400);
    var prog = Math.max(1, Math.min(5, Math.round((d.streak / 7) * 5) || 1));
    var sw = 62, sh = 16, gap = 8, total = 5*sw + 4*gap, sx = cx - total/2;
    for (var i2=0;i2<5;i2++){
      var on = i2 < prog;
      ctx.fillStyle = 'rgba(201,168,108,' + (on ? (0.32 + i2*0.17).toFixed(2) : '0.16') + ')';
      ctx.beginPath();
      var x0 = sx + i2*(sw+gap);
      if (ctx.roundRect) ctx.roundRect(x0, 470, sw, sh, [8,8,0,0]); else ctx.rect(x0, 470, sw, sh);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(245,241,232,.62)'; ctx.font = '600 34px ' + SHARE.SANS;
    ctx.fillText('DAYS IN A ROW', cx, 540);
  } else if (SHARE.theme === 'badge' && d.badge){
    /* 印章式圆环 */
    ctx.save();
    ctx.strokeStyle = 'rgba(201,168,108,.34)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, 386, 116, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = S_.gold; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, 386, 92, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = S_.gold; ctx.font = '600 92px ' + SHARE.SERIF;
    ctx.fillText(hz, cx, 390);
    ctx.fillStyle = S_.paper; ctx.font = '600 40px ' + SHARE.SERIF;
    ctx.fillText(py, cx, 552);
  } else {
    /* 汉字（主题字）：按字数自适应，最多两行 */
    var maxW = W - PAD*2 - 40;
    var start = (hz.length <= 3 ? 210 : hz.length <= 5 ? 176 : hz.length <= 8 ? 140 : 116);
    var fs = _fit(ctx, hz, maxW, start, 72, SHARE.SERIF);
    ctx.font = fs + 'px ' + SHARE.SERIF;
    var lines = (ctx.measureText(hz).width > maxW) ? _wrapCJK(ctx, hz, maxW, SHARE.SERIF, fs) : [hz];
    ctx.fillStyle = (SHARE.theme === 'city') ? S_.teal : S_.paper;
    ctx.fillText(lines[0], cx, lines.length > 1 ? 372 : 392);
    if (lines.length > 1){
      ctx.font = Math.round(fs*0.86) + 'px ' + SHARE.SERIF;
      ctx.fillText(lines[1], cx, 372 + fs*1.08);
    }
    var yP = lines.length > 1 ? 392 + fs*1.2 : 392 + fs*0.78;
    if (py){
      ctx.fillStyle = S_.gold;
      var pf = _fit(ctx, py, maxW, 44, 26, SHARE.SANS);
      ctx.font = pf + 'px ' + SHARE.SANS;
      ctx.fillText(py, cx, yP);
      yP += Math.max(60, pf*1.5);
    }
    if (en){
      ctx.fillStyle = 'rgba(245,241,232,.62)';
      var ef = _fit(ctx, en, maxW, 40, 24, SHARE.SANS);
      ctx.font = ef + 'px ' + SHARE.SANS;
      ctx.fillText(en, cx, yP);
    }
  }

  /* 真实数据行（绝不编造分数） */
  if (stat){
    ctx.fillStyle = 'rgba(245,241,232,.5)'; ctx.font = '400 30px ' + SHARE.SANS;
    ctx.fillText(stat, cx, 700);
  }

  /* L1 品牌层：署名，不是主体 */
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(245,241,232,.42)'; ctx.font = '400 27px ' + SHARE.SANS;
  ctx.fillText('sinoky.pages.dev', PAD, 998);
  _brand(ctx, PAD, 958, 48);
  _seal(ctx, W - PAD - 96, 916, 96);
  ctx.textAlign = 'center';
  return cv;
};

/* ============================================================
   弹层（JS 构建，避免脆弱的 markup 文本匹配）
   ============================================================ */
SHARE.PANEL = ''
 + '<div class="sp-h">Share this card</div>'
 + '<div class="sp-sub">This is exactly what your friends will see. '
 + 'Chinese characters, pinyin and English \u2014 so anyone can read it.</div>'
 + '<div class="sp-prev"><img id="sp-img" alt="Share card preview"></div>'
 + '<div class="sp-row"><span class="sp-tname" id="sp-tname"></span>'
 + '<button class="sp-swap" onclick="SHARE.swap()">Shuffle</button></div>'
 + '<label class="sp-nick"><input id="sp-nick" maxlength="16" placeholder="Your name (optional)" oninput="SHARE.setNick(this.value)"></label>'
 + '<button class="btn primary" id="sp-share" onclick="SHARE.doShare()">Share\u2026</button>'
 + '<button class="btn ghost" id="sp-save" onclick="SHARE.doSave()">Save image</button>'
 + '<button class="btn ghost" id="sp-copy" onclick="copyShare()">Copy text + link</button>'
 + '<div class="sp-wx" id="sp-wx"></div>'
 + '<div class="sp-priv">No account, no recording, no device ID on this card \u2014 '
 + 'just the Chinese you actually said.</div>';

SHARE.mount = function(){
  if (SHARE._mounted) return;
  var p = $('share-panel'); if (!p) return;
  p.innerHTML = SHARE.PANEL;
  var ni = $('sp-nick'); if (ni) ni.value = SHARE.nick();
  SHARE._mounted = true;
  try{ if (typeof applyI18n === 'function') applyI18n(p); }catch(e){}
};

SHARE.render = function(){
  SHARE.mount();
  var cv = SHARE.draw(); if (!cv) return;
  SHARE._cv = cv;
  var img = $('sp-img');
  try{ if (img) img.src = cv.toDataURL('image/png'); }catch(e){}
  var tn = $('sp-tname'); if (tn) tn.textContent = SHARE.TNAME[SHARE.theme] || '';
  /* 环境适配：三个动作按能力取舍 */
  var ua = navigator.userAgent || '';
  var wx = /micromessenger|qq\//i.test(ua);
  var canShare = !!navigator.share;
  var sb = $('sp-share'), sv = $('sp-save'), wt = $('sp-wx'), cp = $('sp-copy');
  if (sb) sb.style.display = (canShare && !wx) ? '' : 'none';
  if (sv) sv.style.display = wx ? 'none' : '';
  if (cp) cp.style.display = '';
  if (wt) wt.textContent = wx
    ? 'Opened inside WeChat \u2014 press and hold the card above to save it, or use \u201cCopy text + link\u201d.'
    : (canShare ? '' : 'Your browser can\u2019t open the system share sheet \u2014 save the image instead.');
};

SHARE.open = function(theme){
  SHARE.mount();
  SHARE.code = SHARE.newCode();
  SHARE.pick(theme);
  SHARE.render();
  var m = $('share-mask'), p = $('share-panel');
  if (m) m.style.display = 'block';
  if (p) p.style.display = 'block';
};

SHARE.blob = function(){
  var cv = SHARE._cv || SHARE.draw();
  SHARE._cv = cv;
  if (!cv) return Promise.reject(new Error('no canvas'));
  return new Promise(function(res){
    if (cv.toBlob) cv.toBlob(function(bl){ res(bl); }, 'image/png');
    else {
      try{
        var d = cv.toDataURL('image/png').split(',')[1], bin = atob(d), arr = new Uint8Array(bin.length);
        for (var i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
        res(new Blob([arr], { type:'image/png' }));
      }catch(e){ res(null); }
    }
  });
};

SHARE.doShare = function(){
  var txt = SHARE.text(), url = SHARE.link();
  if (!navigator.share){ copyShare(); return; }
  SHARE.blob().then(function(bl){
    if (bl){
      var f = new File([bl], 'sinoky-' + SHARE.theme + '.png', { type:'image/png' });
      if (navigator.canShare && navigator.canShare({ files:[f] })){
        return navigator.share({ files:[f], title:'Sinoky', text:txt });
      }
    }
    return navigator.share({ title:'Sinoky', text:txt, url:url });
  }).catch(function(){
    /* 用户取消 share 也会 reject —— 不再二次弹出，静默即可 */
  });
};

SHARE.doSave = function(){
  SHARE.blob().then(function(bl){
    if (!bl){ toast('Could not build the image \u2014 try Share or Copy instead'); return; }
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
};

/* ============================================================
   函数覆盖：后声明的 function 覆盖先前声明（全局绑定）
   ============================================================ */
function openShare(theme){ SHARE.open(theme); }
function closeShare(){
  var m = $('share-mask'), p = $('share-panel');
  if (m) m.style.display = 'none';
  if (p) p.style.display = 'none';
}
function shareSinoky(){ SHARE.open(); }          /* 旧入口一律升级到新弹层 */
function copyShare(){
  var t = SHARE.text();
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(function(){ toast('Copied \u2014 paste it anywhere'); })
      .catch(function(){ fallbackCopy(t); });
  } else { fallbackCopy(t); }
}

/* ============================================================
   入口前置三处（全部用包装，不改旧代码）
   ============================================================ */
/* 通用：把分享按钮追加到诺诺气泡的动作行 */
SHARE.nonoOffer = function(theme){
  setTimeout(function(){
    try{
      var acts = document.getElementById('nono-acts'), panel = document.getElementById('nono-panel');
      if (!acts || !panel || panel.style.display === 'none') return;
      if (acts.querySelector('[data-share]')) return;
      acts.insertAdjacentHTML('beforeend',
        '<button data-share onclick="SHARE.open(\'' + theme + '\')">Share this card</button>');
      try{ if (typeof applyI18n === 'function') applyI18n(acts); }catch(e){}
    }catch(e){}
  }, 140);
};

/* E1 + 上下文记录：包装 markDone。场景刚被说全 → 祝贺气泡里加分享按钮 */
(function(){
  if (typeof window.markDone !== 'function') return;
  var _md = window.markDone;
  window.markDone = function(i){
    var sc = (typeof curScene !== 'undefined' && curScene) ? curScene : null;
    var cid = sc ? sc.id : null;
    var pre = true;
    try{ pre = !!(cid && window.NONO && NONO.sceneCheer && NONO.sceneCheer[cid]); }catch(e){}
    var r = _md.apply(this, arguments);
    try{
      if (sc) SHARE.ctx = { sc: sc, i: i };                       /* 记住刚处理的那句，供分享取用 */
      if (cid && !pre && window.NONO && NONO.sceneCheer && NONO.sceneCheer[cid]) SHARE.nonoOffer('line');
    }catch(e){}
    return r;
  };
})();

/* E2：包装 nonoWatchBadges。有徽章新解锁 → 气泡里加分享按钮 */
(function(){
  if (typeof window.nonoWatchBadges !== 'function') return;
  var _wb = window.nonoWatchBadges;
  window.nonoWatchBadges = function(){
    var before = '';
    try{ before = localStorage.getItem('sinoky_badges_on') || ''; }catch(e){}
    var r = _wb.apply(this, arguments);
    var after = '';
    try{ after = localStorage.getItem('sinoky_badges_on') || ''; }catch(e){}
    try{ if (after && after !== before) SHARE.nonoOffer('badge'); }catch(e){}
    return r;
  };
})();

/* E3：把「我」页的旧分享按钮接到新弹层（JS 改属性，不做文本匹配） */
(function(){
  try{
    var btn = document.querySelector('#v-me button[onclick="shareSinoky()"]');
    if (btn){ btn.setAttribute('onclick', 'SHARE.open()'); btn.textContent = 'Share my progress'; }
  }catch(e){}
})();

/* ============================================================
   归因：落地页读 ?s= 上报一次（sessionStorage 防重复），只计数，不识别个人
   ============================================================ */
(function(){
  try{
    var q = new URLSearchParams(location.search || '');
    var c = (q.get('s') || '').toLowerCase();
    if (!/^[a-z0-9]{4,12}$/.test(c)) return;
    var t = (q.get('t') || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
    try{ if (sessionStorage.getItem('sinoky_sh_seen') === c) return; sessionStorage.setItem('sinoky_sh_seen', c); }catch(e){}
    var base = (typeof API_BASE === 'string' && API_BASE) ? API_BASE : '/';
    if (base.charAt(base.length-1) !== '/') base += '/';
    fetch(base + 'api/share', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ c:c, t:t }) })
      .catch(function(){});
  }catch(e){}
})();
</script>
'''

# ============================================================
# 3) 插入（必须在 </body> 前，成为最后一个 style/script）
# ============================================================
assert H.count("</body>") == 1, "body 结束标签异常"
assert "cn-share-mod" not in H, "已注入过，中止"
H = H.replace("</body>", CSS + "\n" + JS + "</body>")

# ============================================================
# 4) CRLF 归一化
# ============================================================
data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open(P, "wb").write(data)
H2 = data.decode("utf-8")
lone = data.count(b"\n") - data.count(b"\r\n")

# ============================================================
# 5) 守卫
# ============================================================
print("裸 LF:", lone)
assert lone == 0
print("文件长度:", orig_len, "->", len(H2))

# 位置：我的两个块必须是最后的 style / script
styles = [m.start() for m in re.finditer(r'<style[^>]*>', H2)]
scripts = [m.start() for m in re.finditer(r'<script[^>]*>', H2)]
print("style 块数:", len(styles), "| 我的块是最一个:", 'id="cn-share"' in H2[styles[-1]:styles[-1]+40])
print("script 块数:", len(scripts), "| 我的块是最一个:", 'id="cn-share-mod"' in H2[scripts[-1]:scripts[-1]+50])
assert 'id="cn-share"' in H2[styles[-1]:styles[-1]+40], "样式块不在最后"
assert 'id="cn-share-mod"' in H2[scripts[-1]:scripts[-1]+50], "脚本块不在最后"
assert H2.find('id="cn-share-mod"') < H2.find("</body>"), "脚本块不在 body 内"
assert H2.count("</body>") == 1

# 关键结构
for k, want in [("var SHARE = {", 1), ("SHARE.draw = function", 1), ("function openShare(theme)", 1),
                ("data-share", 1), ("sinoky-share-nick-none", 0), ("api/share", 1)]:
    n = H2.count(k)
    print(f"  {k}: {n}")
assert H2.count("var SHARE = {") == 1
assert H2.count("SHARE.draw = function") == 1
assert H2.count("function openShare(theme)") == 1
assert H2.count("api/share") == 1
# 隐私守卫：昵称绝不能进上云状态对象 S；模块里不得真正引用 UID 变量
assert "S.nick" not in JS, "昵称写进了上云状态对象 S"
assert not re.search(r"(?:^|[^\w])UID\s*(?:\.|\[|\.slice|\+)", JS), "分享模块里真的引用了 UID"
for bad in ["\\1", "\\2", "__CTL__", "undefined\'"]:
    assert H2.count(bad) == 0, f"残留 {bad}"

print("结构校验通过")
