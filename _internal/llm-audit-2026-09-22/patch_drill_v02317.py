# -*- coding: utf-8 -*-
"""v0.23.17 前端：复习 AI 弱点出题（P1-A 场景2落地）。幂等（哨兵先删后插 + count 断言）。"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IH = os.path.join(ROOT, 'index.html')

SENT = '/* ===== v0.23.17 复习 AI 弱点出题（P1-A 场景2落地） ===== */'
ANCHOR_AFTER = '/* ===== /v0.23.16 L3 ===== */'

BLOCK = SENT + '''
/* 设计：S.aiWeak 某维度弱点>=2 次 → 诺诺用免费大模型（/api/chat drill 模式）造针对该弱点的
   简短中文练习句，显示在首页复习卡；点"跟我读"→ nonoStartPracticeWith 复用诺诺练习闭环
   （coach 点评 + aiWeak + checkAiLoop 自动触发）。当天最多 1 次 AI 调用（S.revDrill 缓存），
   尊重 API 红线。全部追加/包装，不改旧函数体。 */
function ensureRevDrill(){ S.revDrill = S.revDrill || { date:null, hz:'', en:'', dim:'' }; return S.revDrill; }
function topWeakDim(){
  try{ var ai=(S.aiWeak&&S.aiWeak.dims)||{}; var ks=Object.keys(ai).filter(function(k){return (ai[k]||0)>=2;}).sort(function(a,b){return (ai[b]||0)-(ai[a]||0);}); return ks[0]||null; }catch(e){ return null; }
}
function buildDrillPrompt(dim){
  var m={tone2:'第三声（先降后升）',tone3:'第三声',tone4:'第四声（短促下降）',initial:'声母（辅音开头）',final:'韵母',fluency:'流利度/节奏'};
  var w=m[dim]||'发音';
  return '用户常在'+w+'上出错。请造一句超简单日常中文（不超过 8 字）让 ta 开口练这个弱点，'
    +'格式严格：中文句子 | English translation。例：你好吗 | How are you。只输出这一行。';
}
function revDrillCard(hz, en, dim){
  return '<div class="rd-line"><span class="rd-hz">'+escHtml(hz)+'</span>'
    + '<span class="rd-en">'+escHtml(en||'')+'</span></div>'
    + '<button class="btn primary" onclick="revDrillSpeak()">'+T('Read after me')+' 🐼</button>';
}
function revDrillOffline(){
  return '<div class="rd-offline">'+T('Coach offline — tap any line above to practise')+'</div>';
}
async function coachDrill(box, dim){
  try{
    if(!box) return;
    var prompt=buildDrillPrompt(dim);
    var resp=await fetch(API_BASE+'api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:UID,hist:[],text:prompt,mode:'drill'})});
    var d=await resp.json().catch(function(){return {};});
    if(resp.ok && d.reply){
      var parts=String(d.reply).split('|');
      var hz=(parts[0]||'').trim(), en=(parts[1]||'').trim();
      if(hz && en){
        var rd=ensureRevDrill(); rd.date=today(); rd.hz=hz; rd.en=en; rd.dim=dim; if(typeof saveState==='function') saveState();
        box.innerHTML=revDrillCard(hz,en,dim); return;
      }
    }
    box.innerHTML=revDrillOffline();
  }catch(e){ try{ if(box) box.innerHTML=revDrillOffline(); }catch(e2){} }
}
function reviewAiDrillHtml(){
  var dim=topWeakDim();
  if(!dim) return '';
  var rd=(S.revDrill)||{};
  var inner=(rd.date===today() && rd.hz) ? revDrillCard(rd.hz, rd.en, rd.dim) : '<div class="rd-skel">'+T('Nono is preparing a drill for you…')+'</div>';
  return '<div class="card review-drill"><div class="top"><h2>🤖 '+T('Nono made you a drill')+'</h2><span class="badge">AI</span></div>'
    + '<p class="desc">'+T('Based on your weak spots, try saying this:')+' <b>'+aiWeakLabel(dim)+'</b></p>'
    + '<div id="rev-ai-drill">'+inner+'</div></div>';
}
function revDrillSpeak(){
  try{
    var rd=(S.revDrill)||{}; if(!rd.hz) return;
    NONO.closed=false;
    var panel=document.getElementById('nono-panel'); if(panel) panel.style.display='block';
    var msg=document.getElementById('nono-msg'); if(msg) msg.innerHTML=T('Let us say this one together.')+' <b>'+T('Read after me')+'</b>';
    nonoStartPracticeWith({ hz:rd.hz, py:'', en:rd.en||'', key:'revdrill', scene:'revdrill' });
    if(typeof nonoState==='function') nonoState('idle');
  }catch(e){}
}
/* 包装 reviewCardHtml：追加 AI 出题区块，不改旧体 */
(function(){ if(typeof reviewCardHtml!=='function') return; var _rc=reviewCardHtml; reviewCardHtml=function(){ var h=''; try{ h=_rc.apply(null,arguments)||''; }catch(e){} try{ h=h+reviewAiDrillHtml(); }catch(e){} return h; }; })();
/* 包装 renderHome：渲染后异步拉取出题（当天缓存≤1次调用），不改旧体 */
(function(){ if(typeof renderHome!=='function') return; var _rh=renderHome; renderHome=function(){ var r=_rh.apply(null,arguments); try{ var dim=topWeakDim(); if(dim){ var rd=(S.revDrill)||{}; if(rd.date!==today()||!rd.hz){ setTimeout(function(){ var box=document.getElementById('rev-ai-drill'); if(box) coachDrill(box, dim); }, 80); } } }catch(e){} return r; }; })();
/* 首屏补正：L6339 启动 renderHome 早于本块（包装器尚未生效），此处用包装版补渲染一次，
   保证无论语言与首次加载路径，首页复习卡都含 AI 出题区块。 */
(function(){ try{ if(typeof renderHome==='function' && document.getElementById('home-scenes')) renderHome(); }catch(e){} })();
/* ===== /v0.23.17 复习 AI 弱点出题 ===== */'''

def rep(tag, old, new, expect=1):
    global src
    n_old = src.count(old); n_new = src.count(new)
    if n_old == 0 and n_new >= expect:
        skipped.append(tag); return
    if n_old != expect:
        sys.exit('ABORT [%s] old count=%d expect=%d' % (tag, n_old, expect))
    src = src.replace(old, new, expect); applied.append(tag)

applied=[]; skipped=[]
src = open(IH, encoding='utf-8').read()

# 幂等：若哨兵在，先整块删除（含前后多余空行吃净）
if SENT in src:
    import re
    src = re.sub(r'\n?' + re.escape(SENT) + r'.*?/\* ===== /v0.23.17 复习 AI 弱点出题 ===== \*/', '', src, flags=re.S)
    # 上一步可能留空行，归一
    src = src.replace(ANCHOR_AFTER + '\n\n', ANCHOR_AFTER + '\n')

# APP_VERSION 0.23.16 → 0.23.17
rep('APP_VERSION', "var APP_VERSION = '0.23.16'", "var APP_VERSION = '0.23.17'", 1)

# 插入 v0.23.17 块（script 内，L11245 之后）
if ANCHOR_AFTER not in src:
    sys.exit('ABORT anchor /v0.23.16 L3 not found')
ins_at = src.find(ANCHOR_AFTER) + len(ANCHOR_AFTER)
src = src[:ins_at] + '\n' + BLOCK + src[ins_at:]

open(IH, 'w', encoding='utf-8').write(src)
print('APPLIED' if not skipped else 'APPLIED(skipped=%s)' % skipped)
print('checks: APP_VERSION count=%d, SENT=%s' % (src.count("var APP_VERSION = '0.23.17'"), SENT in src))
