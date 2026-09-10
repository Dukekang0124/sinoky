#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v0.14.9-dev 中国风整体视觉升级补丁（二进制安全，CRLF 铁律）"""
import sys

p = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app\index.html"
b = open(p, "rb").read()
def B(s): return s.replace('\r\n','\n').replace('\n','\r\n').encode('utf-8')
n_applied = 0

def rep(tag, old, new):
    global b, n_applied
    o = B(old); n = B(new)
    if o not in b:
        print("FAIL(%s): not found" % tag); sys.exit(1)
    if b.count(o) != 1:
        print("FAIL(%s): %d matches" % (tag, b.count(o))); sys.exit(1)
    b = b.replace(o, n); n_applied += 1

# ---------- 一、主题变量层「墨韵·朱砂」 ----------
rep("root-vars",
":root{\n  --bg:#141a24; --bg2:#1b2330; --card:#1e2735; --line:#2b3648;\n  --red:#e63946; --teal:#7fb3b0; --txt:#eef2f7; --sub:#9aa7b8;\n  --t1:#e63946; --t2:#2a9d8f; --t3:#457b9d; --t4:#8d99ae;\n}",
":root{\n  --bg:#161a20; --bg2:#1d232c; --card:#212a35; --line:#33404c;\n  --red:#c2362b; --teal:#8ab8b2; --txt:#eef2f7; --sub:#9aa7b8;\n  --t1:#c2362b; --t2:#2a9d8f; --t3:#457b9d; --t4:#8d99ae;\n  --gold:#c9a86c;\n}")

# body：窗格纹底（CSS 原生网格，透明度 2%，零图片零请求）+ 标题衬线栈
rep("body-tex",
"body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;min-height:100vh}",
"""body{background-color:var(--bg);background-image:repeating-linear-gradient(0deg,rgba(201,168,108,.02) 0 1px,transparent 1px 26px),repeating-linear-gradient(90deg,rgba(201,168,108,.02) 0 1px,transparent 1px 26px);background-attachment:fixed;color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;min-height:100vh}
h1,h2,.brand,.p-hz,.np-line .hz,.hero h1{font-family:"Songti SC","STSong","Noto Serif SC","SimSun",serif;letter-spacing:.3px}""")

# ---------- 二、按钮全面胶囊化 ----------
rep("btn",       ".btn{display:block;width:100%;border:none;border-radius:13px;", ".btn{display:block;width:100%;border:none;border-radius:99px;")
rep("pactions",  ".p-actions .btn{margin-top:0;padding:9px 10px;font-size:12.5px;border-radius:10px;", ".p-actions .btn{margin-top:0;padding:9px 12px;font-size:12.5px;border-radius:99px;")
rep("npfoot",    ".np-foot button{background:var(--red);color:#fff;border:none;border-radius:10px;", ".np-foot button{background:var(--red);color:#fff;border:none;border-radius:99px;")
rep("tonebtn",   ".tonebtn{border:1px solid var(--line);background:var(--bg2);border-radius:13px;", ".tonebtn{border:1px solid var(--line);background:var(--bg2);border-radius:99px;")
rep("syl",       ".syl{border:1px solid var(--line);background:var(--bg);border-radius:10px;", ".syl{border:1px solid var(--line);background:var(--bg);border-radius:99px;")
rep("seg",       ".seg{display:flex;gap:6px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:4px;", ".seg{display:flex;gap:6px;background:var(--card);border:1px solid var(--line);border-radius:99px;padding:4px;}")
rep("rvmode",    ".rv-mode{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;", ".rv-mode{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:99px;")
rep("sentmode",  ".sent-mode-btn{flex:1;background:var(--card);border:1px solid var(--line);border-radius:11px;", ".sent-mode-btn{flex:1;background:var(--card);border:1px solid var(--line);border-radius:99px;")
rep("sentopt",   ".sent-option{background:var(--bg2);border:1px solid var(--line);border-radius:11px;", ".sent-option{background:var(--bg2);border:1px solid var(--line);border-radius:99px;")
rep("record",    ".record{background:rgba(230,57,70,.12);color:var(--red);border:1px solid rgba(230,57,70,.4);font-size:12.5px;border-radius:10px;", ".record{background:rgba(194,54,43,.14);color:var(--red);border:1px solid rgba(194,54,43,.4);font-size:12.5px;border-radius:99px;")
rep("fbopen",    "background:rgba(42,157,143,.92);color:#fff;border:none;border-radius:20px;", "background:rgba(42,157,143,.92);color:#fff;border:none;border-radius:99px;")

# ---------- 三、badge 印章化（朱砂实底 + 金环） ----------
rep("badge",
".badge{font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;background:rgba(230,57,70,.16);color:var(--red);letter-spacing:.4px}\n.badge.teal{background:rgba(127,179,176,.15);color:var(--teal)}",
".badge{font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px;background:var(--red);color:#fff;border:1px solid var(--gold);letter-spacing:.4px}\n.badge.teal{background:rgba(138,184,178,.18);color:var(--teal);border:1px solid rgba(201,168,108,.35)}")

# ---------- 四、诺诺场景钩子 ----------
# 4.1 句卡全清祝贺（markDone push 分支内）
rep("hook-scene-clear",
"""    arr.push(i);
    /* v0.3.58 SRS-lite：首次说完 -> 入排程（bucket 0，明天到期） */
    S.rv = S.rv || {};
    S.rv[curScene.id+':'+i] = { b:0, d:today() };
    saveState(); toast('Nice — now say it twice more out loud');""",
"""    arr.push(i);
    /* v0.3.58 SRS-lite：首次说完 -> 入排程（bucket 0，明天到期） */
    S.rv = S.rv || {};
    S.rv[curScene.id+':'+i] = { b:0, d:today() };
    saveState(); toast('Nice — now say it twice more out loud');
    /* 诺诺场景钩子：本场景句卡全清 -> 祝贺 + 抛下一个场景（每场景一次） */
    try{
      var _tot = (curScene.lines||[]).length;
      if(_tot && arr.length >= _tot && !NONO.sceneCheer[curScene.id]){
        NONO.sceneCheer[curScene.id] = 1;
        nonoShow(T('{n} lines down in this scene — 你全说出来了！ Ready for another scene?').replace('{n}', _tot),
          { pose:'cheer', priority:'result', actions:[{ t:'Next scene', fn:\"go('explore')\" }, { t:'Later', fn:'nonoMin()', ghost:true }] });
      }
    }catch(e){}""")

# 4.2 复习满 5 张鼓励（reviewNext 内）
rep("hook-review-5",
"""  S.review.n = (S.review.n||0) + 1;
  rvShown = false;
  saveState();          /* 复习计数 = 开口证据（真实学习行为），随进度上云 */
  renderHome();""",
"""  S.review.n = (S.review.n||0) + 1;
  rvShown = false;
  saveState();          /* 复习计数 = 开口证据（真实学习行为），随进度上云 */
  /* 诺诺场景钩子：当日复习满 5 张 -> 里程碑鼓励（每天一次） */
  try{
    if(S.review.n === 5){
      nonoShow(T('5 cards reviewed today — 复习让你真的记住。 Keep going or rest, both are wins.'),
        { pose:'cheer', priority:'result', actions:[{ t:'Keep reviewing', fn:'nonoMin()' }, { t:'Done for now', fn:'nonoMin()', ghost:true }] });
    }
  }catch(e){}
  renderHome();""")

# 4.3 聊天 5 轮彩蛋（nonoChatReply 持久化处）
rep("hook-chat-5",
"""    if(S.nonoChat.length > 40) S.nonoChat = S.nonoChat.slice(-40);
    if(typeof saveState==='function') saveState();""",
"""    if(S.nonoChat.length > 40) S.nonoChat = S.nonoChat.slice(-40);
    /* 诺诺场景钩子：累计聊满 5 轮 -> 「会聊天了」彩蛋（仅一次） */
    try{
      if(S.nonoChat.length >= 10 && !NONO.chat5){
        NONO.chat5 = true;
        nonoShow(T('You just had a real conversation in Chinese — 会聊天了！ Keep it up any time.'),
          { pose:'cheer', priority:'result', actions:[{ t:'Thanks Nono', fn:'nonoMin()' }] });
      }
    }catch(e){}
    if(typeof saveState==='function') saveState();""")

# NONO 对象加 sceneCheer 字段
rep("nono-obj",
"var NONO = { seen: {}, lastShow: 0, idleT: null, closed: false, streakSeen: 0 };",
"var NONO = { seen: {}, lastShow: 0, idleT: null, closed: false, streakSeen: 0, sceneCheer: {}, chat5: false };")

bare = b.count(b"\n") - b.count(b"\r\n")
print("applied:", n_applied, "| len:", len(b), "| CRLF:", b.count(b"\r\n"), "| bare LF:", bare)
if bare != 0:
    print("FAIL: bare LF introduced"); sys.exit(1)
open(p, "wb").write(b)
print("PATCH OK")
