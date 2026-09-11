# -*- coding: utf-8 -*-
"""v0.16.0 分享卡片排版修正 2（第四补丁）
目视验收（第二张 streak 图）发现的剩余问题：
  P6 龙鳞改为「槽位」后仍压住 DAYS IN A ROW —— 根因是我用 _stack 的返回值当纹样下沿，
     纹样向上生长就必然侵入上方文字的领地。
修法：给 _stack 加「槽位钩子」hook —— 纹样像文字一样占一个真实的 h 位，由排版层分配空间。
     同时把勋章卡的「透明占位 + 反推圆心」也换成同一个钩子（那套反推是脆的）。
"""
import os, re, subprocess

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)
P = "index.html"
H = open(P, "rb").read().decode("utf-8")
assert H.count("\n") - H.count("\r\n") == 0, "文件不是完整 CRLF"

def crlf(s): return s.replace("\n", "\r\n")

def rep(old_lf, new_lf, n=1):
    global H
    o, w = crlf(old_lf), crlf(new_lf)
    c = H.count(o)
    assert c == n, f"命中 {c} 次（期望 {n}）：{old_lf[:70]!r}"
    H = H.replace(o, w)

# ---------- 1) _stack 支持槽位钩子 ----------
rep("""function _stack(ctx, cx, items, top, bot){
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
}""",
"""function _stack(ctx, cx, items, top, bot){
  var total = 0;
  items.forEach(function(it){
    if (it.hook){ it.h = it.h || 120; total += it.h; return; }   /* 槽位：纹样/图形也占真实的 h */
    var lines = it.lines || [it.t];
    it._lh = Math.round(it.size * 1.24);
    it._blk = it._lh * lines.length;
    it.h = it.h || (it._blk + (it.gap || 0));
    total += it.h;
  });
  var y = top + Math.max(0, (bot - top - total) / 2);
  items.forEach(function(it){
    if (it.hook){ it.hook(ctx, cx, y, it.h); y += it.h; return; }
    var lines = it.lines || [it.t];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = (it.weight || '400') + ' ' + it.size + 'px ' + it.font;
    ctx.fillStyle = it.color;
    var y0 = y + Math.max(0, (it.h - it._blk)/2) + it._lh/2;
    for (var k = 0; k < lines.length; k++) ctx.fillText(lines[k], cx, y0 + k*it._lh);
    y += it.h;
  });
  return y;
}""")

# ---------- 2) 连续卡：龙鳞占槽位，排在「大数字」与「DAYS IN A ROW」之间 ----------
rep("""    push({ t:String(n), size:200, font:SHARE.SERIF, weight:'600', color:S_.gold, gap:34 });
    push({ t:'DAYS IN A ROW', size:34, font:SHARE.SANS, weight:'600', color:'rgba(245,241,232,.62)', gap:0 });
    /* 龙鳞进度紧跟在大数字下方 —— 用 _stack 返回的 y 定位，不再写死 */
    var yScales = _stack(ctx, cx, items, 176, 560);
    _scales(ctx, cx, yScales + 30, Math.max(1, Math.min(5, Math.round((n/7)*5) || 1)));
    var tail = [{ t:'Phrases said: ' + d.said + (d.badge ? ('   \\u00b7   Badges: ' + d.badge.total) : ''),
                  size:28, font:SHARE.SANS, color:'rgba(245,241,232,.46)', gap:0 }];
    _stack(ctx, cx, tail, yScales + 92, Math.min(806, yScales + 200));""",
"""    push({ t:String(n), size:200, font:SHARE.SERIF, weight:'600', color:S_.gold, gap:34 });
    var on = Math.max(1, Math.min(5, Math.round((n/7)*5) || 1));
    push({ h:126, hook:function(c, cc, y, hh){ _scales(c, cc, y + hh - 8, on); } });
    push({ t:'DAYS IN A ROW', size:34, font:SHARE.SANS, weight:'600', color:'rgba(245,241,232,.62)', gap:0 });
    var yEnd = _stack(ctx, cx, items, 176, 620);
    _stack(ctx, cx, [{ t:'Phrases said: ' + d.said + (d.badge ? ('   \\u00b7   Badges: ' + d.badge.total) : ''),
                       size:28, font:SHARE.SANS, color:'rgba(245,241,232,.46)', gap:0 }], yEnd + 52, yEnd + 160);""")

# ---------- 3) 勋章卡：圆环也改成槽位钩子（替换脆弱的「透明占位 + 反推圆心」）----------
rep("""    push({ t:' ', size:232, font:SHARE.SANS, color:'rgba(0,0,0,0)', gap:44 });   /* 圆环占位 */
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
    ctx.fillText(d.badge.seal, cx, ringCy + 2);""",
"""    push({ h:244, hook:function(c, cc, y, hh){
      var cy = y + hh/2;
      c.save();
      c.strokeStyle = 'rgba(201,168,108,.34)'; c.lineWidth = 2;
      c.beginPath(); c.arc(cc, cy, 112, 0, Math.PI*2); c.stroke();
      c.strokeStyle = SHARE.C.gold; c.lineWidth = 5;
      c.beginPath(); c.arc(cc, cy, 88, 0, Math.PI*2); c.stroke();
      c.restore();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = SHARE.C.gold; c.font = '600 88px ' + SHARE.SERIF;
      c.fillText(d.badge.seal, cc, cy + 2);
    } });
    push({ t:d.badge.name, size:_fit(ctx, d.badge.name, maxW, 52, 30, SHARE.SERIF), font:SHARE.SERIF, weight:'600', color:S_.paper, gap:36 });
    push({ t:'Badges: ' + d.badge.total, size:28, font:SHARE.SANS, color:'rgba(245,241,232,.46)', gap:0 });
    _stack(ctx, cx, items, 176, 806);""")

# ---------- 4) 句子卡：英文与统计行之间补足呼吸（原来只有 30，明显比其他间距紧）----------
rep("""    if (d.line.p.en) push({ t:d.line.p.en, size:_fit(ctx, d.line.p.en, maxW, 38, 24, SHARE.SANS), font:SHARE.SANS, color:'rgba(245,241,232,.62)', gap:30 });""",
"""    if (d.line.p.en) push({ t:d.line.p.en, size:_fit(ctx, d.line.p.en, maxW, 38, 24, SHARE.SANS), font:SHARE.SANS, color:'rgba(245,241,232,.62)', gap:56 });""")

# ---------- 写盘 ----------
data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open(P, "wb").write(data)
H2 = data.decode("utf-8")
lone = data.count(b"\n") - data.count(b"\r\n")
print("裸 LF:", lone); assert lone == 0

scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', H2, re.I)
open("_internal/_s3.js", "w", encoding="utf-8").write(scripts[-1])
r = subprocess.run([r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe", "--check", "_internal/_s3.js"],
                   capture_output=True, text=True)
print("模块语法 rc:", r.returncode, (r.stderr or "")[:300].strip())
os.remove("_internal/_s3.js")
assert r.returncode == 0

assert H2.count("if (it.hook){ it.hook(ctx, cx, y, it.h); y += it.h; return; }") == 1
assert H2.count("push({ h:126, hook:") == 1
assert H2.count("push({ h:244, hook:") == 1
assert "var yScales" not in H2 and "ringCy" not in H2, "旧的写死定位还在"
print("完成")
