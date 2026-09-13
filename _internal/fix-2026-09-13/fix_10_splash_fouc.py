# -*- coding: utf-8 -*-
"""v0.23.12 修复：把「启动屏」段的两处 #splash 规则合并到 <head> 内的主样式块。
根因：开屏 div 在 1138 行，而定义它的第二份样式的 cn-modules 块在 6502+ 行 ⇒ 规则晚于元素，
首帧 `.sp-brand` 按默认 display:block 渲染 ⇒ 字标闪现（限速实测 5.7s，其中 4.9s 与满版图并存）。"""
import io, os, sys

P = r"index.html"
s = io.open(P, encoding="utf-8").read()
n0 = len(s.encode("utf-8"))

def rep(old, new, times, tag):
    n = s.count(old)
    assert n == times, "%s: expect %d got %d" % (tag, times, n)
    return s.replace(old, new)

OLD_A = """   注意两处 #splash 规则（此处 + 后面「启动屏」段）必须同步 —— 只改一处会留下旧值静默回流。 */
#splash{position:fixed;inset:0;z-index:9999;background:#0E3739;display:flex;align-items:center;justify-content:center;transition:opacity .45s ease}
#splash.hide{opacity:0;pointer-events:none}
#splash img{width:auto;height:100%;max-width:100%;object-fit:contain;border-radius:0}
"""

NEW_A = """   🔴 v0.23.12：启动屏规则**只此一处**（原「启动屏」段的第二份已合并到这里）。
   为什么必须合并：开屏 div 在 1138 行，而那份样式块在 6502+ 行 ⇒ **规则晚于元素**，
   首帧按默认值渲染 —— `.sp-brand` 没有被 `display:none` 顶掉，就直接显示出来了。
   实测（CDP 限速 60KB/s）：字标闪现 **5.7s**，其中 **4.9s 是「满版开屏图 + CSS 字标」两套字标并存**，
   与 v0.23.11「CSS 字标退役为降级态」的设计意图正好相反。
   顺带消除同一段里 `#splash` 底色的首帧跳变（v0.23.10 起是 var(--bg) → #17423D）。
   ⇒ 首屏元素的样式必须写在元素之前；规则只留一处，也再没有「两处必须同步」的隐患。 */
#splash{position:fixed;inset:0;z-index:9999;background:#0E3739;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:0;transition:opacity .45s ease}
#splash.hide{opacity:0;pointer-events:none}
#splash img{width:auto;height:100%;max-width:100%;object-fit:contain;border-radius:0}
#splash .sp-brand{display:none;font-family:"Songti SC","STSong","Noto Serif SC","SimSun",serif;font-size:30px;font-weight:800;letter-spacing:.6px;color:#F5F1E8;line-height:1}
#splash .sp-brand b{color:var(--red);font-weight:800}
/* 降级：开屏图加载失败（首访慢网 / 离线未预热）时退回 CSS 字标 + 深青底，不留白屏 */
#splash.sp-fallback .sp-brand{display:block}
#splash.sp-fallback img{display:none}
"""

OLD_B = """/* 启动屏：v0.23.11 起主视觉 = 满版开屏图（a8_9x16.webp）整屏，CSS 字标退役为降级态。
   底色必须与图内底色一致（#0E3739），否则 contain 补色处出现横向色带。 */
#splash{background:#0E3739;flex-direction:column;gap:0}
#splash img{width:auto;height:100%;max-width:100%;object-fit:contain;border-radius:0}
#splash .sp-brand{display:none;font-family:"Songti SC","STSong","Noto Serif SC","SimSun",serif;font-size:30px;font-weight:800;letter-spacing:.6px;color:#F5F1E8;line-height:1}
#splash .sp-brand b{color:var(--red);font-weight:800}
/* 降级：开屏图加载失败（首访慢网 / 离线未预热）时退回 CSS 字标 + 深青底，不留白屏 */
#splash.sp-fallback .sp-brand{display:block}
#splash.sp-fallback img{display:none}
"""

NEW_B = """/* v0.23.12：启动屏规则**已全部上移到 <head> 内的主样式块**（首屏元素样式必须早于元素）。
   此处不再重复定义 —— 重复就是「规则晚于元素」的闪烁源，且两处极易失同步。
   完整说明与实测数据见 <head> 内「v0.10.0：A8 开屏 splash」那一段注释。 */
"""

s = rep(OLD_A, NEW_A, 1, "A 主样式块")
s = rep(OLD_B, NEW_B, 1, "B 启动屏段")

# 回读校验
assert s.count("#splash .sp-brand{display:none") == 1, "sp-brand 规则应只剩一份"
assert s.count("#splash.sp-fallback img{display:none}") == 1
assert s.count("#splash img{width:auto;height:100%") == 1
assert s.count("#splash{position:fixed;inset:0") == 1
# 规则必须在元素之前
assert s.index("#splash .sp-brand{display:none") < s.index('<div id="splash">'), "规则仍在元素之后！"
assert "flex-direction:column;gap:0;transition:opacity" in s

b = s.encode("utf-8")            # 先验编码（异常在此抛出，文件未动）
assert len(b) > n0, "字节数应增加"
io.open(P, "wb").write(b)
print("OK  规则位置 %d < 元素位置 %d | 字节 %d → %d" % (
    s.index("#splash .sp-brand{display:none"), s.index('<div id="splash">'), n0, os.path.getsize(P)))
