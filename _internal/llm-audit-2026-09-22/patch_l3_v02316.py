# -*- coding: utf-8 -*-
# v0.23.16 L3 闭环度量补丁（仅网页线）。幂等 + count 断言 + 结构守卫。
# 策略：v0.23.15 同特性块加 3 行（hit/seed/miss）；追加 v0.23.16 块（函数 + 3 个包装器，不改旧体）。
import os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'index.html')

applied, skipped = [], []
def rep(tag, old, new, expect=1, file_path=SRC):
    global src
    n_old = src.count(old); n_new = src.count(new)
    if n_old == 0 and n_new >= expect:
        skipped.append(tag); return
    if n_old != expect:
        sys.exit('ABORT [%s] old count=%d expect=%d' % (tag, n_old, expect))
    src = src.replace(old, new, expect)
    applied.append(tag)

src = open(SRC, encoding='utf-8').read()
guard = '/* ===== v0.23.16 L3 闭环度量'
if guard in src:
    print('ALREADY_PATCHED'); sys.exit(0)

# --- 1. v0.23.15 同特性块：hit + seed（成功分支） ---
rep('L3-HIT',
"      recordAiWeak(fixes, flu);\n    }",
"      recordAiWeak(fixes, flu);\n      recordAiFunnel('hit'); seedAiLoop(line, fixes, flu);\n    }", expect=1)

# --- 2. v0.23.15 同特性块：miss（离线/超时 catch） ---
rep('L3-MISS',
"  }catch(e){ /* 离线/超时 → 保留 nonoGrade 内硬编码兜底 comment，不报错 */ }",
"  }catch(e){ recordAiFunnel('miss'); /* 离线/超时 → 保留 nonoGrade 内硬编码兜底 comment，不报错 */ }", expect=1)

# --- 3. 插入 v0.23.16 追加块（在 v0.23.15 块注释前） ---
BLOCK = r'''

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
'''
anchor = '<!-- ===== /v0.23.15 AI coach ===== -->'
n_anchor = src.count(anchor)
if n_anchor != 1:
    sys.exit('ABORT [INSERT] anchor count=%d' % n_anchor)
src = src.replace(anchor, BLOCK + anchor, 1)
applied.append('L3-BLOCK')

# --- 4. APP_VERSION 0.23.15 → 0.23.16 ---
rep('L3-VER', "var APP_VERSION = '0.23.15';", "var APP_VERSION = '0.23.16';", expect=1)

open(SRC, 'w', encoding='utf-8').write(src)
print('APPLIED', applied)
print('SKIPPED', skipped)
