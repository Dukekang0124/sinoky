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

print("== 2. 下载线上真包到仓库外 ==")
tmp = os.path.join(APP, "_internal", "_tmp_apk"); os.makedirs(tmp, exist_ok=True)
dst = os.path.join(tmp, f"Sinoky-v{VER}-release.apk")
url = f"https://sinoky.pages.dev/apk/Sinoky-v{VER}-release.apk"
with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
                            timeout=600, context=ctx) as r, open(dst, "wb") as f:
    shutil.copyfileobj(r, f)
size = os.path.getsize(dst); h = hashlib.md5(open(dst, "rb").read()).hexdigest()
print(f"  下载 {size} bytes | md5={h}")
# 缺失资源时 CF 返回 200 + SPA 兜底 HTML ⇒ 必须先判 PK 魔数，否则「下载成功」是假的
with open(dst, "rb") as f:
    magic = f.read(4)
assert magic == b"PK\x03\x04", f"下载到的不是 APK/ZIP（首 4 字节 {magic!r}）⇒ 拿到的是兜底页"
assert size == want_size and h == want_md5, f"校验失败 size {size}/{want_size} md5 {h}/{want_md5}"
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
