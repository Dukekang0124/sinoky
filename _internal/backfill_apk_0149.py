# -*- coding: utf-8 -*-
"""v0.14.9 APK 回填：拉 CI 元数据 → 下载线上真包到仓库外 → 校验 md5 → 换包 → 提交推送"""
import hashlib, json, os, shutil, ssl, subprocess, time, urllib.request

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
TMP = os.path.join(APP, "_internal", "_tmp_apk")
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE


def git(*a, check=True):
    r = subprocess.run(["git", "-C", APP] + list(a), capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    print(f"  $ git {' '.join(a)}\n    {out[:400]}")
    if check and r.returncode != 0:
        raise SystemExit("git failed: " + " ".join(a))
    return out


print("== 1. 拉取 CI 元数据 ==")
git("pull", "--ff-only", "origin", "main")
meta = json.load(open(os.path.join(APP, "version.json"), encoding="utf-8"))
want_md5, want_size = meta["apk"]["md5"], meta["apk"]["size"]
print(f"  期望 md5={want_md5} size={want_size}")
assert want_md5 and want_size > 1_000_000, "CI 尚未回写 md5/size"

print("== 2. 下载线上真包到仓库外 ==")
os.makedirs(TMP, exist_ok=True)
dst = os.path.join(TMP, "Sinoky-v0.14.9-release.apk")
url = "https://sinoky.pages.dev/apk/Sinoky-v0.14.9-release.apk"
with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
                            timeout=600, context=ctx) as r, open(dst, "wb") as f:
    shutil.copyfileobj(r, f)
size = os.path.getsize(dst)
h = hashlib.md5(open(dst, "rb").read()).hexdigest()
print(f"  下载 {size} bytes | md5={h}")
assert size == want_size, f"size mismatch {size} != {want_size}"
assert h == want_md5, f"md5 mismatch {h} != {want_md5}"
print("  ✓ md5 + size 双校验通过")

print("== 3. 换包（先删旧、再放新，避开 git rm 连坐） ==")
git("rm", "apk/Sinoky-v0.14.8-release.apk", check=False)
os.makedirs(os.path.join(APP, "apk"), exist_ok=True)
shutil.move(dst, os.path.join(APP, "apk", "Sinoky-v0.14.9-release.apk"))
print("  apk/ 内容:", os.listdir(os.path.join(APP, "apk")))

print("== 4. 提交推送 ==")
git("add", "apk")
git("add", "-u", "apk")
git("status", "--short")
git("commit", "-m", "v0.14.9: 回填 CI 构建的 APK 到 apk/（仅保留最新版），md5 与线上一致防部署覆盖")
git("push", "origin", "main")
print("  HEAD:", git("rev-parse", "--short", "HEAD"))
print("  remote:", git("ls-remote", "origin", "refs/heads/main"))
shutil.rmtree(TMP, ignore_errors=True)
print("DONE")
