# -*- coding: utf-8 -*-
"""v0.16.0 分享卡片排版修正（第三补丁）
目视验收发现的问题（全部来自真机截图，非推断）：
  P1 城巿卡把英文翻译挤掉了 —— 违反「汉字/拼音/英文三行齐备」硬约束（A 圈看不懂）
  P2 连续卡大数字与龙鳞进度重叠（7 压住了鳞片）
  P3 底部两枚角花压住 sinoky.pages.dev 与朱砂印（违反「纹样不压正文」禁忌）
  P4 龙鳞画成了圆角矩形，读不出「鳞」
  P5 各主题 stat 行位置写死在 700，留白不均
修法：把内容改「自顶向下的游标式排版」，元素之间用真实留白串起来；
     四角几何统一为 inset 34 / R 56，页脚整体上移到角花区间之上。
"""
import os, re, subprocess

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)

P = "index.html"
H = open(P, "rb").read().decode("utf-8")

START = "function _hui(ctx, x, y, w, s, alpha){"
ENDMARK = "/* ============================================================\r\n   弹层（JS 构建"
i = H.find(START)
j = H.find(ENDMARK, i)
assert i > 0 and j > i, f"定位失败 i={i} j={j}"
old_block = H[i:j]
assert "SHARE.draw = function" in old_block and len(old_block) < 9000, "旧块范围异常"
print("待替换块长度:", len(old_block))

NEW = r'''function _hui(ctx, x, y, w, s, alpha){
  /* 回纹 = 「回」字（外方 + 内方）二方连续。描边式，不填充 —— 纹样只做边饰，不压内容 */
  ctx.save(); ctx.strokeStyle = 'rgba(201,168,108,' + alpha + ')'; ctx.lineWidth = 2;
  var step = s + Math.round(s*0.42);
  for (var px = x; px + s <= x + w; px += step){
    ctx.strokeRect(px + 0.5, y + 0.5, s - 1, s - 1);
    ctx.strokeRect(px + s*0.32, y + s*0.32, s*0.36, s*0.36);
  }
  ctx.restore();
}
function _corner(ctx, cx, cy, rot, alpha, R){
  /* 如意云头角花：一段弧 + 两卷云。统一 R=56，让四角几何完全一致 */
  R = R || 56;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.strokeStyle = 'rgba(201,168,108,' + alpha + ')';
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, R); ctx.bezierCurveTo(0, R*0.34, R*0.34, 0, R, 0); ctx.stroke();
  ctx.beginPath(); ctx.arc(R*0.40, R*0.40, R*0.17, Math.PI, Math.PI*2.45); ctx.stroke();
  ctx.beginPath(); ctx.arc(R*0.76, R*0.19, R*0.105, Math.PI, Math.PI*2.45); ctx.stroke();
  ctx.restore();
}
function _brand(ctx, x, y, size){
  /* Sino<k>y —— k 用朱砂，其余纸色 */
  ctx.save();
  ctx.font = '600 ' + size + 'px ' + SHARE.SERIF;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  var a = 'Sino', k = 'k', y2 = 'y';
  var wa = ctx.measureText(a).width, wk = ctx.measureText(k).width;
  ctx.fillStyle = SHARE.C.paper; ctx.fillText(a, x, y);
  ctx.fillStyle = SHARE.C.red;   ctx.fillText(k, x + wa, y);
  ctx.fillStyle = SHARE.C.paper; ctx.fillText(y2, x + wa + wk, y);
  ctx.restore();
}
function _seal(ctx, x, y, s){
  var r = Math.round(s * 0.2);
  ctx.save();
  ctx.fillStyle = SHARE.C.red;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, s, s, r); else ctx.rect(x, y, s, s);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,241,232,.5)'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x + s*0.13, y + s*0.13, s*0.74, s*0.74, r*0.55); else ctx.rect(x + s*0.13, y + s*0.13, s*0.74, s*0.74);
  ctx.stroke();
  ctx.fillStyle = SHARE.C.paper; ctx.font = '600 ' + Math.round(s*0.5) + 'px ' + SHARE.SERIF;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('\u8bfa', x + s/2, y + s/2 + 1);
  ctx.restore();
}
function _fit(ctx, txt, maxW, start, min, font, weight){
  var s = start;
  while (s > min){ ctx.font = (weight||'') + s + 'px ' + font; if (ctx.measureText(txt).width <= maxW) break; s -= 4; }
  return s;
}
function _cjkLines(ctx, txt, maxW, font, weight){
  /* 汉字折行：先试单行，超宽则在字数中点断成两行（中文可任意处断行） */
  var t = String(txt || '');
  ctx.font = (weight||'') + '100px ' + font;
  var chars = t.split('');
  var lo = 1, hi = chars.length, half = chars.length;
  if (ctx.measureText(t).width / 100 * 100 <= maxW) return [t];   /* 单行走得下 */
  /* 二分找最小行数：先按中点硬分两行 */
  half = Math.ceil(chars.length / 2);
  return [chars.slice(0, half).join(''), chars.slice(half).join('')];
}

/* 游标式纵向排版：元素自带真实留白 h，整块在 [top,bot] 区间内垂直居中。
   取代原先各自写死的 y —— 那是留白不均与元素重叠的根源。 */
function _stack(ctx, cx, items, top, bot){
  var total = 0;
  items.forEach(function(it){
    var lines = it.lines || [it.t];
    it._lh = Math.round(it.size * 1.24);
    it._blk = it._lh * lines.length;
    it.h = it.h || (it._blk + (it.gap || 0));
    total += it.h;
  });
  var y = top + Math.max(0, (bot - top - total) / 2);
  items.forEach(function(it){
    var lines = it.lines || [it.t];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = (it.weight || '400') + ' ' + it.size + 'px ' + it.font;
    ctx.fillStyle = it.color;
    var y0 = y + Math.max(0, (it.h - it._blk)/2) + it._lh/2;
    for (var k = 0; k < lines.length; k++) ctx.fillText(lines[k], cx, y0 + k*it._lh);
    y += it.h;
  });
  return y;
}
/* 龙鳞：尖顶叠瓦（不是圆角矩形 —— 那读不出「鳞」） */
function _scales(ctx, cx, baseY, on, alphaOn){
  var n = 5, sw = 62, gap = 8, hh = 36;
  var total = n*sw + (n-1)*gap, sx = cx - total/2;
  for (var i = 0; i < n; i++){
    var x0 = sx + i*(sw + gap);
    ctx.beginPath();
    ctx.moveTo(x0, baseY);
    ctx.quadraticCurveTo(x0 + sw/2, baseY - hh*1.75, x0 + sw, baseY);
    ctx.closePath();
    var lit = i < on;
    ctx.fillStyle = 'rgba(201,168,108,' + (lit ? (0.34 + i*0.16).toFixed(2) : '0.15') + ')';
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,168,108,' + (lit ? 0.75 : 0.22) + ')';
    ctx.lineWidth = 2; ctx.stroke();
  }
}

SHARE.draw = function(){
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
  _hui(ctx, 150, 58, W-300, 22, .45);

  var d = {
    said:SHARE.said(), streak:(S.streak||0), nick:SHARE.nick(),
    line:SHARE.lastLine(), city:SHARE.litCity(), badge:SHARE.topBadge()
  };
  var maxW = W - PAD*2 - 40;
  var items = [];
  var push = function(o){ items.push(o); };

  /* ---- 内容：每主题三行齐备（汉字 / 拼音 / 英文），A 圈也读得懂 ---- */
  if (SHARE.theme === 'line' && d.line){
    push({ t:'I SAID THIS OUT LOUD', size:26, font:SHARE.SANS, color:S_.goldDim, gap:26 });
    if (d.nick) push({ t:d.nick, size:26, font:SHARE.SANS, color:'rgba(245,241,232,.55)', gap:22 });
    var hz = d.line.p.hz || '';
    var fs = _fit(ctx, hz, maxW, (hz.length<=3?196:hz.length<=5?168:hz.length<=8?136:112), 68, SHARE.SERIF);
    ctx.font = fs + 'px ' + SHARE.SERIF;
    var lines = (ctx.measureText(hz).width > maxW) ? _cjkLines(ctx, hz, maxW, SHARE.SERIF) : [hz];
    push({ lines:lines, size:fs, font:SHARE.SERIF, color:S_.paper, gap:34 });
    if (d.line.p.py) push({ t:d.line.p.py, size:_fit(ctx, d.line.p.py, maxW, 46, 26, SHARE.SANS), font:SHARE.SANS, color:S_.gold, gap:22 });
    if (d.line.p.en) push({ t:d.line.p.en, size:_fit(ctx, d.line.p.en, maxW, 38, 24, SHARE.SANS), font:SHARE.SANS, color:'rgba(245,241,232,.62)', gap:30 });
    if (d.said > 0) push({ t:'Phrases said: ' + d.said, size:28, font:SHARE.SANS, color:'rgba(245,241,232,.46)', gap:0 });
    _stack(ctx, cx, items, 176, 806);

  } else if (SHARE.theme === 'streak'){
    var n = d.streak;
    push({ t:'DAY STREAK', size:26, font:SHARE.SANS, color:S_.goldDim, gap:30 });
    if (d.nick) push({ t:d.nick, size:26, font:SHARE.SANS, color:'rgba(245,241,232,.55)', gap:22 });
    push({ t:String(n), size:200, font:SHARE.SERIF, weight:'600', color:S_.gold, gap:34 });
    push({ t:'DAYS IN A ROW', size:34, font:SHARE.SANS, weight:'600', color:'rgba(245,241,232,.62)', gap:0 });
    /* 龙鳞进度紧跟在大数字下方 —— 用 _stack 返回的 y 定位，不再写死 */
    var yScales = _stack(ctx, cx, items, 176, 560);
    _scales(ctx, cx, yScales + 30, Math.max(1, Math.min(5, Math.round((n/7)*5) || 1)));
    var tail = [{ t:'Phrases said: ' + d.said + (d.badge ? ('   \u00b7   Badges: ' + d.badge.total) : ''),
                  size:28, font:SHARE.SANS, color:'rgba(245,241,232,.46)', gap:0 }];
    _stack(ctx, cx, tail, yScales + 92, Math.min(806, yScales + 200));

  } else if (SHARE.theme === 'city' && d.city){
    push({ t:'CITY UNLOCKED \u00b7 ' + String(d.city.en || '').toUpperCase(), size:26, font:SHARE.SANS, color:S_.goldDim, gap:28 });
    if (d.nick) push({ t:d.nick, size:26, font:SHARE.SANS, color:'rgba(245,241,232,.55)', gap:22 });
    var cn = d.city.cn || '';
    var cfs = _fit(ctx, cn, maxW, (cn.length<=2?186:cn.length<=3?156:126), 78, SHARE.SERIF);
    push({ t:cn, size:cfs, font:SHARE.SERIF, weight:'600', color:S_.teal, gap:44 });
    if (d.city.line && d.city.line.hz){
      var lh2 = _fit(ctx, d.city.line.hz, maxW, 52, 32, SHARE.SERIF);
      push({ t:d.city.line.hz, size:lh2, font:SHARE.SERIF, color:S_.paper, gap:22 });
      if (d.city.line.py) push({ t:d.city.line.py, size:_fit(ctx, d.city.line.py, maxW, 34, 22, SHARE.SANS), font:SHARE.SANS, color:S_.gold, gap:18 });
      if (d.city.line.en) push({ t:d.city.line.en, size:_fit(ctx, d.city.line.en, maxW, 32, 22, SHARE.SANS), font:SHARE.SANS, color:'rgba(245,241,232,.62)', gap:30 });
    }
    push({ t:'Landmarks lit: ' + (function(){ try{ return litCount(); }catch(e){ return 0; } })(),
           size:28, font:SHARE.SANS, color:'rgba(245,241,232,.46)', gap:0 });
    _stack(ctx, cx, items, 176, 806);

  } else if (SHARE.theme === 'badge' && d.badge){
    push({ t:'BADGE UNLOCKED', size:26, font:SHARE.SANS, color:S_.goldDim, gap:30 });
    if (d.nick) push({ t:d.nick, size:26, font:SHARE.SANS, color:'rgba(245,241,232,.55)', gap:20 });
    push({ t:' ', size:232, font:SHARE.SANS, color:'rgba(0,0,0,0)', gap:44 });   /* 圆环占位 */
    push({ t:d.badge.name, size:_fit(ctx, d.badge.name, maxW, 52, 30, SHARE.SERIF), font:SHARE.SERIF, weight:'600', color:S_.paper, gap:30 });
    push({ t:'Badges: ' + d.badge.total, size:28, font:SHARE.SANS, color:'rgba(245,241,232,.46)', gap:0 });
    var yb = _stack(ctx, cx, items, 176, 806);
    /* 圆环画在占位元素中心 */
    var ringCy = yb - (232 + 44 + Math.round(52*1.24) + 30 + Math.round(28*1.24))/2 + 232/2;
    ctx.save();
    ctx.strokeStyle = 'rgba(201,168,108,.34)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, ringCy, 112, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = S_.gold; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, ringCy, 88, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = S_.gold; ctx.font = '600 88px ' + SHARE.SERIF;
    ctx.fillText(d.badge.seal, cx, ringCy + 2);

  } else {
    push({ t:'JUST STARTED', size:26, font:SHARE.SANS, color:S_.goldDim, gap:28 });
    if (d.nick) push({ t:d.nick, size:26, font:SHARE.SANS, color:'rgba(245,241,232,.55)', gap:22 });
    push({ t:'\u4f60\u597d\uff01', size:196, font:SHARE.SERIF, color:S_.paper, gap:34 });
    push({ t:'N\u01d0 h\u01ceo!', size:46, font:SHARE.SANS, color:S_.gold, gap:22 });
    push({ t:'Hello \u2014 I\u2019m starting to learn Chinese.', size:36, font:SHARE.SANS, color:'rgba(245,241,232,.62)', gap:30 });
    push({ t:'Free during beta', size:28, font:SHARE.SANS, color:'rgba(245,241,232,.46)', gap:0 });
    _stack(ctx, cx, items, 176, 806);
  }

  /* ---- L1 品牌层：署名，不是主体（金线 852 / 字标 916 / URL 954 / 印 872，全在角花之上）---- */
  ctx.save(); ctx.strokeStyle = 'rgba(201,168,108,.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, 852); ctx.lineTo(W-PAD, 852); ctx.stroke(); ctx.restore();
  _brand(ctx, PAD, 916, 46);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(245,241,232,.42)'; ctx.font = '400 27px ' + SHARE.SANS;
  ctx.fillText('sinoky.pages.dev', PAD, 954);
  _seal(ctx, W - PAD - 92, 872, 92);
  return cv;
};

'''
H = H[:i] + NEW.replace("\n", "\r\n") + H[j:]
print("排版层已替换")

data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open(P, "wb").write(data)
H2 = data.decode("utf-8")
lone = data.count(b"\n") - data.count(b"\r\n")
print("裸 LF:", lone); assert lone == 0

# JS 语法（分块）
scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', H2, re.I)
f = "_internal/_s3.js"
open(f, "w", encoding="utf-8").write(scripts[-1])
r = subprocess.run([r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe", "--check", f],
                   capture_output=True, text=True)
print("模块语法 rc:", r.returncode, (r.stderr or "")[:300].strip())
os.remove(f)
assert r.returncode == 0

for k in ["_scales(ctx", "_stack(ctx", "function _cjkLines", "CITY UNLOCKED \u00b7 "]:
    print(f"  {k}: {H2.count(k)}")
    assert H2.count(k) >= 1
assert H2.count("_seal(ctx, W - PAD - 92, 872, 92)") == 1
assert H2.count("_corner(ctx, 34, 34, 0, .45)") == 1
print("完成")
