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
    }
  }catch(e){ /* 离线/超时 → 保留 nonoGrade 内硬编码兜底 comment，不报错 */ }
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
