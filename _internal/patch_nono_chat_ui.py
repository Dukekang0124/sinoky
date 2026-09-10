#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v0.14.8 诺诺聊天框 UI/UX 升级补丁（二进制安全，保留 CRLF）。
- 解决 #nono-chat 无限撑高导致面板铺满屏幕的问题。
- 新视觉：竹影窗棂主题（黛青/朱砂/金色/水墨渐变）。
- 新增按住说话、独立滚动消息区、现代气泡与模式切换。
"""
import os, sys

p = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app\index.html"
b = open(p, "rb").read()

def B(s):
    return s.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')

# 1. 升级 #nono-panel 基础样式（更宽、圆角更大、带金色边+窗格纹伪元素）
old1 = B("#nono-panel{width:min(78vw,300px);background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.45);overflow:hidden}")
new1 = B("""#nono-panel{width:min(86vw,340px);background:linear-gradient(180deg,#18202b 0%,#141a24 100%);border:1px solid rgba(201,168,108,.22);border-radius:20px;box-shadow:0 12px 34px rgba(0,0,0,.55),0 0 0 1px rgba(201,168,108,.05);overflow:hidden;position:relative}
      #nono-panel::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(201,168,108,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(201,168,108,.03) 1px,transparent 1px);background-size:22px 22px;pointer-events:none}""")
if old1 not in b:
    print("FAIL: old #nono-panel css not found"); sys.exit(1)
b = b.replace(old1, new1)

# 2. 在 .np-state 后插入聊天区新 CSS
old2 = B(".np-state{font-size:11.5px;color:var(--sub);margin-top:2px}\r\n      /* ---- 跟读练习区 ---- */")
new2 = B(""".np-state{font-size:11.5px;color:var(--sub);margin-top:2px}
      /* ---- 诺诺自由聊天：竹影窗棂 ---- */
      #nono-panel.npanel-flex{display:flex;flex-direction:column;max-height:calc(100dvh - 170px);overflow:hidden}
      #nono-panel.npanel-flex .np-body{flex:0 0 auto}
      #nono-panel.npanel-flex #nono-chat{flex:1 1 auto;display:flex;flex-direction:column;min-height:120px;overflow:hidden;padding:0}
      #nono-msg{display:block}
      .nc-scroll{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin}
      .nc-scroll::-webkit-scrollbar{width:4px}
      .nc-scroll::-webkit-scrollbar-thumb{background:rgba(201,168,108,.35);border-radius:4px}
      .nm-wrap{display:flex;justify-content:center;gap:6px;padding:8px 12px;border-bottom:1px solid rgba(201,168,108,.12)}
      .nm-chip{background:rgba(24,32,43,.7);border:1px solid rgba(201,168,108,.35);color:#e8dcc8;border-radius:99px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:.18s;font-family:inherit}
      .nm-chip.on{background:linear-gradient(180deg,rgba(201,168,108,.22),rgba(201,168,108,.08));border-color:#c9a86c;color:#f9f4ee;box-shadow:0 2px 8px rgba(201,168,108,.12)}
      .nm-chip:active{transform:scale(.96)}
      .nc-row{display:flex;align-items:flex-end;gap:8px;max-width:92%}
      .nc-row.you{margin-left:auto;flex-direction:row-reverse}
      .nc-row.nono{margin-right:auto}
      .nc-av{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;background:var(--card);border:1px solid rgba(201,168,108,.25)}
      .nc-bub{position:relative;padding:10px 13px;font-size:13.5px;line-height:1.55;border-radius:18px;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.12)}
      .nc-bub.nc-nono{background:linear-gradient(180deg,#e8f4f2,#d4e8e4);color:#1b2a2d;border-bottom-left-radius:5px}
      .nc-bub.nc-you{background:linear-gradient(180deg,#e85a5a,#c2362b);color:#fff;border-bottom-right-radius:5px}
      .nc-bub.nc-sys{align-self:center;background:rgba(201,168,108,.12);border:1px solid rgba(201,168,108,.22);color:#c9a86c;font-size:12px;padding:6px 12px;border-radius:99px;margin:4px 0}
      .nc-hint{text-align:center;color:#9aa7b8;font-size:12px;padding:8px 18px;line-height:1.5}
      .nc-hint b{color:#c9a86c;font-weight:600}
      .nctrl{display:flex;flex-direction:column;gap:8px;padding:10px 12px 14px;border-top:1px solid rgba(201,168,108,.10);background:rgba(20,26,36,.45)}
      .nctrl-main{display:flex;align-items:center;gap:10px}
      .nctrl-mic{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;height:46px;border-radius:99px;border:none;background:linear-gradient(180deg,#c2362b,#a12a21);color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(194,54,43,.28);transition:.18s;font-family:inherit;-webkit-user-select:none;user-select:none;touch-action:manipulation}
      .nctrl-mic:active{transform:scale(.97)}
      .nctrl-mic.rec{animation:nctrlPulse 1.2s infinite;box-shadow:0 0 0 0 rgba(194,54,43,.45)}
      @keyframes nctrlPulse{0%{box-shadow:0 0 0 0 rgba(194,54,43,.45)}70%{box-shadow:0 0 0 10px rgba(194,54,43,0)}100%{box-shadow:0 0 0 0 rgba(194,54,43,0)}}
      .nctrl-ico{width:40px;height:40px;border-radius:50%;border:1px solid rgba(201,168,108,.35);background:rgba(24,32,43,.7);color:#e8dcc8;font-size:17px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:.18s}
      .nctrl-ico:active{transform:scale(.92)}
      .nctrl-txt{display:none;gap:8px;align-items:center;padding-top:2px}
      .nctrl-txt.on{display:flex}
      .nctrl-txt input{flex:1;height:40px;border-radius:99px;border:1px solid rgba(201,168,108,.35);background:rgba(24,32,43,.7);color:var(--txt);padding:0 14px;font-size:14px;font-family:inherit}
      .nctrl-txt button{width:72px;height:40px;border-radius:99px;border:none;background:#c9a86c;color:#141a24;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}
      /* ---- 跟读练习区 ---- */""")
if old2 not in b:
    print("FAIL: insert point after .np-state not found"); sys.exit(1)
b = b.replace(old2, new2)

# 3. 修改 #nono-chat HTML 结构，内置 nc-scroll 容器
old3 = B('<div class="np-body nono-chat" id="nono-chat" style="display:none"></div>')
new3 = B('<div class="np-body nono-chat" id="nono-chat" style="display:none"><div class="nc-scroll" id="nc-list"></div></div>')
if old3 not in b:
    print("FAIL: nono-chat html not found"); sys.exit(1)
b = b.replace(old3, new3)

# 4. 修改 nonoShow 以恢复 #nono-msg display（聊天模式会隐藏它）
old4 = B("  document.getElementById('nono-msg').innerHTML = msg;")
new4 = B("  var _nmsg = document.getElementById('nono-msg'); if(_nmsg){ _nmsg.style.display='block'; _nmsg.innerHTML = msg; }")
if old4 not in b:
    print("FAIL: nonoShow msg line not found"); sys.exit(1)
b = b.replace(old4, new4)

# 5. 修改 nonoRecord：聊天模式允许录音、不覆盖控制区
old5 = B("async function nonoRecord(){\r\n  var p = document.getElementById('nono-practice');\r\n  if(!NONO_LINE) return;")
new5 = B("async function nonoRecord(){\r\n  var p = document.getElementById('nono-practice');\r\n  if(NONO.mode !== 'chat' && !NONO_LINE) return;")
if old5 not in b:
    print("FAIL: nonoRecord start not found"); sys.exit(1)
b = b.replace(old5, new5)

# 6. 修改 nonoRecord 的 listening UI（聊天模式不替换控制区）
old6 = B("    nonoState('listening');\r\n    if(p) p.innerHTML = '<div class=\"np-rec\">\u25cf Recording\u2026 tap stop when you finish</div>' +\r\n      '<button class=\"btn ghost\" style=\"margin-top:8px;width:100%\" onclick=\"nonoStop()\">\u23f9 Stop</button>';")
new6 = B("""    nonoState('listening');
    if(NONO.mode === 'chat'){
      if(NONO_WANT_STOP) try{ rec.stop(); }catch(e){}
    }else if(p){
      p.innerHTML = '<div class="np-rec">\u25cf Recording\u2026 tap stop when you finish</div>' +
        '<button class="btn ghost" style="margin-top:8px;width:100%" onclick="nonoStop()">\u23f9 Stop</button>';
    }""")
if old6 not in b:
    print("FAIL: nonoRecord listening UI not found"); sys.exit(1)
b = b.replace(old6, new6)

# 7. 修改 nonoRecord 的错误/不支持提示（聊天模式用 bubble）
old7a = B("    if(p) p.innerHTML = '<div class=\"np-fix\">Recording is not supported in this browser. Use Chrome or Edge.</div>';")
new7a = B("    if(NONO.mode === 'chat') nonoChatBubble('', 'Recording is not supported in this browser.');\r\n    else if(p) p.innerHTML = '<div class=\"np-fix\">Recording is not supported in this browser. Use Chrome or Edge.</div>';")
if old7a not in b:
    print("FAIL: nonoRecord unsupported line not found"); sys.exit(1)
b = b.replace(old7a, new7a)

old7b = B("        nonoState('sorry');\r\n        if(p) p.innerHTML = '<div class=\"np-fix\">That did not work \u2014 ' + (e && e.message ? e.message : 'unknown error') + '. Try once more?</div>';")
new7b = B("""        nonoState('sorry');
        if(NONO.mode === 'chat') nonoChatBubble('', 'That did not work. Try once more?');
        else if(p) p.innerHTML = '<div class="np-fix">That did not work \u2014 ' + (e && e.message ? e.message : 'unknown error') + '. Try once more?</div>';""")
if old7b not in b:
    print("FAIL: nonoRecord stop error line not found"); sys.exit(1)
b = b.replace(old7b, new7b)

old7c = B("    nonoState('sorry');\r\n    if(p) p.innerHTML = '<div class=\"np-fix\">Microphone blocked. Allow it in your browser, then try again.</div>';")
new7c = B("""    nonoState('sorry');
    if(NONO.mode === 'chat') nonoChatBubble('', 'Microphone blocked. Allow it in your browser.');
    else if(p) p.innerHTML = '<div class="np-fix">Microphone blocked. Allow it in your browser, then try again.</div>';""")
if old7c not in b:
    print("FAIL: nonoRecord mic error line not found"); sys.exit(1)
b = b.replace(old7c, new7c)

# 8. 替换整个 v0.14.7 聊天函数块为新的 v0.14.8 版本
old8_start = B("/* ===== v0.14.7 诺诺自由聊天（GLM-4-Flash 主用 + Workers AI 兜底，状态在端上）===== */")
old8_end = B("  nonoChatControls();\r\n}\r\n\r\n/* 评分：asrText \u2192 api/score \u2192 三维反馈 + 鼓励点评 */")
if old8_start not in b or old8_end not in b:
    print("FAIL: chat block markers not found"); sys.exit(1)
start = b.find(old8_start)
end = b.find(old8_end) + len(old8_end)
new8 = B("""/* ===== 诺诺自由聊天（GLM-4-Flash 主用 + Workers AI 兜底，状态在端上）===== */
var NONO_MIC_DOWN = false, NONO_WANT_STOP = false;
function nonoModeChips(){
  var el = document.getElementById('nono-modes'); if(!el) return;
  el.innerHTML = '<div class="nm-wrap"><button class="nm-chip'+(NONO.mode==='practice'?' on':'')+'" onclick="nonoStartPractice()">🎙️ '+T('Practise')+'</button>'+
    '<button class="nm-chip'+(NONO.mode==='chat'?' on':'')+'" onclick="nonoStartChat()">💬 '+T('Chat')+'</button></div>';
}
function nonoModeMenu(){
  nonoState('idle');
  var pm = document.getElementById('nono-practice'); if(pm) pm.style.display='none';
  var pc = document.getElementById('nono-chat'); if(pc){ pc.style.display='none'; pc.innerHTML='<div class="nc-scroll" id="nc-list"></div>'; }
  var st = document.getElementById('nono-state'); if(st) st.style.display='none';
  var msg = document.getElementById('nono-msg');
  if(msg){ msg.style.display='block'; msg.innerHTML = "Hi, I'm Nono 🐼 "+T('Want to practise a line or just chat in Chinese?'); }
  var acts = document.getElementById('nono-acts');
  if(acts) acts.innerHTML = '<button class="ghost" onclick="nonoStartPractice()">🎙️ '+T('Practise')+'</button><button class="ghost" onclick="nonoStartChat()">💬 '+T('Chat')+'</button>';
  nonoModeChips();
  nonoPanelFlex(false);
  var panel = document.getElementById('nono-panel'); if(panel) panel.style.display='block';
}
function nonoStartChat(){ NONO.mode = 'chat'; nonoChatOpen(); }
function nonoChatOpen(){
  nonoModeChips();
  var pm = document.getElementById('nono-practice'); if(pm) pm.style.display='none';
  var pc = document.getElementById('nono-chat'); if(pc){ pc.style.display='flex'; pc.innerHTML='<div class="nc-scroll" id="nc-list"></div>'; }
  var msg = document.getElementById('nono-msg');
  if(msg) msg.style.display='none';
  var st = document.getElementById('nono-state'); if(st) st.style.display='none';
  (S.nonoChat||[]).forEach(function(h){ nonoChatBubble(h.r==='user'?'you':'nono', h.t); });
  nonoChatControls();
  nonoChatScrollToBottom();
  nonoState('idle');
  var panel = document.getElementById('nono-panel'); if(panel) panel.style.display='block';
  nonoPanelFlex(true);
  if(!S.nonoChat || !S.nonoChat.length){
    var opening = '嗨，我是诺诺！我们随便聊点中文吧？你想聊什么？';
    nonoChatBubble('nono', opening);
    S.nonoChat = S.nonoChat || [];
    S.nonoChat.push({ r:'assistant', t: opening });
    if(typeof saveState==='function') saveState();
    nonoState('speaking');
    if(typeof speak==='function') speak(opening);
    setTimeout(function(){ if(NONO.mode==='chat') nonoState('idle'); }, 2600);
  }
}
function nonoChatControls(){
  var pm = document.getElementById('nono-practice'); if(!pm) return;
  pm.innerHTML = '<div class="nctrl">'+
    '<div class="nctrl-main">'+
      '<button class="nctrl-mic" id="nctrl-mic" ontouchstart="nonoRecordStart(event)" ontouchend="nonoRecordEnd(event)" onmousedown="nonoRecordStart(event)" onmouseup="nonoRecordEnd(event)" onmouseleave="nonoRecordEnd(event)">🎙️ '+T('Hold to speak')+'</button>'+
      '<button class="nctrl-ico" onclick="nonoChatTextToggle()" title="'+T('Type')+'">✏️</button>'+
    '</div>'+
    '<div class="nctrl-txt" id="nono-txt">'+
      '<input id="nono-input" placeholder="'+T('Type in Chinese…')+'" />'+
      '<button onclick="nonoChatSendText()">'+T('Send')+'</button>'+
    '</div>'+
  '</div>';
}
function nonoRecordStart(e){
  if(e && e.preventDefault) e.preventDefault();
  if(NONO_MIC_DOWN) return;
  NONO_MIC_DOWN = true; NONO_WANT_STOP = false;
  var b = document.getElementById('nctrl-mic');
  if(b){ b.classList.add('rec'); b.textContent = '🎙️ '+T('Listening…'); }
  nonoRecord();
}
function nonoRecordEnd(e){
  if(e && e.preventDefault) e.preventDefault();
  if(!NONO_MIC_DOWN) return;
  NONO_MIC_DOWN = false; NONO_WANT_STOP = true;
  var b = document.getElementById('nctrl-mic');
  if(b){ b.classList.remove('rec'); b.textContent = '🎙️ '+T('Hold to speak'); }
  nonoStop();
}
function nonoChatTextToggle(){
  var t = document.getElementById('nono-txt'); if(!t) return;
  t.classList.toggle('on');
  if(t.classList.contains('on')){ var i = document.getElementById('nono-input'); if(i){ i.focus(); nonoChatScrollToBottom(); } }
}
async function nonoChatSendText(){
  var i = document.getElementById('nono-input'); if(!i) return;
  var txt = (i.value||'').trim(); if(!txt) return;
  i.value = '';
  await nonoChatReply(txt);
}
function nonoChatBubble(who, text){
  var list = document.getElementById('nc-list');
  if(!list){
    var pc = document.getElementById('nono-chat');
    if(!pc) return;
    list = document.createElement('div'); list.className = 'nc-scroll'; list.id = 'nc-list';
    pc.innerHTML = ''; pc.appendChild(list);
  }
  var row = document.createElement('div');
  row.className = 'nc-row ' + (who==='you' ? 'you' : who==='nono' ? 'nono' : 'sys');
  var d = document.createElement('div');
  d.className = 'nc-bub ' + (who==='you' ? 'nc-you' : who==='nono' ? 'nc-nono' : 'nc-sys');
  d.textContent = text;
  if(who === 'nono'){
    row.innerHTML = '<div class="nc-av">🐼</div>';
    row.appendChild(d);
  }else if(who === 'you'){
    row.innerHTML = '<div class="nc-av">👤</div>';
    row.appendChild(d);
  }else{
    row.appendChild(d);
  }
  list.appendChild(row);
  nonoChatScrollToBottom();
}
function nonoChatScrollToBottom(){
  var list = document.getElementById('nc-list');
  if(list) list.scrollTop = list.scrollHeight;
}
async function nonoChatSend(wav){
  nonoState('thinking');
  var a = await asrText(wav, '');
  if(!a.ok){
    nonoState('sorry');
    nonoChatBubble('', (a.err || T('Did not catch that, try again?')));
    nonoChatControls();
    return;
  }
  var userText = (a.text||'').trim();
  if(!userText){ nonoState('sorry'); nonoChatControls(); return; }
  await nonoChatReply(userText);
}
async function nonoChatReply(userText){
  nonoChatBubble('you', userText);
  nonoState('thinking');
  try{
    var hist = (S.nonoChat||[]).slice(-12);
    var resp = await fetch(API_BASE+'api/chat', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ uid: UID, hist: hist, text: userText })
    });
    var d = await resp.json().catch(function(){ return {}; });
    var reply = (resp.ok && d.reply) ? d.reply : '诺诺有点累了，待会再聊 😴';
    S.nonoChat = S.nonoChat || [];
    S.nonoChat.push({ r:'user', t: userText });
    S.nonoChat.push({ r:'assistant', t: reply });
    if(S.nonoChat.length > 40) S.nonoChat = S.nonoChat.slice(-40);
    if(typeof saveState==='function') saveState();
    nonoChatBubble('nono', reply);
    nonoState('speaking');
    if(typeof speak==='function') speak(reply);
    setTimeout(function(){ if(NONO.mode==='chat') nonoState('idle'); }, 2600);
  }catch(e){
    nonoState('sorry');
    nonoChatBubble('nono', '诺诺有点累了，待会再聊 😴');
  }
  nonoChatControls();
}
function nonoPanelFlex(on){
  var p = document.getElementById('nono-panel');
  if(!p) return;
  if(on) p.classList.add('npanel-flex'); else p.classList.remove('npanel-flex');
}

/* 评分：asrText → api/score → 三维反馈 + 鼓励点评 */""")
b = b[:start] + new8 + b[end:]

# 9. 修改 nonoStartPractice，切换为非 chat 布局并显示 #nono-msg
old9 = B("function nonoStartPractice(){\r\n  NONO.mode = 'practice';\r\n  nonoModeChips();\r\n  var pc = document.getElementById('nono-chat'); if(pc) pc.style.display = 'none';")
new9 = B("""function nonoStartPractice(){
  NONO.mode = 'practice';
  nonoModeChips();
  nonoPanelFlex(false);
  var _msg = document.getElementById('nono-msg'); if(_msg) _msg.style.display='block';
  var pc = document.getElementById('nono-chat'); if(pc) pc.style.display = 'none';""")
if old9 not in b:
    print("FAIL: nonoStartPractice start not found"); sys.exit(1)
b = b.replace(old9, new9)

# 验证 CRLF 保持完整
bare_lf = b.count(b"\n") - b.count(b"\r\n")
print("new len", len(b), "CRLF", b.count(b"\r\n"), "bare LF", bare_lf)
if bare_lf != 0:
    print("FAIL: bare LF introduced"); sys.exit(1)

# 回写
open(p, "wb").write(b)
print("PATCH OK")
