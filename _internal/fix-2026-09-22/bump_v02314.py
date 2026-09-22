#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bump_v02314.py — 网页线发版 (web-only) 0.23.13 -> 0.23.14
幂等：若三处版本号已是目标版本，则报告「未写盘」并退出 0。
仅改动网页资产（index.html / sw.js / version.json），不动 apk 段（APK 沿用 0.23.13）。
"""
import json, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET = "0.23.14"

def rb(p):
    with open(os.path.join(ROOT, p), "r", encoding="utf-8") as f:
        return f.read()

def wb(p, s):
    with open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="") as f:
        f.write(s)

def repl_once(tag, src, old, new, expect=1):
    n_old = src.count(old)
    if n_old == 0:
        # 已是目标（可能已被替换过）-> 幂等跳过
        if src.count(new) >= 1:
            print(f"  [skip:{tag}] 已是目标 ({new!r})")
            return src
        sys.exit(f"ABORT [{tag}] 找不到 old={old!r} 且未命中 new")
    if n_old != expect:
        sys.exit(f"ABORT [{tag}] old count={n_old} expect={expect}")
    print(f"  [ok:{tag}] {old!r} -> {new!r}")
    return src.replace(old, new, expect)

# 1) index.html
print("index.html:")
ih = rb("index.html")
ih = repl_once("APP_VERSION", ih, "var APP_VERSION = '0.23.13';", "var APP_VERSION = '0.23.14';")
wb("index.html", ih)

# 2) sw.js
print("sw.js:")
sw = rb("sw.js")
sw = repl_once("CACHE", sw, "var CACHE = 'sinoky-v0.23.13';", "var CACHE = 'sinoky-v0.23.14';")
wb("sw.js", sw)

# 3) version.json
print("version.json:")
vj = rb("version.json")
v = json.loads(vj)

NOTE_ZH = ("v0.23.14：i18n 全中文缺口修复（仅网页发布）。v0.23.13 及更早版本中，限流墙、"
           "接一句弹窗、额度卡片、练习入口按钮、诺诺边角提示、打分/听写报错等大量面向用户的文案仍硬编码中文，"
           "非中文语种（西/俄/越/印尼/泰）界面会显示中文（截图证据：接一句弹窗全中文）。"
           "本次统一补 T() 包裹并新增 75 个字典键（6 语言对齐），另修复 3 处纯中文指令提示（探索/天数/对话）。"
           "APK 沿用 0.23.13，App 用户经 Service Worker 更新字典后自动生效。")

NOTE_EN = ("v0.23.14: i18n hardcoded-Chinese gap fix (web-only release). In v0.23.13 and earlier, many "
           "user-facing strings were hardcoded in Chinese - the quota/limit wall, the 'add-one-sentence' modal, "
           "the quota card, the practice-entry button, Nono's corner hints, and the score/dictation error messages - "
           "so any non-Chinese UI (Spanish/Russian/Vietnamese/Indonesian/Thai) still showed Chinese "
           "(screenshot evidence: a fully-Chinese modal). This release wraps those strings in T() and adds 75 new "
           "dictionary keys (aligned across all 6 languages), plus fixes 3 purely-Chinese instruction hints "
           "(explore/days/dialog). The APK stays on 0.23.13; App users get the new dictionaries automatically via "
           "the Service Worker update.")

if v.get("version") == TARGET:
    print(f"  [skip:version] 已是 {TARGET}")
else:
    v["version"] = TARGET
    v["updated"] = "2026-09-22"
    v["note"] = NOTE_ZH
    print(f"  [ok:version] -> {TARGET}")

ne = v.get("noteEn", [])
if ne and ne[0].startswith(f"v{TARGET}:"):
    print(f"  [skip:noteEn] 头部已是 {TARGET}")
else:
    v["noteEn"] = [NOTE_EN] + ne
    print(f"  [ok:noteEn] 预置 {TARGET} 条目")

# apk 段保持不变（沿用 0.23.13）
vj_new = json.dumps(v, ensure_ascii=False, indent=2) + "\n"
wb("version.json", vj_new)

print("bump done. TARGET =", TARGET)
