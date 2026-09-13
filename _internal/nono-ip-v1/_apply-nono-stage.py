# -*- coding: utf-8 -*-
"""
v0.23.3 诺诺形象位 —— 把 patch.{css,js} 重新注入 index.html 的注入块。

为什么不直接跑 apply-nono-ip.py：
  它的 NEW_VER/OLD_VER 常量停在 0.23.1/0.23.0，当前 index.html 已是 0.23.2，
  step_index() 的 [1b] 分支会断言失败（既不是旧版也不是新版）。
  本脚本只做「替换注入块」这一件事，不碰版本号，其余断言全部照搬。

幂等：跑几次结果一样（块内容 = patch 文件内容本身）。
用法：python _apply-nono-stage.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))
PATCH_CSS = os.path.join(HERE, "patch.css")
PATCH_JS = os.path.join(HERE, "patch.js")
INDEX = os.path.join(APP, "index.html")

CSS_ID = b'id="nono-ip-v1-css"'
JS_ID = b'id="nono-ip-v1-js"'
MARK = b"<!-- ===== v0.22.0 Nono IP"
ANCHOR = b"</body>"

log = []


def p(*a):
    m = " ".join(str(x) for x in a)
    log.append(m)
    print(m)


def rd(path):
    with open(path, "rb") as f:
        return f.read()


def wr(path, data):
    with open(path, "wb") as f:
        f.write(data)


def to_crlf(b):
    return b.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")


def assert_no_bare_lf(b, name):
    assert b.count(b"\n") == b.count(b"\r\n"), "%s 含裸 LF（%d LF / %d CRLF）" % (
        name, b.count(b"\n"), b.count(b"\r\n"))


def main():
    b = rd(INDEX)
    orig_len = len(b)

    assert b.count(ANCHOR) == 1, "</body> 不唯一"
    assert_no_bare_lf(b, "index.html(原)")

    css = to_crlf(rd(PATCH_CSS))
    js = to_crlf(rd(PATCH_JS))

    # 标签字面量守卫：块内出现 </style / </script 会提前闭合；
    # 出现 <style / <script 会让「自己是最后一个」的位置断言失效。
    for name, blob in (("patch.css", css), ("patch.js", js)):
        for bad in (b"</style", b"</script", b"<style", b"<script"):
            assert bad not in blob, "%s 含标签字面量 %r" % (name, bad)

    # ⚠️ 块首**不带**前导 \r\n：b.rindex(MARK) 定位到 "<!--" 本身、不含它前面的换行，
    #    若块自带前导 \r\n 且它已存在，每跑一次就多一个空行（+2 B，非幂等）。
    #    apply-nono-ip.py 早期版本正是这样写的，本次一并修正。
    blk = (b"<!-- ===== v0.22.0 Nono IP \xe6\x8e\xa5\xe5\x85\xa5\xe5\xb1\x82"
           b"\xef\xbc\x88\xe7\xba\xaf\xe8\xbf\xbd\xe5\x8a\xa0\xef\xbc\x89"
           b" ===== -->\r\n"
           b'<style ' + CSS_ID + b">\r\n" + css + b"\r\n</style>\r\n"
           b'<script ' + JS_ID + b">\r\n" + js + b"\r\n</script>\r\n")

    i = b.rindex(ANCHOR)
    assert MARK in b, "找不到注入块标记 —— 这个仓库的 index.html 还没注入过？"
    s = b.rindex(MARK)
    assert s < i, "注入块标记出现在 </body> 之后，文件结构异常"
    old = b[s:i]
    assert b"</script>" in old and b"</style>" in old, "旧块不完整"
    b = b[:s] + blk + b[i:]
    p("[1] 替换注入块：旧 %d B → 新 %d B（css %d + js %d）" % (len(old), len(blk), len(css), len(js)))

    # --- 断言：块尾到文件末只剩收尾标签，且自己是最后一个 style/script ---
    tail = b[b.rindex(ANCHOR):]
    assert tail == b"</body>\r\n</html>\r\n", "块后有多余内容：%r" % tail[:80]
    assert b.count(CSS_ID) == 1 and b.count(JS_ID) == 1, "注入块重复"
    assert b.index(CSS_ID) < b.index(JS_ID) < b.rindex(ANCHOR), "注入块顺序异常"
    assert_no_bare_lf(b, "index.html(新)")

    # --- 断言：新块内容 == patch 源文件（防「改了源码忘了注入」） ---
    # ⚠️ 必须从注入块起点往后找闭合标签：index.html 前面还有别的 style/script 块，
    #    无起点的 b.index(b"</style>") 会命中文件前部那个（本轮踩过，断言当场拦下）。
    css_start = b.index(b'<style ' + CSS_ID)
    css_end = b.index(b"</style>", css_start)
    seg_css = b[css_start + len(b'<style ' + CSS_ID) + 1: css_end]

    js_start = b.index(b'<script ' + JS_ID)
    js_end = b.index(b"</script>", js_start)
    seg_js = b[js_start + len(b'<script ' + JS_ID) + 1: js_end]

    assert seg_css.strip(b"\r\n") == css.strip(b"\r\n"), "注入块 CSS 与 patch.css 不一致（%d vs %d）" % (
        len(seg_css.strip(b"\r\n")), len(css.strip(b"\r\n")))
    assert seg_js.strip(b"\r\n") == js.strip(b"\r\n"), "注入块 JS 与 patch.js 不一致（%d vs %d）" % (
        len(seg_js.strip(b"\r\n")), len(js.strip(b"\r\n")))
    p("[2] ✓ 注入块 == patch 源文件（CSS %d B / JS %d B，逐字节）" % (len(css), len(js)))

    wr(INDEX, b)
    p("[3] index.html %d → %d B（+%d）" % (orig_len, len(b), len(b) - orig_len))
    p("    ✓ 断言全过：patch 是最后一个 style/script；无裸 LF；块后只剩收尾标签")


if __name__ == "__main__":
    main()
