# -*- coding: utf-8 -*-
"""i18n 缺口修复补丁 v1（2026-09-22）
铁律：单行片段替换；每条 count assert；全通过才写盘；幂等（已打过的片段自动跳过判定）。
"""
import io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', 'index.html'))
src = io.open(SRC, encoding='utf-8', newline='').read()
orig_len = len(src)
applied, skipped = [], []

def rep(tag, old, new, expect=1):
    """替换。若 new 已存在且 old 不存在 → 视为已打过（幂等）。"""
    global src
    n_old = src.count(old)
    n_new = src.count(new)
    if n_old == 0 and n_new >= expect:
        skipped.append(tag); return
    if n_old != expect:
        sys.exit('ABORT [%s] old count=%d expect=%d (文件未写盘)' % (tag, n_old, expect))
    src = src.replace(old, new, expect)
    applied.append(tag)

# ===== A. 限额墙 / 解锁 / 额度卡（v0.21.0 块） =====
rep('A01', """'<h3>今天的额度用完了</h3>'+""", """'<h3>'+T('Quota used up for today')+'</h3>'+""")
rep('A02', """'<p>装到手机已经很给力了，但免费额度每天有限。加我微信 <b>'+WECHAT_ID+'</b> 解锁全部功能（永久）。</p>'+""",
    """'<p>'+T('Nice work installing the app — but the free quota is limited each day. Add me on WeChat <b>{wx}</b> to unlock everything (permanently).').replace('{wx}',WECHAT_ID)+'</p>'+""")
rep('A03', """'<div class="wc-steps">① 点「复制微信号」<br>② 打开微信 → 右上角 ＋ → 添加朋友<br>③ 粘贴 '+WECHAT_ID+' → 发「解锁码」</div>'+""",
    """'<div class="wc-steps">'+T('① Tap "Copy WeChat ID"<br>② Open WeChat → top-right ＋ → Add Contacts<br>③ Paste {wx} → send the unlock code').replace('{wx}',WECHAT_ID)+'</div>'+""")
rep('A04', """onclick="SK.copyWechat()">📋 复制微信号</button>'+""",
    """onclick="SK.copyWechat()">📋 '+T('Copy WeChat ID')+'</button>'+""")
rep('A05', """onclick="SK.doUnlock()">✅ 我已添加微信，解锁全部功能</button>'+""",
    """onclick="SK.doUnlock()">✅ '+T('I have added WeChat — unlock everything')+'</button>'+""")
rep('A06', """placeholder="或输入解锁码" />'+""", """placeholder="'+T('Or enter an unlock code')+'" />'+""")
rep('A07', """.value)">解锁</button></div>'+""", """.value)">'+T('Unlock')+'</button></div>'+""")
rep('A08', """closeOvl(\\'limitWall\\')">关闭</button>';""",
    """closeOvl(\\'limitWall\\')">'+T('Close')+'</button>';""")
rep('A09', """var sub = '免费版每天有限额，装 App 后不限次数 —— 你的学习数据会全部保留。';""",
    """var sub = T('Free version has a daily limit — install the app for unlimited use. All your learning data is kept.');""")
rep('A10', """if(feat==='chat') sub='诺诺聊天每天免费 '+QCFG.chat.web+' 轮。装 App 后不限次数。';""",
    """if(feat==='chat') sub=T('Free chat is {n} rounds a day. Install the app for unlimited use.').replace('{n}',QCFG.chat.web);""")
rep('A11', """else if(feat==='tone') sub='声调训练每天免费 '+QCFG.tone.web+' 题。装 App 后不限次数。';""",
    """else if(feat==='tone') sub=T('Tone training is {n} questions a day for free. Install the app for unlimited use.').replace('{n}',QCFG.tone.web);""")
rep('A12', """else if(feat==='sentence') sub='每天免费练 '+QCFG.sentence.web+' 句新内容。装 App 后不限次数。';""",
    """else if(feat==='sentence') sub=T('{n} new lines a day for free. Install the app for unlimited use.').replace('{n}',QCFG.sentence.web);""")
rep('A13', """'<h3>今天的免费次数用完了</h3>'+""", """'<h3>'+T('Free uses are used up for today')+'</h3>'+""")
rep('A14', """download.html\\'">📱 装 App · 不限次数</button>'+""",
    """download.html\\'">📱 '+T('Install App · Unlimited')+'</button>'+""")
rep('A15', """go(\\'review\\')">🔁 今天先练复习</button>'+""",
    """go(\\'review\\')">🔁 '+T('Practise review for today')+'</button>'+""")
rep('A16', """closeOvl(\\'limitWall\\')">稍后再说</button>';""",
    """closeOvl(\\'limitWall\\')">'+T('Later')+'</button>';""")
rep('A17', """function copyWechat(){ copyText(WECHAT_ID, '微信号已复制：'+WECHAT_ID+'，去微信加我解锁'); }""",
    """function copyWechat(){ copyText(WECHAT_ID, T('WeChat ID copied: {wx} — add me on WeChat to unlock').replace('{wx}',WECHAT_ID)); }""")
rep('A18', """toast('✅ 已解锁全部功能 · 感谢支持！');""", """toast(T('✅ Everything unlocked · thanks for the support!'));""")
rep('A19', """else { toast('解锁码不对，加微信 '+WECHAT_ID+' 领取'); }""",
    """else { toast(T('That code is not right — get one from WeChat {wx}').replace('{wx}',WECHAT_ID)); }""")
rep('A20', """var QLABEL = { sentence:'新句开口', score:'跟读打分', chat:'诺诺聊天', tone:'声调训练' };""",
    """var QLABEL = { sentence:'New lines spoken', score:'Read & score', chat:'Nono chat', tone:'Tone training' };""")
rep('A20b', """rows += '<div class="qrow"><span>'+QLABEL[k]+'</span><span>'+txt+'</span></div>';""",
    """rows += '<div class="qrow"><span>'+T(QLABEL[k])+'</span><span>'+txt+'</span></div>';""")
rep('A21', """var txt = (left===Infinity) ? '不限' : (isUnlocked() ? '不限（已解锁）' : left+' / '+lim);""",
    """var txt = (left===Infinity) ? T('No limit') : (isUnlocked() ? T('No limit (unlocked)') : left+' / '+lim);""")
rep('A22', """unlockRow = '<div class="unl-row"><span>✅ 已解锁 · 感谢支持</span><button class="btn ghost" onclick="SK.resetUnlock()">撤销</button></div>';""",
    """unlockRow = '<div class="unl-row"><span>✅ '+T('Unlocked · thanks for the support')+'</span><button class="btn ghost" onclick="SK.resetUnlock()">'+T('Undo')+'</button></div>';""")
rep('A23', """var appNote = isApp() ? '（App 已享 3 倍额度）' : '';""",
    """var appNote = isApp() ? T(' (App gets 3× quota)') : '';""")
rep('A24', """unlockRow = '<div class="unl-row"><span>🔓 功能解锁'+appNote+'</span><button class="btn ghost" onclick="SK.showLimitWall(\\'chat\\')">解锁</button></div>';""",
    """unlockRow = '<div class="unl-row"><span>🔓 '+T('Unlock features')+appNote+'</span><button class="btn ghost" onclick="SK.showLimitWall(\\'chat\\')">'+T('Unlock')+'</button></div>';""")
rep('A25', """'<div class="top"><h2>📊 今日额度</h2>'+(isUnlocked()?'<span class="badge teal">UNLOCKED</span>':'<span class="badge">免费版</span>')+'</div>'+""",
    """'<div class="top"><h2>📊 '+T('Today\\'s quota')+'</h2>'+(isUnlocked()?'<span class="badge teal">UNLOCKED</span>':'<span class="badge">'+T('Free version')+'</span>')+'</div>'+""")
rep('A26', """'<p class="desc">复习 / 字卡 / 徽章 / 进度永不限制 —— 只限制「生产」类功能。</p>'+ rows + unlockRow;""",
    """'<p class="desc">'+T('Review, flashcards, badges and progress are never limited — only "production" features count against the quota.')+'</p>'+ rows + unlockRow;""")
rep('A27', """renderQuotaUI(); toast('已撤销解锁'); };""", """renderQuotaUI(); toast(T('Unlock removed')); };""")

# ===== B. 接一句（截图实锤） =====
rep('B01', """panel.innerHTML = '<h3>接一句 💬</h3>'+""",
    """panel.innerHTML = '<h3>'+T('Say your own line 💬')+'</h3>'+""")
rep('B02', """'<div class="extend-prompt">你刚说了：<b>'+esc(p.hz)+'</b><br>换一个词，说一句你自己的 → 说 3 秒就行（不判分，只记录你开口了）。</div>'+""",
    """'<div class="extend-prompt">'+T('You just said: <b>{hz}</b><br>Swap a word and say your own line → 3 seconds is enough (not scored — we just count that you spoke).').replace('{hz}',esc(p.hz))+'</div>'+""")
rep('B03', """<span class="rec-dot"></span>🎤 我来改一句</button>'+""",
    """<span class="rec-dot"></span>🎤 '+T('I will say my own line')+'</button>'+""")
rep('B04', """closeOvl(\\'extendModal\\')">跳过</button>';""",
    """closeOvl(\\'extendModal\\')">'+T('Skip')+'</button>';""")
rep('B05', """panel.innerHTML='<h3>接一句 💬</h3><p>这个浏览器不支持录音。你已经在练了，跳过也行 👍</p><button class="btn" style="width:100%" onclick="closeOvl(\\'extendModal\\')">关闭</button>'; return;""",
    """panel.innerHTML='<h3>'+T('Say your own line 💬')+'</h3><p>'+T('This browser cannot record audio. You are already practising — skipping is fine 👍')+'</p><button class="btn" style="width:100%" onclick="closeOvl(\\'extendModal\\')">'+T('Close')+'</button>'; return;""")
rep('B06', """btn.textContent='🎤 我来改一句';
        if(dur<1)""", """btn.textContent='🎤 '+T('I will say my own line');
        if(dur<1)""")
rep('B07', """insertAdjacentHTML('beforeend','<div style="color:#ffb3b9;margin-top:6px">没听到声音，再试一次 ✦</div>'); return; }""",
    """insertAdjacentHTML('beforeend','<div style="color:#ffb3b9;margin-top:6px">'+T('Did not hear anything — try again ✦')+'</div>'); return; }""")
rep('B08', """panel.innerHTML='<h3>接一句 💬</h3><div class="extend-prompt">✅ 你说了一句自己的中文！（累计扩展句：'+(S.extend?S.extend.n:1)+'）</div><button class="btn" style="width:100%" onclick="closeOvl(\\'extendModal\\')">完成</button>';""",
    """panel.innerHTML='<h3>'+T('Say your own line 💬')+'</h3><div class="extend-prompt">✅ '+T('✅ You said a line of your own Chinese! (total lines: {n})').replace('{n}',(S.extend?S.extend.n:1))+'</div><button class="btn" style="width:100%" onclick="closeOvl(\\'extendModal\\')">'+T('Done')+'</button>';""")
rep('B09', """rec.onerror=function(){ btn.textContent='🎤 我来改一句'; var pr=panel.querySelector('.extend-prompt'); if(pr) pr.insertAdjacentHTML('beforeend','<div style="color:#ffb3b9;margin-top:6px">录音出错，跳过也行 ✦</div>'); };""",
    """rec.onerror=function(){ btn.textContent='🎤 '+T('I will say my own line'); var pr=panel.querySelector('.extend-prompt'); if(pr) pr.insertAdjacentHTML('beforeend','<div style="color:#ffb3b9;margin-top:6px">'+T('Recording error — skipping is fine ✦')+'</div>'); };""")
rep('B10', """btn.textContent='⏹ 说完了点这里';""", """btn.textContent='⏹ '+T('Tap here when done');""")
rep('B11', """'<div style="margin-top:6px;color:#9be29b">● 录音中…说完点「说完了」</div>');""",
    """'<div style="margin-top:6px;color:#9be29b">● '+T('● Recording… say it, then tap "done"')+'</div>');""")
rep('B12', """panel.innerHTML='<h3>接一句 💬</h3><p>麦克风打不开，跳过也行 👍</p><button class="btn" style="width:100%" onclick="closeOvl(\\'extendModal\\')">关闭</button>';""",
    """panel.innerHTML='<h3>'+T('Say your own line 💬')+'</h3><p>'+T('The microphone would not open — skipping is fine 👍')+'</p><button class="btn" style="width:100%" onclick="closeOvl(\\'extendModal\\')">'+T('Close')+'</button>';""")

# ===== C. 其余中文裸串 =====
rep('C01', """toast('发音暂不可用 — ' + humanizeApiErr(null, lastTtsStatus || 0));""",
    """toast(T('Pronunciation unavailable — ') + humanizeApiErr(null, lastTtsStatus || 0));""")
rep('C02', """if(msg) msg.innerHTML = T('Let us say this one together.') + ' <b>跟我读</b>';""",
    """if(msg) msg.innerHTML = T('Let us say this one together.') + ' <b>'+T('Read after me')+'</b>';""", expect=3)
rep('C02b', """nonoShow("Practice with me — <b>跟我读</b>", { pose:'like' });""",
    """nonoShow(T('Practice with me — <b>Read after me</b>'), { pose:'like' });""")
rep('C03', """? '<div class="p-en them">他们：'+p.hear.en+'</div>'""",
    """? '<div class="p-en them">'+T('They: ')+p.hear.en+'</div>'""")
rep('C04', """(p.hear?'他们说了「'+p.hear.hz+'」 — 你答：'+p.en+'（答完看 ✓）'""",
    """(p.hear?T('They said "{hz}" — you answer: {en} (check ✓ after speaking)').replace('{hz}',p.hear.hz).replace('{en}',p.en)""")
rep('C05', """: '<span class="fc-level-pending">待补充</span>');""",
    """: '<span class="fc-level-pending">'+T('Coming soon')+'</span>');""")
rep('C06', """$('fc-prog').textContent = 'HSK' + level + ' · 待补充';""",
    """$('fc-prog').textContent = 'HSK' + level + ' · ' + T('Coming soon');""")
rep('C07', """'HSK' + level + ' deck is coming soon.' +""",
    """T('HSK{n} deck is coming soon.').replace('{n}',level) +""")
rep('C08', """'<br><span class="fc-pending-zh">我们正在根据教材策展 HSK' + level + ' 字卡，敬请期待。</span>' +""",
    """'<br><span class="fc-pending-zh">'+T('We are curating the HSK{n} deck from the textbook — stay tuned.').replace('{n}',level)+'</span>' +""")

# ===== D. 英文裸串包 T()（修 6 个非英语种的英文 fallback） =====
rep('D01', """btn.textContent='🎤 Read & score';""", """btn.textContent=T('🎤 Read & score');""", expect=2)
rep('D02', """'<div class="score-err">No sound captured. Try again.</div>'""",
    """'<div class="score-err">'+T('No sound captured. Try again.')+'</div>'""")
rep('D03', """||'could not hear that')""", """||T('could not hear that'))""")
rep('D04', """'<div class="score-err">Recording error. Try again.</div>'""",
    """'<div class="score-err">'+T('Recording error. Try again.')+'</div>'""")
rep('D05', """'<div class="score-err">🎤 Microphone blocked.<div class="mic-help">'+steps+'</div></div>';""",
    """'<div class="score-err">'+T('🎤 Microphone blocked.')+'<div class="mic-help">'+steps+'</div></div>';""")
rep('D06', """var steps = isWeChat?'Tap ··· → Open in Browser, then allow the microphone.' : isIOS?'Settings → Safari → Microphone → Allow':'Tap the 🔒 lock → Site settings → Microphone → Allow, then reload.';""",
    """var steps = isWeChat?T('Tap ··· → Open in Browser, then allow the microphone.') : isIOS?T('Settings → Safari → Microphone → Allow'):T('Tap the 🔒 lock → Site settings → Microphone → Allow, then reload.');""")
rep('D07', """if(btn) btn.title = 'Trying another voice source…';""",
    """if(btn) btn.title = T('Trying another voice source…');""")
rep('D08', """steps = 'WeChat blocks microphone access. Tap <b>···</b> (top-right) → <b>Open in Browser</b>, then allow the microphone.';""",
    """steps = T('WeChat blocks microphone access. Tap <b>···</b> (top-right) → <b>Open in Browser</b>, then allow the microphone.');""")
rep('D09', """steps = 'iPhone: <b>Settings → Safari → Microphone → Allow</b>. Or in Safari tap <b>aA</b> (address bar) → <b>Website Settings → Microphone → Allow</b>.';""",
    """steps = T('iPhone: <b>Settings → Safari → Microphone → Allow</b>. Or in Safari tap <b>aA</b> (address bar) → <b>Website Settings → Microphone → Allow</b>.');""")
rep('D10', """steps = 'Tap the <b>🔒 lock icon</b> in the address bar → <b>Site settings → Microphone → Allow</b>, then reload.';""",
    """steps = T('Tap the <b>🔒 lock icon</b> in the address bar → <b>Site settings → Microphone → Allow</b>, then reload.');""")
rep('D11', """'<div class="score-err">🎤 Microphone blocked.' +
        '<div class="mic-help">' + steps + '</div></div>';""",
    """'<div class="score-err">'+T('🎤 Microphone blocked.') +
        '<div class="mic-help">' + steps + '</div></div>';""")
rep('D12', """'<div class="score-err">Could not open the microphone: ' +
        (e && e.message || e) + '</div>';""",
    """'<div class="score-err">'+T('Could not open the microphone: ') +
        (e && e.message || e) + '</div>';""")
rep('D13', """onerror="this.remove()">Could not load the card deck.<br>Reconnect and reopen the app to try again.</div>';""",
    """onerror="this.remove()">'+T('Could not load the card deck.<br>Reconnect and reopen the app to try again.')+'</div>';""")
rep('D14', """'<div class="fc-empty">No saved characters yet.<br>Tap “☆ Save” on a card to keep it here.</div>'""",
    """'<div class="fc-empty">'+T('No saved characters yet.<br>Tap “☆ Save” on a card to keep it here.')+'</div>'""")
rep('D15', """'<div class="fc-empty">Could not load sentence templates.</div>';""",
    """'<div class="fc-empty">'+T('Could not load sentence templates.')+'</div>';""")
rep('D16', """$('sent-stats').textContent = 'Pick a mode and complete a prompt to start tracking.';""",
    """$('sent-stats').textContent = T('Pick a mode and complete a prompt to start tracking.');""")
rep('D17', """'<div class="fc-empty">Loading sentence templates…</div>'""",
    """'<div class="fc-empty">'+T('Loading sentence templates…')+'</div>'""")
rep('D18', """'<div class="fc-empty">No templates for this mode.</div>'""",
    """'<div class="fc-empty">'+T('No templates for this mode.')+'</div>'""")
rep('D19', """? "In English, what did you want to say? e.g. \\"ask the taxi driver to wait 5 minutes\\""
        : "e.g. The Score button stays on Listening\\u2026 and never gives a result.";""",
    """? T("In English, what did you want to say? e.g. \\"ask the taxi driver to wait 5 minutes\\"")
        : T("e.g. The Score button stays on Listening\\u2026 and never gives a result.");""")
rep('D20', """title="Practise with Nono\"""", """title="'+T('Practise with Nono')+'\"""", expect=5)
rep('D21', """aria-label="Practise this line with Nono\"""",
    """aria-label="'+T('Practise this line with Nono')+'\"""", expect=6)
rep('D22', """onclick="markDone('+i+')">'+(isDone?'✓ Done':'I said it 3×')+'</button>'+""",
    """onclick="markDone('+i+')">'+(isDone?T('✓ Done'):T('I said it 3×'))+'</button>'+""")

io.open(SRC, 'w', encoding='utf-8', newline='').write(src)
print('applied:', len(applied), '| skipped(已打过):', len(skipped))
print('delta chars: %+d' % (len(src) - orig_len))
for t in applied: print('  +', t)
for t in skipped: print('  =', t)
