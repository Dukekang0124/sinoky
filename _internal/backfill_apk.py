# -*- coding: utf-8 -*-
"""通用 APK 回填：拉 CI 元数据 → 下载线上真包到仓库外 → 双校验 → 换包 → 提交推送"""
import hashlib, json, os, shutil, ssl, subprocess, urllib.request

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE


def git(*a, check=True):
    r = subprocess.run(["git", "-C", APP] + list(a), capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    print(f"  $ git {' '.join(a)} -> {out[:300]}")
    if check and r.returncode != 0:
        raise SystemExit("git failed: " + " ".join(a))
    return out


print("== 1. 拉 CI 元数据 ==")
# ⚠️ 两个本仓库特有的坑，缺一个就会假失败：
#   ① 本机 refs/remotes/origin/* 的写入会被静默丢弃 ⇒ 不用 `git pull --ff-only origin main`，
#      远端状态只信 ls-remote 给的 sha。
#   ② 这是**浅克隆**：CI 刚推上来的 commit 对象本地根本没有 ⇒ 直接
#      `git merge --ff-only <sha>` 会报 "not something we can merge"（假故障，看着像远端坏了）。
#      必须先用 `git fetch origin main` 把对象取回来，再 ff 到 FETCH_HEAD。
git("fetch", "origin", "main", check=False)
remote_sha = git("ls-remote", "origin", "refs/heads/main").split()[0]
local_head = git("rev-parse", "HEAD").split()[0]
if local_head != remote_sha:
    git("merge", "--ff-only", "FETCH_HEAD")
    local_head = git("rev-parse", "HEAD").split()[0]
    assert local_head == remote_sha, "ff 未生效：本地 %s / 远端 %s" % (local_head[:7], remote_sha[:7])
meta = json.load(open(os.path.join(APP, "version.json"), encoding="utf-8"))
VER, want_md5, want_size = meta["version"], meta["apk"]["md5"], meta["apk"]["size"]
assert want_md5 and want_size > 1_000_000, "CI 尚未回写 md5/size"
assert meta["apk"]["version"] == VER, "apk 段仍是旧版（%s）⇒ CI 回写没同步到本地" % meta["apk"]["version"]
print(f"  v{VER} md5={want_md5} size={want_size}（本地已同步到远端 {local_head[:7]}）")

print("== 2. 下载真包到仓库外（多源回退） ==")
# 🔴🔴 为什么必须多源（v0.23.11 实证，这是本仓库的结构性常态而非异常）：
#   两个 workflow 抢同一个 production 别名 ——
#     · `deploy-to-cloudflare-pages.yml`（push main / workflow_dispatch）部署**仓库根**，含 main 的 `apk/`；
#     · `apk.yml`（push tag）用 wrangler 部署 **`www/`**，含 CI 刚签名的那只新包。
#   谁最后完成谁生效。**只要根目录部署晚于 tag 出包**（回填前必然如此），线上 `/apk/` 就只有旧包，
#   新包 URL 会落回 SPA 兜底页（CF 对已删资源仍缓存 7 天，更是雪上加霜）。
#   ⇒ 「线上取不到新包」不是远端坏了，是设计使然。CI 另有**两份等价产物**可取，
#     都带同样的 md5/size 登记，取哪份都不影响下面的三重校验：
#       · GitHub Release（softprops/action-gh-release 上传，最稳、HTTP 可续传）
#       · `dist` 分支（git 协议可达副本；实测 24MB 走 git 很慢，故排在 Release 之后）
#   ⚠️ 兜底不等于降低标准：三重校验（PK 魔数 + md5 + size）对每一源都跑，
#      且「线上 URL 最终真的能下载到」由收尾的 `verify-live.mjs` B 段负责（回填 → 部署后必跑）。
NAME = f"Sinoky-v{VER}-release.apk"
tmp = os.path.join(APP, "_internal", "_tmp_apk"); os.makedirs(tmp, exist_ok=True)
dst = os.path.join(tmp, NAME)
#   ⚠️ 本沙箱到 github 只有 ~23 KB/s（24 MB 约 18 分钟，超过任何单次请求超时）⇒ **本地缓存优先**，
#      中途断掉可用 `curl -L -C - -o <dst> <Release URL>` 续传补全，再跑本脚本即可复用。
# 顺序即优先级：本地缓存(已校验) → Pages(证明真在线) → Release → dist。
SOURCES = [
    ("本地缓存", dst),                       # 非 http ⇒ 直接复用已下好的临时文件
    ("Pages 线上", f"https://sinoky.pages.dev/apk/{NAME}"),
    ("GitHub Release", f"https://github.com/Dukekang0124/sinoky/releases/download/v{VER}/{NAME}"),
    ("dist 分支", f"https://raw.githubusercontent.com/Dukekang0124/sinoky/dist/{NAME}"),
]
tried = []
for label, url in SOURCES:
    if url.startswith("http"):
        if os.path.exists(dst):
            os.remove(dst)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
                                        timeout=900, context=ctx) as r, open(dst, "wb") as f:
                shutil.copyfileobj(r, f)
        except Exception as e:
            tried.append(f"{label}: 下载异常 {type(e).__name__}")
            print(f"  ✗ {label} 下载失败（{type(e).__name__}）")
            continue
    elif not os.path.exists(dst):
        tried.append(f"{label}: 无缓存文件")
        print("  ✗ 本地缓存不存在")
        continue
    size = os.path.getsize(dst)
    with open(dst, "rb") as f:
        magic = f.read(4)
    h = hashlib.md5(open(dst, "rb").read()).hexdigest()
    tag = label if url.startswith("http") else label + "（已存于临时目录，跳过重复下载）"
    # 缺失资源时 CF 返回 200 + SPA 兜底 HTML ⇒ 必须判 PK 魔数，否则「下载成功」是假的
    if magic != b"PK\x03\x04":
        tried.append(f"{label}: 首 4 字节 {magic!r}（兜底页或残缺，非 APK）")
        print(f"  ✗ {label} 不是 APK（首 4 字节 {magic!r}）")
        continue
    if size != want_size or h != want_md5:
        tried.append(f"{label}: size {size}/{want_size} md5 {h[:8]}/{want_md5[:8]}")
        print(f"  ✗ {label} 校验不符（size {size}/{want_size} md5 {h[:8]}…）")
        continue
    print(f"  ✓ {tag} → 真包 {size} bytes | md5={h}")
    break
else:
    raise SystemExit("所有来源都取不到 v%s 的真包：\n    - %s" % (VER, "\n    - ".join(tried)))
print("  ✓ PK 魔数 + md5 + size 三重校验通过")

print("== 3. 换包（先放新包并纳入索引，再删旧包） ==")
# 🔴 顺序铁律：`git rm apk/<旧包>` 会把整个 apk/ 目录剪掉；如果新包此刻还没进索引，会一起没。
#    所以：① 放新包 → ② git add（受保护）→ ③ 再动旧包（只改索引 + 单独删文件）。
apkdir = os.path.join(APP, "apk")
os.makedirs(apkdir, exist_ok=True)
new_name = f"Sinoky-v{VER}-release.apk"
old = [f for f in os.listdir(apkdir) if f.endswith(".apk") and f != new_name]
shutil.move(dst, os.path.join(apkdir, new_name))
git("add", f"apk/{new_name}")                      # ① 先进索引
for f in old:                                       # ② 再处理旧包
    git("rm", "--cached", "-q", f"apk/{f}", check=False)
    try:
        os.remove(os.path.join(apkdir, f))
    except OSError:
        pass
print("  apk/ 内容:", os.listdir(apkdir))

print("== 4. 提交推送 ==")
git("add", "apk"); git("add", "-u", "apk")
git("status", "--short")
git("commit", "-m", f"v{VER}: 回填 CI 构建的 APK 到 apk/（仅保留最新版），md5 与线上一致防部署覆盖")
git("push", "origin", "main")
print("  HEAD:", git("rev-parse", "--short", "HEAD"))
print("  remote:", git("ls-remote", "origin", "refs/heads/main"))
shutil.rmtree(tmp, ignore_errors=True)
print("DONE")
