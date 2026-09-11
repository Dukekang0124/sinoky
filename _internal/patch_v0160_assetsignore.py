# -*- coding: utf-8 -*-
"""v0.16.0 安全收口：把内部目录与后端源码从 Pages 静态资源里剔除
实测证据（生产环境探针）：
  /_internal/wait_apk.py   → 200 / 2005B / md5 5c0f02ba10   ← 真实文件，公开可下载
  /badge-backend.mjs       → 200 / 18529B / md5 fec895e631  ← 后端源码公开
  /verify-cards.cjs        → SPA 回退(450c290847)            ← 说明 .assetsignore 确实被采纳
  /package.json            → 200 / 740B / md5 79d462c4bb    ← 依赖清单也裸奔
双保险：
  ① .assetsignore 增列 → 后续部署的 asset manifest 里直接不含这些文件（治本）
  ② _redirects  增列 → 边缘 302 拒访（沿用仓库既有的 /www/* 手法，防旧部署残留仍被取到）
注意：/badge-backend.mjs 是 _worker.js 的**构建期静态 import**，由 CF 打包时按文件系统解析，
     不经过 HTTP → 加 302 不影响 /api/badges 运行时（部署后必须实测该接口确认）。
"""
import os, re

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)

def read(p):
    b = open(p, "rb").read()
    nl = "\r\n" if b.count(b"\r\n") > 0 else "\n"
    return b.decode("utf-8"), nl

def write(p, t, nl):
    if nl == "\r\n":
        t = t.replace("\r\n", "\n").replace("\n", "\r\n")
    open(p, "wb").write(t.encode("utf-8"))

# ---- ① .assetsignore ----
ai, nl1 = read(".assetsignore")
print("原 .assetsignore:\n" + ai)
assert "_internal" not in ai
add = []
for k in ["# v0.16.0：内部工作区（补丁脚本/设计方案/验收截图/日志）绝不上线",
          "_internal/", "badge-backend.mjs", "package.json", "package-lock.json"]:
    add.append(k)
ai = ai.rstrip("\r\n") + "\n" + "\n".join(add) + "\n"
write(".assetsignore", ai, nl1)
print("\n新 .assetsignore:\n" + open(".assetsignore", encoding="utf-8").read())

# ---- ② _redirects ----
rd, nl2 = read("_redirects")
assert "/_internal/*" not in rd
rd = rd.rstrip("\r\n") + """

# v0.16.0：/_internal/* 与后端源码此前随静态资源一起上线，公网可直接下载
# （实测 /_internal/wait_apk.py 200/2005B、/badge-backend.mjs 200/18529B）。
# .assetsignore 已把它们从后续部署的 manifest 剔除；此处再在边缘拒访，
# 与 /www/* 同一手法，防止旧部署残留仍被取到。
/_internal/*          /  302
/badge-backend.mjs    /  302
/package.json         /  302
/package-lock.json    /  302
"""
write("_redirects", rd, nl2)
print("\n新 _redirects:\n" + open("_redirects", encoding="utf-8").read())

# 复核
assert "_internal/" in open(".assetsignore", encoding="utf-8").read()
assert "/_internal/*" in open("_redirects", encoding="utf-8").read()
assert "/www/*" in open("_redirects", encoding="utf-8").read(), "原有规则被破坏"
print("收口完成（原有 /www/* 规则完好）")
