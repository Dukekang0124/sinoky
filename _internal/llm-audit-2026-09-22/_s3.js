
/* v0.23.15 AI 点评增强（P0-A）+ aiWeak 闭环（P0-B）
   设计：跟读评分后由诺诺用免费大模型（/api/chat coach 模式）生成个性化点评；
   离线/超时回落 nonoGrade 内硬编码 comment。AI 发现的维度弱点写入 S.aiWeak，
   驱动复习挑句更积极，并在 Progress 页展示。所有新函数挂全局，纯追加不改写旧码。 */
function escHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function ensureAiWeak(){ S.aiWeak = S.aiWeak || { dims:{}, updated:null }; return S.aiWeak; }
function buildCoachPrompt(line, acc, comp, flu, fixes){
  var errs = (fixes||[]).map(function(f){
    var p = [(f.target||'?'), '→', (f.user||'?')];
    if(f.toneOk===false) p.push('tone'+(f.tExp||''));
    return p.join(' ');
  }).slice(0,4).join(' | ');
  return '用户刚跟读中文：「'+(line.hz||'')+'」（英文：'+(line.en||'')+'）。\n'
    + '评分：准确度 '+acc+'，完整度 '+comp+'，流利度 '+flu+'。\n'
    + '错误点：'+(errs||'无明显错误')+'\n'
    + '请作为口语教练诺诺，给一句不超过 30 字的中文为主简短点评，指出最该改进的一个点并给具体小建议。';
}
async function coachGradeComment(line, acc, comp, flu, fixes, p){
  try{
    if(!p || !line) return;
    var prompt = buildCoachPrompt(line, acc, comp, flu, fixes);
    var resp = await fetch(API_BASE+'api/chat', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ uid: UID, hist:[], text: prompt, mode:'coach' })
    });
    var d = await resp.json().catch(function(){ return {}; });
    if(resp.ok && d.reply){
      var txt = String(d.reply).replace(/<[^>]+>/g,'').slice(0,80);
      var box = p.querySelector('#np-comment');
      if(box) box.innerHTML = escHtml(txt);
      recordAiWeak(fixes, flu);
      recordAiFunnel('hit'); seedAiLoop(line, fixes, flu);
    } else {
      recordAiFunnel('miss');   /* HTTP 错误/空回复：点评未命中，回落模板 */
    }
  }catch(e){ recordAiFunnel('miss'); /* 网络异常/超时 → 保留 nonoGrade 内硬编码兜底 comment，不报错 */ }
}
function recordAiWeak(fixes, flu){
  try{
    var ai = ensureAiWeak();
    (fixes||[]).forEach(function(f){
      if(f.toneOk===false && f.tExp){ var k='tone'+(f.tExp||''); ai.dims[k]=(ai.dims[k]||0)+1; }
      var e = (f.errs||[]).join('');
      if(e.indexOf('声母')>=0) ai.dims.initial=(ai.dims.initial||0)+1;
      if(e.indexOf('韵母')>=0) ai.dims.final=(ai.dims.final||0)+1;
    });
    if(flu < 60) ai.dims.fluency = (ai.dims.fluency||0)+1;
    ai.updated = new Date().toISOString().slice(0,10);
    if(typeof saveState==='function') saveState();
  }catch(e){}
}
function aiWeakLabel(k){
  var m = { tone2:'Tone 2 · 二声', tone3:'Tone 3 · 三声', tone4:'Tone 4 · 四声',
            initial:'Initials · 声母', final:'Finals · 韵母', fluency:'Fluency · 流利度' };
  return m[k] || k;
}
function aiWeakHtml(){
  var ai = (S.aiWeak && S.aiWeak.dims) || {};
  var ks = Object.keys(ai).filter(function(k){ return (ai[k]||0) >= 1; })
            .sort(function(a,b){ return (ai[b]||0)-(ai[a]||0); });
  if(!ks.length) return '';
  var items = ks.slice(0, 6).map(function(k){
    return '<div class="weak-row"><div class="wr-txt"><b>'+aiWeakLabel(k)+'</b>'
      + '<span>'+T('AI spotted this needs more drills')+'</span></div>'
      + '<span class="wr-n">'+ai[k]+'×</span></div>';
  }).join('');
  return '<div class="card"><div class="top"><h2>🤖 '+T('AI coach insights')
    + '</h2><span class="badge">from Nono</span></div><p class="desc">'
    + T('AI spotted your weak dimensions — drill them more.')+'</p>'+items+'</div>';
}

/* ===== v0.23.16 L3 闭环度量（可被验证） =====
   把"AI 触达 → 闭环"漏斗塞进 S.aiFunnel，随 buildStat 经 pushProfile（8s 防抖+脏检查）
   零新增写地上云；Progress 页读时聚合展示。全部追加/包装，不改旧函数体。 */
function ensureAiFunnel(){ S.aiFunnel = S.aiFunnel || { hit:0, miss:0, loop:0, pending:[], updated:null }; return S.aiFunnel; }
function recordAiFunnel(act){ try{ var f=ensureAiFunnel(); if(act==='hit') f.hit=(f.hit||0)+1; else if(act==='miss') f.miss=(f.miss||0)+1; f.updated=new Date().toISOString().slice(0,10); saveState(); }catch(e){} }
function seedAiLoop(line, fixes, flu){ try{ var f=ensureAiFunnel(); var dims=[]; (fixes||[]).forEach(function(x){ if(x.toneOk===false&&x.tExp) dims.push('tone'+x.tExp); var e=(x.errs||[]).join(''); if(e.indexOf('声母')>=0) dims.push('initial'); if(e.indexOf('韵母')>=0) dims.push('final'); }); if(flu<60) dims.push('fluency'); if(!dims.length) return; f.pending=f.pending||[]; f.pending.push({ date:new Date().toISOString().slice(0,10), dims:dims, key:(line&&line.key)||'', closed:false }); if(f.pending.length>20) f.pending=f.pending.slice(-20); saveState(); }catch(e){} }
function checkAiLoop(){ try{ var f=ensureAiFunnel(); if(!f.pending||!f.pending.length) return; var any=false; f.pending.forEach(function(s){ if(!s.closed){ any=true; s.closed=true; } }); if(any){ f.loop=(f.loop||0)+1; f.pending=f.pending.filter(function(s){ return !s.closed; }); f.updated=new Date().toISOString().slice(0,10); saveState(); } }catch(e){} }
function aiFunnelHtml(){ try{ var f=(S.aiFunnel)||{}; var hit=(f.hit||0), miss=(f.miss||0), loop=(f.loop||0); var total=hit+miss; var rate = total>0 ? Math.round(100*loop/total) : 0; var card='<div class="card"><div class="top"><h2>📊 '+T("AI effect self-check")+'</h2><span class="badge">L3</span></div>'
  + '<p class="desc">'+T("Does Nono's AI coaching make you speak more? Here is the loop.")+'</p>'
  + '<div class="weak-row"><div class="wr-txt"><b>'+T("AI coached you")+'</b><span>'+T("times Nono gave a tailored tip")+'</span></div><span class="wr-n">'+hit+'×</span></div>'
  + '<div class="weak-row"><div class="wr-txt"><b>'+T("You came back to drill")+'</b><span>'+T("times you practiced after a tip")+'</span></div><span class="wr-n">'+loop+'×</span></div>'
  + '<div class="weak-row"><div class="wr-txt"><b>'+T("Loop rate")+'</b><span>'+T("coaching → you speak again")+'</span></div><span class="wr-n">'+rate+'%</span></div>'
  + (miss>0?'<div class="weak-row"><div class="wr-txt"><b>'+T("Offline fallback")+'</b><span>'+T("coach missed (offline/timeout)")+'</span></div><span class="wr-n">'+miss+'×</span></div>':'')
  + '</div>'; return card; }catch(e){ return ''; } }
/* 包装 nonoGrade：所有开口（跟读/复习/情境对话）完成后检测闭环，不改旧体 */
(function(){ if(typeof nonoGrade!=='function') return; var _ng=nonoGrade; nonoGrade=function(){ var r=_ng.apply(null,arguments); if(r&&r.then){ r=r.then(function(v){ try{ checkAiLoop(); }catch(e){} return v; }); } else { try{ checkAiLoop(); }catch(e){} } return r; }; })();
/* 包装 buildStat：注入 aiFunnel 随 profile 上云，不改旧体 */
(function(){ if(typeof buildStat!=='function') return; var _bs=buildStat; buildStat=function(){ var s=_bs.apply(null,arguments); try{ s.aiFunnel=(S.aiFunnel||{}); }catch(e){} return s; }; })();
/* 包装 aiWeakHtml：组合漏斗卡，不改旧体 */
(function(){ if(typeof aiWeakHtml!=='function') return; var _aw=aiWeakHtml; aiWeakHtml=function(){ var h=''; try{ h=_aw.apply(null,arguments)||''; }catch(e){} try{ h=h+aiFunnelHtml(); }catch(e){} return h; }; })();
/* ===== /v0.23.16 L3 ===== */
