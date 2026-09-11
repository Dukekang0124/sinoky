# -*- coding: utf-8 -*-
"""v0.14.9 生产终验：四处版本 + 主视觉上线 + APK 元数据一致 + 聊天 API"""
import json, ssl, time, urllib.request

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
BASE = "https://sinoky.pages.dev"
UA = {"User-Agent": "Mozilla/5.0 final-verifier"}


def get(path, binary=False, timeout=90):
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        d = r.read()
        return r.status, (d if binary else d.decode("utf-8", "replace"))


def post(path, payload, timeout=60):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={**UA, "Content-Type": "application/json",
                                          "Origin": BASE}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.status, r.read().decode("utf-8", "replace")


WANT_MD5 = "1bbfc34822bbe91d43c6620a86b90d35"
WANT_SIZE = 23893487
checks = []


def step(label, fn, retries=8, wait=25):
    for i in range(retries):
        try:
            ok, detail = fn()
        except Exception as e:
            ok, detail = False, f"EXC {type(e).__name__}: {str(e)[:70]}"
        print(f"  [{i+1}/{retries}] {label}: {'PASS' if ok else 'wait'} | {detail}", flush=True)
        if ok:
            checks.append((label, True))
            return
        time.sleep(wait)
    checks.append((label, False))


print("=== v0.14.9 生产终验 ===")

step("1 version.json/md5/size", lambda: (
    (lambda s, b: (json.loads(b)["version"] == "0.14.9"
                   and json.loads(b)["apk"]["md5"] == WANT_MD5
                   and json.loads(b)["apk"]["size"] == WANT_SIZE,
                   f"v={json.loads(b)['version']} md5={json.loads(b)['apk']['md5'][:12]} size={json.loads(b)['apk']['size']}"))(*get(f"/version.json?cb={time.time()}"))
))

step("2 主视觉 SVG 线上可用", lambda: (
    (lambda s, b: (s == 200 and b.startswith(b"<svg") or b"<svg" in b[:200], f"status={s} bytes={len(b)}"))(*get(f"/assets/brand/dragon-nono.svg?cb={time.time()}", binary=True))
))

step("3 启动屏引用 index", lambda: (
    (lambda s, b: ("dragon-nono.svg" in b and "Sino<b>k</b>y" in b, f"status={s}"))(*get(f"/?cb={time.time()}"))
))

step("4 sw.js 缓存版本", lambda: (
    (lambda s, b: ("sinoky-v0.14.9" in b, f"status={s}"))(*get(f"/sw.js?cb={time.time()}"))
))

step("5 download 兜底链接", lambda: (
    (lambda s, b: ("Sinoky-v0.14.9-release.apk" in b, f"status={s}"))(*get(f"/download.html?cb={time.time()}"))
))

step("6 APK 实包可下载且 md5 一致", lambda: (
    (lambda s, b: (
        (import_hash := __import__("hashlib").md5(b).hexdigest()) == WANT_MD5 and len(b) == WANT_SIZE,
        f"status={s} bytes={len(b)} md5={__import__('hashlib').md5(b).hexdigest()[:12]}"))(*get("/apk/Sinoky-v0.14.9-release.apk", binary=True, timeout=600))
))

step("7 /api/chat 生产可用", lambda: (
    (lambda s, b: ("glm-4-flash" in b, f"status={s} tail={b[-60:]!r}"))(*post("/api/chat", {"text": "上线验收：诺诺好呀", "uid": "release1409", "hist": []}))
))

print()
print("=== SUMMARY ===")
for k, v in checks:
    print(("PASS " if v else "FAIL ") + k)
print("ALL PASS" if checks and all(v for _, v in checks) else "SOME FAILED")
