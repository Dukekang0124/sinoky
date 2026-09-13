# -*- coding: utf-8 -*-
"""v0.23.4 版本号同步（网页线 + APK 线一起走）。

本次既要发网页线、也要出 APK（康哥要真机验证「诺诺记得你」）⇒ 四处版本号都要动：
  · index.html APP_VERSION / sw.js CACHE / version.json 顶层 version → 0.23.4
  · download.html 两处兜底 APK 链接 → v0.23.4
  · version.json 的 apk 段**暂不动**（仍 0.23.3）—— 由 tag CI 出包后回写真实
    versionCode/md5/size，届时再按 SOP §5 回填并提交

version.json 走**文本级**替换（json.dump 会重排缩进 + 把中文转义，产生整文件无意义 diff）。
定位方式：先用 json.loads 取出旧值，再用 json.dumps 生成「源文件里的字面形式」去精确替换，
避免手写正则猜字符串边界（note/noteEn 里可能含 \" 或 \\u 转义）。

三重闸门（v0.23.2 那轮被其中一道救过一次）：
  ① 每处替换命中数必须 == 1（download.html 例外：固定 2 处）
  ② 行尾全 CRLF（写盘前断言）
  ③ 写盘前 json.loads 必须通过 —— 未转义的引号会让整份 JSON 非法，
     症状是线上读不出来（更新链路全断）而网页本体看起来完全正常，极难发现。

用法：python _setver-v0234.py   （幂等）
"""
import json as _json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))

OLD = "0.23.3"
NEW = "0.23.4"
UPDATED = "2026-09-13"

NOTE = ("v0.23.4：「诺诺记得你」—— 把早就存着、却从没说过的话说出来（纯追加层，零新增素材、零新增预缓存、零新增 KV 写）。"
        "产品从 v0.7.0 起就一直在记录 S.nono（判分次数 / 历史最高分 / 最近一次哪句几分 / 易错句计数），"
        "但没有任何一处把它读给用户听 —— 你练了 20 次、某句卡了 4 遍、最高拿过 92 分，诺诺一个字都没提过，"
        "它一直是「每次重置的 NPC」而不是「记得你的对象」。"
        "① 现在首页（每天一次）由诺诺说出具体记忆：「你上次开口是 3 天前 —— 接着上次的继续」"
        "「昨天这句 78 分。今天能超过它吗」「这句你已经卡了 4 次 —— 今天把它拿下」，"
        "并给「练这一句」按钮直接跳回那句，形成闭环。"
        "② 挑句优先取易错句（weak 计数最高者），其次最近练的那句；今天刚练过不说，超过 60 天按新用户处理。"
        "③ 复用既有「每日一句」的时机与配额（不自建触发、不多占一次气泡），并在冷启动补一次，"
        "覆盖「打开 App 就停在首页」这条不经过 go() 的路径。"
        "④ 新增 S.feat.nonoRecall 本地计数（复用 v0.3.36 功能级统计通道，只写 localStorage）。"
        "⑤ 新增 5 条文案 × 6 语言入 langs/*.json（零英文 fallback 验收线不动）；"
        "顺带清理这 6 个语言文件里 573 处既有的行尾 CR 污染（词条经 dict 全等比对，零改动）。"
        "网页版与 APK 均为 v0.23.4。")

NOTE_EN = ("v0.23.4: \"Nono remembers you\" - say the things we already store but never spoke (pure append layer; "
           "no new assets, no new precache entries, no new KV writes). "
           "The app has recorded S.nono since v0.7.0 (grading count, all-time best, the most recent line and its "
           "score, per-line mistake counts), yet nothing ever read it back to the user - you could practice 20 times, "
           "trip over one line 4 times and hit 92 once, and Nono would never mention it. It stayed a "
           "reset-every-time NPC instead of someone who remembers you. "
           "(1) Now on Home, once a day, Nono says the specific thing it remembers: \"You last spoke Chinese 3 days "
           "ago - let's pick up where you stopped\", \"Yesterday this line scored 78. Beat it today?\", \"This line has "
           "tripped you up 4 times - today we crack it\", with a \"Practice that line\" button that jumps straight back "
           "to it, closing the loop. "
           "(2) It picks your most-missed line first (highest weak count), then the line you practiced last; it stays "
           "quiet if you already practiced today, and treats a gap over 60 days as a fresh start. "
           "(3) It reuses the timing and quota of the existing daily line (no new trigger, no extra bubble) and also "
           "tries once on cold start, to cover the common path of opening the app and staying on Home without going "
           "through go(). "
           "(4) A new local counter, S.feat.nonoRecall, reuses the v0.3.36 feature-stats channel - localStorage only. "
           "(5) Five new strings in 6 languages added to langs/*.json (the zero-English-fallback line is untouched), "
           "along with a cleanup of 573 pre-existing stray-CR line endings across those six files "
           "(word entries proven identical by dict comparison). "
           "Web and APK are both v0.23.4.")

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

    # 顶层 version（只改 2 空格缩进那处，apk.version 是 4 空格 ⇒ 用行首缩进钉死）
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
        fail("apk 段被误改：%s（应保持 %s，等 CI 回写）" % (j["apk"]["version"], OLD))
        return raw
    if j["version"] != NEW:
        fail("顶层 version 不是 %s：%s" % (NEW, j["version"]))
        return raw
    dok("version.json：JSON 合法 · apk 段未被误改（仍 %s）· 行尾全 CRLF" % OLD)

    if out != raw:
        wr_b(p, out)
    return out


# ---------------------------------------------------------------- 4. download.html
def step_download():
    """两处兜底 APK 链接。正常路径读 version.json 的 apk.url，这两处只在取不到时兜底 ——
    但正是「静态检查与肉眼都易放过」的地方（SOP 里点了名），必须一起改。"""
    p = os.path.join(APP, "download.html")
    b = rd_b(p)
    o = ("Sinoky-v%s-release.apk" % OLD).encode()
    n = ("Sinoky-v%s-release.apk" % NEW).encode()
    c_old, c_new = b.count(o), b.count(n)
    if c_old == 2:
        dok("download.html 兜底 APK 链接：2 处命中")
        b2 = b.replace(o, n)
    elif c_old == 0 and c_new == 2:
        dok("download.html 兜底 APK 链接：已是目标值，跳过")
        return b
    else:
        fail("download.html 兜底链接命中 %d 处（期望 2；新值已有 %d 处）" % (c_old, c_new))
        return b
    assert_crlf(b2, "download.html")
    if b2 != b:
        wr_b(p, b2)
    return b2


# ---------------------------------------------------------------- 5. verify 脚本
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
    print("=== v0.23.4 版本号同步（网页线 + APK 线）===")
    step_index()
    step_sw()
    step_version()
    step_download()
    step_verify()
    print()
    if fails:
        print("✗ 有 %d 项失败，已中止（未写盘的部分保持原样）" % len(fails))
        sys.exit(1)
    print("✓ 全部通过")
