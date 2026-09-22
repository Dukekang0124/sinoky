
(function(){
  'use strict';
  var WECHAT_ID = 'Skkhaha456';
  var UNLOCK_CODE = 'sinuoqi66';
  var UNLOCK_KEY = 'sinoky_unlocked';
  var QUOTA_KEY = 'sinoky_quota';
  // 限额表：web 数值；app 为该值的倍率（mult:0 = 不限）
  var QCFG = { sentence:{web:5,mult:3}, score:{web:10,mult:3}, chat:{web:5,mult:3}, tone:{web:10,mult:0} };
  var QLABEL = { sentence:'New lines spoken', score:'Read & score', chat:'Nono chat', tone:'Tone training' };

  function isApp(){ try { return (typeof Capacitor!=='undefined') && Capacitor.isNativePlatform && Capacitor.isNativePlatform(); } catch(e){ return false; } }
  function isUnlocked(){ try { return localStorage.getItem(UNLOCK_KEY)==='1'; } catch(e){ return false; } }
  function loadQuota(){
    var d; try { d = JSON.parse(localStorage.getItem(QUOTA_KEY)||'{}'); } catch(e){ d={}; }
    if(!d.day || d.day !== today()){ d = { day: today(), used:{} }; }
    d.used = d.used || {};
    ['sentence','score','chat','tone'].forEach(function(k){ if(typeof d.used[k]!=='number') d.used[k]=0; });
    return d;
  }
  function saveQuota(d){ try { localStorage.setItem(QUOTA_KEY, JSON.stringify(d)); } catch(e){} }
  function quotaLimit(feat){
    var c = QCFG[feat]; if(!c) return 0;
    if(isUnlocked()) return 0;
    if(isApp()) return c.mult>0 ? c.web*c.mult : 0;
    return c.web;
  }
  function quotaLeft(feat){
    var lim = quotaLimit(feat);
    if(lim===0) return Infinity;
    var d = loadQuota(); return Math.max(0, lim - (d.used[feat]||0));
  }
  function quotaBlocked(feat){ return quotaLeft(feat) <= 0; }
  function quotaInc(feat){
    if(isUnlocked()) return;
    var lim = quotaLimit(feat);
    if(lim===0) return;
    var d = loadQuota(); d.used[feat]=(d.used[feat]||0)+1; saveQuota(d);
  }
  function quotaBadge(feat){
    if(isUnlocked()) return '<span class="qt-chip unl">✅ 已解锁 · 不限次数</span>';
    var lim = quotaLimit(feat);
    if(lim===0) return '<span class="qt-chip unl">📱 App · 不限次数</span>';
    var left = quotaLeft(feat);
    return '<span class="qt-chip '+(left<=0?'warn':'')+'">今天还剩 <b>'+left+'</b> 次'+QLABEL[feat]+'</span>';
  }

  function closeOvl(id){ var el=document.getElementById(id); if(el) el.remove(); }
  window.closeOvl = closeOvl;
  function buildOvl(id){ closeOvl(id); var o=document.createElement('div'); o.className='ovl'; o.id=id; return o; }

  function showLimitWall(feat){
    if(isUnlocked()) return;
    var o = buildOvl('limitWall');
    var p = document.createElement('div'); p.className='panel';
    if(isApp()){
      p.innerHTML = '<h3>'+T('Quota used up for today')+'</h3>'+
        '<p>'+T('Nice work installing the app — but the free quota is limited each day. Add me on WeChat <b>{wx}</b> to unlock everything (permanently).').replace('{wx}',WECHAT_ID)+'</p>'+
        '<div class="wc-steps">'+T('① Tap "Copy WeChat ID"<br>② Open WeChat → top-right ＋ → Add Contacts<br>③ Paste {wx} → send the unlock code').replace('{wx}',WECHAT_ID)+'</div>'+
        '<button class="btn primary" style="width:100%" onclick="SK.copyWechat()">📋 '+T('Copy WeChat ID')+'</button>'+
        '<button class="btn" style="width:100%;margin-top:8px" onclick="SK.doUnlock()">✅ '+T('I have added WeChat — unlock everything')+'</button>'+
        '<div style="margin-top:10px"><input class="codeinput" id="ucode" placeholder="'+T('Or enter an unlock code')+'" />'+
        '<button class="btn ghost" style="width:100%" onclick="SK.tryUnlockCode(document.getElementById(\'ucode\').value)">'+T('Unlock')+'</button></div>'+
        '<button class="btn ghost" style="width:100%;margin-top:8px" onclick="closeOvl(\'limitWall\')">'+T('Close')+'</button>';
    } else {
      var sub = T('Free version has a daily limit — install the app for unlimited use. All your learning data is kept.');
      if(feat==='chat') sub=T('Free chat is {n} rounds a day. Install the app for unlimited use.').replace('{n}',QCFG.chat.web);
      else if(feat==='tone') sub=T('Tone training is {n} questions a day for free. Install the app for unlimited use.').replace('{n}',QCFG.tone.web);
      else if(feat==='sentence') sub=T('{n} new lines a day for free. Install the app for unlimited use.').replace('{n}',QCFG.sentence.web);
      p.innerHTML = '<h3>'+T('Free uses are used up for today')+'</h3>'+
        '<p>'+sub+'</p>'+
        '<div class="two">'+
        '<button class="btn primary" onclick="location.href=\'download.html\'">📱 '+T('Install App · Unlimited')+'</button>'+
        '<button class="btn" onclick="go(\'review\')">🔁 '+T('Practise review for today')+'</button>'+
        '</div>'+
        '<button class="btn ghost" style="width:100%;margin-top:10px" onclick="closeOvl(\'limitWall\')">'+T('Later')+'</button>';
    }
    o.appendChild(p); document.body.appendChild(o);
    o.addEventListener('click', function(e){ if(e.target===o) closeOvl('limitWall'); });
  }
  function copyWechat(){ copyText(WECHAT_ID, T('WeChat ID copied: {wx} — add me on WeChat to unlock').replace('{wx}',WECHAT_ID)); }
  function doUnlock(){
    try { localStorage.setItem(UNLOCK_KEY,'1'); } catch(e){}
    closeOvl('limitWall');
    toast(T('✅ Everything unlocked · thanks for the support!'));
    renderQuotaUI();
  }
  function tryUnlockCode(code){
    if((code||'').trim() === UNLOCK_CODE){ doUnlock(); }
    else { toast(T('That code is not right — get one from WeChat {wx}').replace('{wx}',WECHAT_ID)); }
  }

  // E2「我」页额度卡 + 解锁状态行
  function renderQuotaUI(){
    var me = document.getElementById('v-me'); if(!me) return;
    var old = document.getElementById('quotaCard'); if(old) old.remove();
    var card = document.createElement('div'); card.className='card'; card.id='quotaCard';
    var rows = '';
    ['sentence','score','chat','tone'].forEach(function(k){
      var left = quotaLeft(k); var lim = quotaLimit(k);
      var txt = (left===Infinity) ? T('No limit') : (isUnlocked() ? T('No limit (unlocked)') : left+' / '+lim);
      rows += '<div class="qrow"><span>'+T(QLABEL[k])+'</span><span>'+txt+'</span></div>';
    });
    var unlockRow;
    if(isUnlocked()){
      unlockRow = '<div class="unl-row"><span>✅ '+T('Unlocked · thanks for the support')+'</span><button class="btn ghost" onclick="SK.resetUnlock()">'+T('Undo')+'</button></div>';
    } else {
      var appNote = isApp() ? T(' (App gets 3× quota)') : '';
      unlockRow = '<div class="unl-row"><span>🔓 '+T('Unlock features')+appNote+'</span><button class="btn ghost" onclick="SK.showLimitWall(\'chat\')">'+T('Unlock')+'</button></div>';
    }
    card.innerHTML = '<div class="top"><h2>📊 '+T('Today\'s quota')+'</h2>'+(isUnlocked()?'<span class="badge teal">UNLOCKED</span>':'<span class="badge">'+T('Free version')+'</span>')+'</div>'+
      '<p class="desc">'+T('Review, flashcards, badges and progress are never limited — only "production" features count against the quota.')+'</p>'+ rows + unlockRow;
    var first = me.querySelector('.card');
    if(first && first.parentNode===me) me.insertBefore(card, first.nextSibling);
  }
  window.SK = {
    isApp:isApp, isUnlocked:isUnlocked, quotaLeft:quotaLeft, quotaBlocked:quotaBlocked,
    quotaInc:quotaInc, quotaBadge:quotaBadge, showLimitWall:showLimitWall,
    copyWechat:copyWechat, doUnlock:doUnlock, tryUnlockCode:tryUnlockCode, renderQuotaUI:renderQuotaUI,
    maybeExtendSentence:maybeExtendSentence
  };
  window.SK.resetUnlock = function(){ try{ localStorage.removeItem(UNLOCK_KEY); }catch(e){} renderQuotaUI(); toast(T('Unlock removed')); };

  // ===== 接一句 P0（零 LLM 成本、不判分、只记录开口）=====
  function maybeExtendSentence(p){
    if(!p || !p.hz) return;
    var o = buildOvl('extendModal');
    var panel = document.createElement('div'); panel.className='panel';
    panel.innerHTML = '<h3>'+T('Say your own line 💬')+'</h3>'+
      '<div class="extend-prompt">'+T('You just said: <b>{hz}</b><br>Swap a word and say your own line → 3 seconds is enough (not scored — we just count that you spoke).').replace('{hz}',esc(p.hz))+'</div>'+
      '<button class="btn primary" id="extRec" style="width:100%"><span class="rec-dot"></span>🎤 '+T('I will say my own line')+'</button>'+
      '<button class="btn ghost" style="width:100%;margin-top:8px" onclick="closeOvl(\'extendModal\')">'+T('Skip')+'</button>';
    o.appendChild(panel); document.body.appendChild(o);
    var btn = panel.querySelector('#extRec');
    btn.addEventListener('click', function(){ startExtend(btn, panel); });
  }
  var extRec=null, extStart=0;
  function startExtend(btn, panel){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder==='undefined'){
      panel.innerHTML='<h3>'+T('Say your own line 💬')+'</h3><p>'+T('This browser cannot record audio. You are already practising — skipping is fine 👍')+'</p><button class="btn" style="width:100%" onclick="closeOvl(\'extendModal\')">'+T('Close')+'</button>'; return;
    }
    if(extRec && extRec.state!=='inactive'){ try{extRec.stop();}catch(e){} return; }
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      var chunks=[]; var rec=new MediaRecorder(stream);
      extRec=rec; extStart=Date.now();
      rec.ondataavailable=function(e){ if(e.data&&e.data.size) chunks.push(e.data); };
      rec.onstop=function(){
        stream.getTracks().forEach(function(t){try{t.stop();}catch(e){}});
        var dur=(Date.now()-extStart)/1000;
        btn.textContent='🎤 '+T('I will say my own line');
        if(dur<1){ var pr=panel.querySelector('.extend-prompt'); if(pr) pr.insertAdjacentHTML('beforeend','<div style="color:#ffb3b9;margin-top:6px">'+T('Did not hear anything — try again ✦')+'</div>'); return; }
        try{ S.extend=S.extend||{n:0}; S.extend.n++; saveState(); }catch(e){}
        panel.innerHTML='<h3>'+T('Say your own line 💬')+'</h3><div class="extend-prompt">✅ '+T('✅ You said a line of your own Chinese! (total lines: {n})').replace('{n}',(S.extend?S.extend.n:1))+'</div><button class="btn" style="width:100%" onclick="closeOvl(\'extendModal\')">'+T('Done')+'</button>';
      };
      rec.onerror=function(){ btn.textContent='🎤 '+T('I will say my own line'); var pr=panel.querySelector('.extend-prompt'); if(pr) pr.insertAdjacentHTML('beforeend','<div style="color:#ffb3b9;margin-top:6px">'+T('Recording error — skipping is fine ✦')+'</div>'); };
      btn.textContent='⏹ '+T('Tap here when done');
      var pr=panel.querySelector('.extend-prompt'); if(pr) pr.insertAdjacentHTML('beforeend','<div style="margin-top:6px;color:#9be29b">● '+T('● Recording… say it, then tap "done"')+'</div>');
      rec.start();
    }).catch(function(){
      panel.innerHTML='<h3>'+T('Say your own line 💬')+'</h3><p>'+T('The microphone would not open — skipping is fine 👍')+'</p><button class="btn" style="width:100%" onclick="closeOvl(\'extendModal\')">'+T('Close')+'</button>';
    });
  }

  // 包裹 renderMe，使其渲染后注入额度卡
  function hookRenderMe(){
    var orig = window.renderMe;
    window.renderMe = function(){ if(orig) orig.apply(null, arguments); renderQuotaUI(); };
  }
  if(typeof window.renderMe==='function'){ hookRenderMe(); }
  else { document.addEventListener('DOMContentLoaded', function(){ renderQuotaUI(); }); }
  try { if(document.readyState!=='loading') renderQuotaUI(); } catch(e){}
})();
