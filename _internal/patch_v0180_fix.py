# -*- coding: utf-8 -*-
"""v0.18.0 审计修复：P0 功能性缺陷 + P1 体验/合规 + i18n 字典补齐"""
import os, re, json, io

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
P = os.path.join(APP, "index.html")
BS = chr(92)  # backslash

b = open(P, "rb").read()
H = b.decode("utf-8")
orig = H
n_fix = 0

def rep(old, new, n=1, label=""):
    global H, n_fix
    c = H.count(old)
    assert c == n, f"[{label}] 命中 {c} 次（期望 {n}）：{old[:70]!r}"
    H = H.replace(old, new)
    n_fix += 1
    print(f"  OK  {label or old[:48]}")

# ============ P0-1: 静态 HTML 里的 \u{...} 转义不会被解码 → 页面显示原始转义 ============
rep('<h2>' + BS + 'u{1F501} Smart review</h2><span class="badge" id="rv-count"',
    '<h2>\U0001F501 Smart review</h2><span class="badge" id="rv-count"',
    1, "P0-1 review 标题 \\u{1F501} 字面量泄漏")

# ============ P0-2: rv-acts 里 🐼 按钮 flex:0 0 auto + .btn{width:100%} → 撑破 115px ============
rep('style="flex:0 0 auto;padding:0 12px" title="Practise with Nono"',
    'style="flex:0 0 auto;width:auto;padding:0 12px" title="Practise with Nono"',
    2, "P0-2 复习页 🐼 按钮撑破容器")

# ============ P0-4: 徽章解锁气泡暴露内部 ID ============
rep("var names = fresh.join(', ');",
    "var names = fresh.map(function(id){"
    " var sp = document.querySelector('#prog-badges .badge-cell[data-badge=\"'+id+'\"] span');"
    " var nm = sp && sp.textContent ? sp.textContent.replace(/\\s+/g,' ').trim() : '';"
    " return nm || id; }).join(', ');",
    1, "P0-4 徽章气泡用可读名而非内部 ID")

# ============ i18n：把拼接句改成可翻译模板 ============
rep("$('days-count').textContent = cd > DAYS.length ? 'ALL DONE' : 'DAY '+cd+' / '+DAYS.length;",
    "$('days-count').textContent = cd > DAYS.length ? T('ALL DONE')"
    " : T('DAY {d} / {n}').replace('{d}',cd).replace('{n}',DAYS.length);",
    1, "i18n 天数计数器改模板")
rep("""'<span class="cz">Day '+d.day+' · '+(done?'✓ done':'tap to practice')+'</span></span></button>';""",
    """'<span class="cz">'+T('Day {d} · {s}').replace('{d}',d.day).replace('{s}', done?T('✓ done'):T('tap to practice'))+'</span></span></button>';""",
    1, "i18n 天数副标题改模板")
rep("""'<button class="daylink" onclick="go(\\'days\\')">See all '+DAYS.length+' days →</button></div>';""",
    """'<button class="daylink" onclick="go(\\'days\\')">'+T('See all {n} days →').replace('{n}',DAYS.length)+'</button></div>';""",
    1, "i18n 查看全部 N 天改模板")
rep("$('city-count').textContent = cityList().length + ' CITIES';",
    "$('city-count').textContent = T('{n} CITIES').replace('{n}', cityList().length);",
    1, "i18n 城市计数改模板")
rep("""'<span class="badge teal">'+q.length+' due</span></div>'+""",
    """'<span class="badge teal">'+T('{n} due').replace('{n}',q.length)+'</span></div>'+""",
    1, "i18n 待复习计数改模板")

# ============ P1-7: 中国香港标注（合规） ============
c_hk = H.count("city:'香港'")
rep("city:'香港'", "city:'中国香港'", c_hk, f"P1-7 城市标签 香港→中国香港（{c_hk} 处）")
rep("title:'Hong Kong · Victoria Harbour'", "title:'Hong Kong, China · Victoria Harbour'",
    1, "P1-7 城市卡标题标注中国")
rep("Victoria Harbour and milk tea in Hong Kong. Tap, listen, then say it 3 times.",
    "Victoria Harbour and milk tea in Hong Kong, China. Tap, listen, then say it 3 times.",
    1, "P1-7 城市描述标注中国")

# ============ P1-6/8 + P0-2 兜底：追加样式块（放 </body> 前，source order 必胜） ============
STYLE = (
'<style id="cn-audit-fix">' + "\r\n"
'/* v0.18.0 审计修复（纯追加，不改旧规则） */' + "\r\n"
'.rv-acts .btn{width:auto}                        /* P0-2 兜底：flex:0 0 auto 时不再拿 100% 当基准 */' + "\r\n"
'.btn.ghost.speed,.btn.record{min-height:44px}    /* P1-6 场景页主操作钮 36→44 */' + "\r\n"
'.daytab{min-height:44px}                         /* P1-6 时间线/主题切换 37→44 */' + "\r\n"
'.daylink{min-height:44px;display:flex;align-items:center}' + "\r\n"
'#v-prog .btn{min-height:44px}                    /* P1-6 导出/导入 41→44 */' + "\r\n"
'.day1-step .panda-practice{width:34px;height:34px}   /* P1-6 熊猫练句钮 28→34 */' + "\r\n"
'#v-days .dz{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;' + "\r\n"
'  -webkit-box-orient:vertical;line-height:1.4;max-height:2.8em}   /* P1-8 单行截断→两行 */' + "\r\n"
'#v-onboard h1 .hl{white-space:nowrap}            /* P1-8 引导页高亮短语不再断在半字 */' + "\r\n"
'</style>' + "\r\n"
)
assert H.count("</body>") == 1, "body 结束标签异常"
H = H.replace("</body>", STYLE + "</body>")
n_fix += 1
print("  OK  追加 <style id=\"cn-audit-fix\">")

# ============ P0-3: 切视图时收起诺诺气泡（包装 go，保留原函数） ============
SCRIPT = (
'<script id="cn-audit-js">' + "\r\n"
'/* v0.18.0：切换视图时收起诺诺气泡 —— 修「上一页的提示一直挂在新页面上」 */' + "\r\n"
'(function(){' + "\r\n"
'  try{' + "\r\n"
'    var _cnGo = window.go;' + "\r\n"
'    if (typeof _cnGo === "function"){' + "\r\n"
'      window.go = function(v){' + "\r\n"
'        try{ if (typeof nonoMin === "function") nonoMin(); }catch(e){}' + "\r\n"
'        return _cnGo.apply(this, arguments);' + "\r\n"
'      };' + "\r\n"
'    }' + "\r\n"
'  }catch(e){}' + "\r\n"
'})();' + "\r\n"
'</script>' + "\r\n"
)
H = H.replace("</body>", SCRIPT + "</body>")
n_fix += 1
print("  OK  追加 <script id=\"cn-audit-js\">")

# ============ 写盘（CRLF 归一化）============
data = re.sub(rb'(?<!\r)\n', b'\r\n', H.encode("utf-8"))
open(P, "wb").write(data)
print(f"\n改动 {n_fix} 处 | 裸 LF = {data.count(b(chr(10).encode())) - data.count(b(chr(13).encode()+chr(10).encode())) if False else 0}")
lone = data.count(b"\n") - data.count(b"\r\n")
print("裸 LF:", lone)
assert lone == 0, "CRLF 破坏"

# ============ 结构守卫 ============
H2 = data.decode("utf-8")
_static = re.sub(r'<script[\s\S]*?</script>', '<S/>', H2)
_static = re.sub(r'<style[\s\S]*?</style>', '<S/>', _static)
_leak = re.findall(r'u\{[0-9A-Fa-f]{4,6}\}', _static)
assert not _leak, f"P0-1 静态 HTML 仍有转义泄漏: {_leak}"
assert '<h2>\U0001F501 Smart review</h2>' in H2, "P0-1 未生效"
assert 'width:auto;padding:0 12px" title="Practise with Nono"' in H2, "P0-2 未生效"
assert "var names = fresh.map(function(id)" in H2, "P0-4 未生效"
for k in ['T(\'DAY {d} / {n}\')', 'T(\'See all {n} days →\')', 'T(\'{n} CITIES\')', 'T(\'{n} due\')', 'T(\'Day {d} · {s}\')']:
    assert k in H2, f"i18n 模板缺 {k}"
assert "city:'中国香港'" in H2 and "Hong Kong, China · Victoria Harbour" in H2, "P1-7 未生效"
assert 'id="cn-audit-fix"' in H2 and 'id="cn-audit-js"' in H2
assert H2.find('id="cn-audit-fix"') < H2.find("</body>")
assert H2.find('id="cn-audit-js"') < H2.find("</body>")
print("结构守卫全部通过")

# ============ JS 语法（分块 classic script 检查）============
import subprocess, tempfile
NODE = r"C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', H2, re.I)
allok = True
for n, s in enumerate(scripts, 1):
    f = os.path.join(APP, "_internal", f"_v18s{n}.js")
    open(f, "w", encoding="utf-8").write(s)
    r = subprocess.run([NODE, "--check", f], capture_output=True, text=True)
    if r.returncode: allok = False; print(f"  script#{n} 语法错误:", r.stderr[:200])
    os.remove(f)
print(f"JS 语法（{len(scripts)} 块）：", "全部通过" if allok else "有错误")
assert allok

# ============ i18n 字典补齐 ============
TR = {}
def add(k, v): TR[k] = v

CITY = {
 "Beijing": "北京", "Chengdu": "成都", "Guangzhou": "广州", "Shanghai": "上海",
 "Xi'an": "西安", "Hong Kong": "中国香港",
}
CITY_DESC = {
 "Famous sights and local food in Beijing. Tap a card, hear it, then say it 3 times.":
   "北京的名胜和地道小吃。点一张卡，听一遍，然后说三遍。",
 "Iconic waterfront and soup dumplings in Shanghai. Tap, listen, then say it 3 times.":
   "上海的标志性江景和小笼包。点开、听一遍，然后说三遍。",
 "West Lake views and vinegar fish in Hangzhou. Tap, listen, then say it 3 times.":
   "杭州的西湖景色和醋鱼。点开、听一遍，然后说三遍。",
 "Cliff-side night views and fiery hotpot in Chongqing. Tap, listen, then say it 3 times.":
   "重庆的崖边夜景和火辣火锅。点开、听一遍，然后说三遍。",
 "Giant pandas and numbing hotpot in Chengdu. Tap, listen, then say it 3 times.":
   "成都的大熊猫和麻辣火锅。点开、听一遍，然后说三遍。",
 "A famous pavilion and jar soup in Nanchang. Tap, listen, then say it 3 times.":
   "南昌的名楼和瓦罐汤。点开、听一遍，然后说三遍。",
 "River isle and stinky tofu in Changsha. Tap, listen, then say it 3 times.":
   "长沙的江心洲和臭豆腐。点开、听一遍，然后说三遍。",
 "Vast landscapes and lamb skewers in Xinjiang. Tap, listen, then say it 3 times.":
   "新疆的辽阔风景和羊肉串。点开、听一遍，然后说三遍。",
 "A modern skyline and beef hotpot in Shenzhen. Tap, listen, then say it 3 times.":
   "深圳的现代天际线和牛肉火锅。点开、听一遍，然后说三遍。",
 "The slender tower and dim sum in Guangzhou. Tap, listen, then say it 3 times.":
   "广州的细腰塔和早茶点心。点开、听一遍，然后说三遍。",
 "A car-free island and shacha noodles in Xiamen. Tap, listen, then say it 3 times.":
   "厦门的无车小岛和沙茶面。点开、听一遍，然后说三遍。",
 "Slow island life and chicken rice in Haikou. Tap, listen, then say it 3 times.":
   "海口的慢岛生活和鸡饭。点开、听一遍，然后说三遍。",
 "Sea bridges and fresh beer in Qingdao. Tap, listen, then say it 3 times.":
   "青岛的海湾大桥和鲜啤。点开、听一遍，然后说三遍。",
 "The Terracotta Army and roujiamo in Xi'an. Tap, listen, then say it 3 times.":
   "西安的兵马俑和肉夹馍。点开、听一遍，然后说三遍。",
 "Karst peaks and rice noodles in Guilin. Tap, listen, then say it 3 times.":
   "桂林的喀斯特山峰和米粉。点开、听一遍，然后说三遍。",
 "Misty quartz peaks and a local stew in Zhangjiajie. Tap, listen, then say it 3 times.":
   "张家界的云雾石峰和本地炖菜。点开、听一遍，然后说三遍。",
 "Erhai Lake and roasted rushan in Dali. Tap, listen, then say it 3 times.":
   "大理的洱海和烤乳扇。点开、听一遍，然后说三遍。",
 "Victoria Harbour and milk tea in Hong Kong, China. Tap, listen, then say it 3 times.":
   "中国香港的维多利亚港和奶茶。点开、听一遍，然后说三遍。",
}
DAY_TITLE = {
 "First words": "第一批话", "When you don't understand": "听不懂的时候",
 "Getting around": "出行问路", "Ordering food": "点菜吃饭",
 "Paying & small talk": "付钱搭话", "Emergency basics": "应急基础",
 "Emergency numbers": "应急电话", "Shopping": "买东西",
 "Numbers & money": "数字与钱", "Taxis & directions": "打车问路",
 "Hotel & a place to stay": "酒店住宿", "Small talk": "寒暄闲聊",
 "Keep it going": "把话接下去", "Out with friends": "和朋友出去",
 "At the Doctor": "看医生", "At the Bar": "在酒吧",
 "Apartment Hunting": "找房子", "Hair Salon": "理发店",
 "Bank Account": "银行开户", "Phone Repair": "修手机",
 "Birthday Party": "生日聚会", "High-Speed Rail": "坐高铁",
 "Parent-Teacher Meeting": "家长会", "At the Gym": "健身房",
 "Cultural Discussion": "聊文化", "Online Shopping Return": "网购退货",
 "Academic Lecture": "听讲座", "Business Negotiation": "商务谈判",
 "Deep Relationships": "亲密关系", "Final Challenge": "终极挑战",
}
DAY_DESC = {
 "Your first four lines. Say them out loud — that is the whole point.":
   "你的头四句话。大声说出来——这才是重点。",
 "Someone speaks too fast? These three lines save the conversation.":
   "对方说得太快？这三句话能救场。",
 "Prices, directions, and the most important question of all: where is the bathroom?":
   "价格、方向，还有最要紧的那个问题：洗手间在哪儿？",
 "Point, say “I want this one”, and eat well.": "指一下，说“我要这个”，好好吃一顿。",
 "Pay the bill, ask for water, and keep it going.": "结账、要水，把对话继续下去。",
 "The lines that matter when something goes wrong. Slow is fine — clear is better.":
   "出事时最管用的几句话。慢一点没关系，说清楚更重要。",
 "110 police · 119 fire · 120 ambulance — and how to say them so you get help fast.":
   "110 报警 · 119 火警 · 120 急救——以及怎么说才能最快得到帮助。",
 "Markets and malls: ask the price, try it on, pay by phone.":
   "逛市场、逛商场：问价、试穿、手机付款。",
 "Hear a price, say a number. This day saves you real money.":
   "听懂价格，说出数字。这一天替你省真金白银。",
 "Get in, say where, get out — and find your way when GPS dies.":
   "上车、说去哪儿、下车——导航失灵也能找对路。",
 "Check in, get the Wi-Fi, fix the AC. A roof with no drama.":
   "办入住、要 Wi-Fi、修空调。住下不折腾。",
 "Weather, food, weekend plans — the glue of every conversation.":
   "天气、吃的、周末安排——所有对话的黏合剂。",
 "Replies that keep a conversation alive: really? me too, no way!":
   "让对话活起来的回应：真的吗？我也是！不会吧！",
 "Dinners, drinks, invitations — the fun part of learning a language.":
   "吃饭、喝酒、约人——学语言最有意思的部分。",
 "Describe what hurts, understand the prescription.": "说清哪里疼，听懂怎么吃药。",
 "Order a drink, make small talk, learn to say no.": "点一杯、聊两句、学会说不。",
 "Describe what you need, ask about rent.": "说清你的需求，问明白房租。",
 "Communicate how you want your hair cut.": "说清你想怎么剪。",
 "Handle formal procedures with confidence.": "办业务不再发怵。",
 "Describe the problem, understand the timeline.": "说清故障，听懂工期。",
 "Receive wishes and express warm replies.": "接住祝福，回得暖心。",
 "Buy tickets and handle travel changes.": "买票、改签、退票都能应付。",
 "Talk about your child with the teacher.": "和老师聊孩子。",
 "Talk about fitness and find a buddy.": "聊健身，找到搭子。",
 "Share opinions and understand metaphors.": "说出观点，听懂比喻。",
 "Complain and negotiate a resolution.": "提异议，谈出解决办法。",
 "Ask questions and join the discussion.": "会提问，能参与讨论。",
 "Persuade, compromise, and close the deal.": "说服、让步、把事谈成。",
 "Express feelings and handle close moments.": "表达感受，应对亲密时刻。",
 "Free conversation — no script, just speak.": "自由对话——没有剧本，直接开口。",
}
MISC = {
 # 徽章
 "First speak": "首次开口", "Perfect tone": "声调满分", "Tone master": "声调大师",
 "First landmark": "首个地标", "All landmarks": "全部地标",
 "Reversal king": "反转之王", "In the wild": "实战应用", "All paths": "全部路线",
 "Graduate · Day 30": "毕业 · 第 30 天", "Survivor · Day 6": "幸存者 · 第 6 天",
 "collect them all": "全部收集",
 # 复习
 "Got it": "会了", "Missed it": "没会",
 "Random recall": "随机回忆", "Role reversal": "角色互换", "Speed run": "快速过",
 "Spaced repetition picks what you are about to forget. Three modes, three bars.":
   "间隔重复挑出你快忘掉的内容。三种模式，三条进度。",
 "Start": "开始", "Scenes": "场景",
 # 对话分类
 "Convenience Store": "便利店", "Ordering Food": "点餐",
 "Taking a Taxi": "打车", "First Meeting": "初次见面",
 "Introduce yourself the Chinese way: your name, where you are from, what you do, and that you are learning. Small talk that turns strangers into people who help you.":
   "用中国人的方式自我介绍：名字、来自哪里、做什么，还有你在学中文。这套寒暄能把陌生人变成愿意帮你的人。",
 # 卡片 / 句子 / 声调
 "Check": "检查", "Show answer": "看答案", "Reveal": "显示",
 "Listen to the sound. Which tone do you hear?": "听声音，判断是哪个声调？",
 # 天数页
 "LOCKED": "未解锁", "DONE": "已完成", "DAILY": "每日",
 "ALL DONE": "全部完成",
 "Day {d} · {s}": "第 {d} 天 · {s}", "✓ done": "✓ 已完成",
 "tap to practice": "点击开始练习", "See all {n} days →": "查看全部 {n} 天 →",
 "DAY {d} / {n}": "第 {d} 天 / 共 {n} 天",
 # 城市页
 "{n} CITIES": "{n} 个城市", "{n} due": "{n} 条待复习",
 # 引导页 / 首页
 "P0 · pinyin-first": "第 0 天 · 拼音优先", "P0 · travel first": "第 0 天 · 出行优先",
 "Daily real-life phrases, tone training, and blind-speak practice. 100 survival lines, a few minutes a day.":
   "真实生活短语、声调训练、盲说练习。100 句生存口语，每天几分钟。",
 # 场景页
 "Your first few survival lines: greeting, price, destination, restroom, thanks. Tap a card to reveal, play the sound, then cover and say it 3 times.":
   "你的头几句生存口语：打招呼、问价、说目的地、找洗手间、道谢。点卡片翻开，听一遍，然后遮住说三遍。",
 "your recording is used only to score that line. It is never saved, never shared, and never linked to you. Tap":
   "你的录音只用于给这一句打分。绝不保存、绝不分享、绝不与你的身份关联。点",
 "Privacy:": "隐私：",
 "Tap to reveal ·": "点开看答案 ·",
 "if too fast · cover & say it 3×": "太快了就点慢速 · 遮住说三遍",
 # 徽章/毕业气泡
 "New badge unlocked: <b>{n}</b> 🏅 — that is real progress.":
   "解锁新徽章：<b>{n}</b> 🏅——实实在在的进步。",
 "You finished all {n} days. 🎓 You can now answer people, not just memorise words.":
   "你走完了全部 {n} 天。🎓 现在你能接住别人的话，不只是背单词。",
 # 卡片计数器
 "Card {i} / {n}": "第 {i} / {n} 张",
}
for d in (CITY, CITY_DESC, MISC):
    TR.update(d)

# 用「渲染出来的确切标题」建键（含第 N 天）
DAY_ORDER = ["First words", "When you don't understand", "Getting around", "Ordering food",
 "Paying & small talk", "Emergency basics", "Emergency numbers", "Shopping", "Numbers & money",
 "Taxis & directions", "Hotel & a place to stay", "Small talk", "Keep it going", "Out with friends",
 "At the Doctor", "At the Bar", "Apartment Hunting", "Hair Salon", "Bank Account", "Phone Repair",
 "Birthday Party", "High-Speed Rail", "Parent-Teacher Meeting", "At the Gym", "Cultural Discussion",
 "Online Shopping Return", "Academic Lecture", "Business Negotiation", "Deep Relationships", "Final Challenge"]
for i, k in enumerate(DAY_ORDER, 1):
    pass
TR_DAYS = {f"Day {i} · {k}": f"第 {i} 天 · {DAY_TITLE[k]}" for i, k in enumerate(DAY_ORDER, 1)}
TR.update(TR_DAYS)
TR.update(DAY_DESC)

ZP = os.path.join(APP, "langs", "zh.json")
Z = json.load(open(ZP, encoding="utf-8"))
before = len(Z)
added, conflict = 0, []
for k, v in TR.items():
    if k not in Z:
        Z[k] = v; added += 1
    elif Z[k] != v:
        conflict.append(k)
json.dump(Z, open(ZP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"\nzh.json: {before} → {len(Z)}（新增 {added}）| 已存在但值不同: {len(conflict)}")
if conflict:
    for c in conflict[:8]: print("   冲突:", c)
