# -*- coding: utf-8 -*-
"""
v0.23.3 版本号同步（网页线）。
本次只是「网页层」改动（诺诺形象位的样式与交互），**不重出 APK** ⇒
  · index.html APP_VERSION / sw.js CACHE / version.json version 三处升级
  · version.json 的 apk 段落**保持 0.23.2**（那是已发布的 APK，双版本号互相独立）
  · download.html 的兜底 APK 链接**不动**（它指向 APK 版本，不是网页版本）

version.json 走**文本级**替换（json.dump 会重排缩进 + 把中文转义，产生整文件无意义 diff）。
定位方式：先用 json.loads 取出旧值，再用 json.dumps 生成「源文件里的字面形式」去精确替换，
避免手写正则猜字符串边界（note/noteEn 里可能含 \" 或 \\u 转义）。

三重闸门（v0.23.2 那轮被其中一道救过一次）：
  ① 每处替换命中数必须 == 1
  ② 行尾全 CRLF（写盘前断言）
  ③ 写盘前 json.loads 必须通过 —— 未转义的引号会让整份 JSON 非法，
     症状是线上读不出来（更新链路全断）而网页本体看起来完全正常，极难发现。

用法：python _setver-v0233.py   （幂等）
"""
import json as _json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))

OLD = "0.23.2"
NEW = "0.23.3"
UPDATED = "2026-09-13"

NOTE = ("v0.23.3：诺诺形象位升级（纯追加层，未新增任何素材、未新增预缓存项、未新增 KV 写）。"
        "① 浮标头像 40→50px，外接按钮 56px 一字未动（#nono-tip 的 right:74px 定位因此不受牵连），并加 idle 呼吸动效。"
        "② 面板头从 34px 圆形徽章改为 72px 半身立绘（取消圆形裁剪 + 底部渐隐遮罩），面板头高 55→93px，"
        "练习内容仍在首屏内 —— 关键收益是 8 张姿态图（like/cheer/think/sorry/listen/point/wave/note）"
        "第一次真正「看得见」：此前 34px 圆形裁剪下姿态切换用户根本分辨不出，等于资产被埋没。"
        "③ 点面板头像可展开全身（用已入库的 nono-splash.webp，560×820 真全身渲染，sw 预缓存早已收录），再点收回；"
        "状态一变（listen/think/speak）自动收回，不留中间态。"
        "④ 新增 S.feat.nono / S.feat.nonoFull 两个本地计数（复用 v0.3.36 功能级统计通道，只写 localStorage，零新增 KV 写）。"
        "⑤ 系统开启「减少动态效果」时动效全关（prefers-reduced-motion）。"
        "网页版 v0.23.3；APK 仍为 v0.23.2（本次只改网页层，无需重出包）。")

NOTE_EN = ("v0.23.3: Nono presence upgrade (pure append layer - no new assets, no new precache entries, no new KV writes). "
           "(1) The dock avatar grows from 40 to 50px while the 56px button frame stays untouched (so the #nono-tip "
           "right:74px offset is unaffected), plus an idle breathing animation. "
           "(2) The panel header changes from a 34px round badge to a 72px half-body portrait (circular crop removed, "
           "soft bottom fade); header height goes 55 to 93px and the practice line stays above the fold. The key win: "
           "all 8 pose images (like/cheer/think/sorry/listen/point/wave/note) become genuinely readable for the first "
           "time - at 34px with a circular crop the pose switching was effectively invisible, so the assets were wasted. "
           "(3) Tapping the portrait expands to a full-body view using the already-shipped nono-bear splash image "
           "(560x820 real full-body render, already in the service worker precache); tapping again collapses it, and any "
           "state change (listen/think/speak) collapses it automatically with no stuck state. "
           "(4) Two local counters, S.feat.nono and S.feat.nonoFull, reuse the existing v0.3.36 feature-stats path - "
           "localStorage only, zero extra KV writes. "
           "(5) All motion is disabled under prefers-reduced-motion. "
           "Web v0.23.3; APK stays v0.23.2 (web-layer change only, no repack needed).")

fails = []


def fail(m):
    fails.append(m)
    print("  ✗ %s" % m)


def dok(m):
    print("  ✓ %s" % m)


def rd_b(p):
    with open(p, "rb") as f:
        return f.read()


def wr_b(p, b):
    with open(p, "wb") as f:
        f.write(b)


def assert_crlf(b, name):
    bare = b.count(b"\n") - b.count(b"\r\n")
    if bare:
        fail("%s 含裸 LF %d 个" % (name, bare))
        return False
    return True


def sub_once(b, old, new, label):
    n = b.count(old)
    if n == 1:
        dok("%s：1 处命中" % label)
        return b.replace(old, new)
    if n == 0 and b.count(new) >= 1:
        dok("%s：已是目标值，跳过" % label)
        return b
    fail("%s：命中 %d 处（期望 1）" % (label, n))
    return b


# ---------------------------------------------------------------- 1. index.html
def step_index():
    p = os.path.join(APP, "index.html")
    b = rd_b(p)
    o = ("var APP_VERSION = '%s';" % OLD).encode()
    n = ("var APP_VERSION = '%s';" % NEW).encode()
    b2 = sub_once(b, o, n, "index.html APP_VERSION")
    assert_crlf(b2, "index.html")
    if b2 != b:
        wr_b(p, b2)
    return b2


# ---------------------------------------------------------------- 2. sw.js
def step_sw():
    p = os.path.join(APP, "sw.js")
    b = rd_b(p)
    o = ("var CACHE = 'sinoky-v%s';" % OLD).encode()
    n = ("var CACHE = 'sinoky-v%s';" % NEW).encode()
    b2 = sub_once(b, o, n, "sw.js CACHE")
    if b2 != b:
        wr_b(p, b2)
    return b2


# ---------------------------------------------------------------- 3. version.json
def step_version():
    p = os.path.join(APP, "version.json")
    raw = rd_b(p)
    assert_crlf(raw, "version.json(原)")
    txt = raw.decode("utf-8")

    try:
        obj = _json.loads(txt)
    except Exception as e:
        fail("version.json 原始内容就无法解析：%s" % e)
        return raw

    # 顶层 version（只改 2 空格缩进那处，apk.version 是 4 空格 ⇒ 用 json.dumps 的字面形式定位）
    old_ver_lit = '"version": "%s"' % OLD
    # ⚠️ 字符串 "version": "0.23.2" 在文件里出现两次（顶层 + apk 段），
    #    所以用行首缩进把顶层那处钉死：顶层 2 空格、apk 段 4 空格。
    pat = re.compile(r'^(  )("version": "%s")' % re.escape(OLD), re.M)
    hits = pat.findall(txt)
    if len(hits) == 1:
        txt = pat.sub(lambda m: m.group(1) + '"version": "%s"' % NEW, txt, count=1)
        dok("version.json 顶层 version：1 处命中")
    elif len(hits) == 0 and ('  "version": "%s"' % NEW) in txt:
        dok("version.json 顶层 version：已是目标值，跳过")
    else:
        fail("version.json 顶层 version 命中 %d 处" % len(hits))

    # updated
    o_up = '"updated": "%s"' % obj.get("updated", "")
    n_up = '"updated": "%s"' % UPDATED
    txt = sub_once(txt, o_up, n_up, "version.json updated")

    # note（用 json.dumps 生成源文件里的字面形式，避免手写正则猜边界）
    o_note = _json.dumps(obj.get("note", ""), ensure_ascii=False)
    n_note = _json.dumps(NOTE, ensure_ascii=False)
    txt = sub_once(txt, o_note, n_note, "version.json note")

    # noteEn[0]
    arr = obj.get("noteEn") or []
    if arr:
        o_en = _json.dumps(arr[0], ensure_ascii=False)
        n_en = _json.dumps(NOTE_EN, ensure_ascii=False)
        txt = sub_once(txt, o_en, n_en, "version.json noteEn[0]")
    else:
        fail("version.json 没有 noteEn 数组")

    out = txt.encode("utf-8")

    # ---- 闸门：行尾 / JSON 合法性 / apk 段未被误改 ----
    if not assert_crlf(out, "version.json(新)"):
        return raw
    try:
        j = _json.loads(out.decode("utf-8"))
    except Exception as e:
        fail("替换后 JSON 非法：%s" % e)
        return raw
    if j["apk"]["version"] != OLD:
        fail("apk 段被误改：%s（应保持 %s）" % (j["apk"]["version"], OLD))
        return raw
    if j["version"] != NEW:
        fail("顶层 version 不是 %s：%s" % (NEW, j["version"]))
        return raw
    dok("version.json：JSON 合法 · apk 段未被误改（仍 %s）· 行尾全 CRLF" % OLD)

    if out != raw:
        wr_b(p, out)
    return out


# ---------------------------------------------------------------- 4. verify 脚本
def step_verify():
    p = os.path.join(HERE, "verify-nono-ip.py")
    b = rd_b(p)
    o = ('EXPECT_VER = "%s"' % OLD).encode()
    n = ('EXPECT_VER = "%s"' % NEW).encode()
    b2 = sub_once(b, o, n, "verify-nono-ip.py EXPECT_VER")
    if b2 != b:
        wr_b(p, b2)
    return b2


if __name__ == "__main__":
    print("=== v0.23.3 版本号同步（网页线）===")
    step_index()
    step_sw()
    step_version()
    step_verify()
    print()
    if fails:
        print("✗ 有 %d 项失败，已中止（未写盘的部分保持原样）" % len(fails))
        sys.exit(1)
    print("✓ 全部通过")
