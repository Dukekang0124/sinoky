# -*- coding: utf-8 -*-
"""通用生产验收：以本地 version.json 为准，校验线上四处版本 + 启动屏状态 + APK（md5 就绪时）"""
import hashlib, json, os, ssl, sys, time, urllib.request

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
BASE = "https://sinoky.pages.dev"
UA = {"User-Agent": "Mozilla/5.0 verifier"}
LOCAL = json.load(open(os.path.join(APP, "version.json"), encoding="utf-8"))
VER, CODE, MD5, SIZE = LOCAL["version"], LOCAL["apk"]["versionCode"], LOCAL["apk"]["md5"], LOCAL["apk"]["size"]
print(f"expect: v{VER} code={CODE} md5={MD5 or '(CI 未回写)'} size={SIZE or '(CI 未回写)'}\n")


def get(path, binary=False, timeout=90):
    with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=timeout, context=ctx) as r:
        d = r.read()
        return r.status, (d if binary else d.decode("utf-8", "replace"))


def step(label, fn, retries=8, wait=25):
    for i in range(retries):
        try:
            ok, detail = fn()
        except Exception as e:
            ok, detail = False, f"EXC {type(e).__name__}: {str(e)[:60]}"
        print(f"  [{i+1}/{retries}] {label}: {'PASS' if ok else 'wait'} | {detail}", flush=True)
        if ok:
            return True
        time.sleep(wait)
    return False


checks = []
checks.append(("1 version.json", step("version.json", lambda: (
    (lambda s, b: (json.loads(b)["version"] == VER and json.loads(b)["apk"]["versionCode"] == CODE,
                   f"v={json.loads(b)['version']} code={json.loads(b)['apk']['versionCode']} md5={json.loads(b)['apk']['md5'][:12]!r}"))(*get(f"/version.json?cb={time.time()}"))
))))

checks.append(("2 启动屏=主视觉(含 brand 字标)", step("index splash", lambda: (
    (lambda s, b: ("dragon-nono.svg" in b and "sp-brand" in b and f"APP_VERSION = '{VER}'" in b,
                   f"status={s} 主视觉={'dragon-nono.svg' in b} 字标={'sp-brand' in b}"))(*get(f"/?cb={time.time()}"))
))))

checks.append(("3 sw 缓存", step("sw.js", lambda: (
    (lambda s, b: (f"sinoky-v{VER}" in b, f"status={s}"))(*get(f"/sw.js?cb={time.time()}"))
))))

checks.append(("4 download 兜底", step("download.html", lambda: (
    (lambda s, b: (f"Sinoky-v{VER}-release.apk" in b, f"status={s}"))(*get(f"/download.html?cb={time.time()}"))
))))

checks.append(("5 主视觉资产仍可访问(备用)", step("dragon-nono.svg", lambda: (
    (lambda s, b: (s == 200, f"status={s} bytes={len(b)}"))(*get(f"/assets/brand/dragon-nono.svg?cb={time.time()}", binary=True))
))))

if MD5:
    checks.append(("6 APK 实包 md5 一致", step("APK", lambda: (
        (lambda s, b: (hashlib.md5(b).hexdigest() == MD5 and len(b) == SIZE,
                       f"status={s} bytes={len(b)} md5={hashlib.md5(b).hexdigest()[:12]}"))(*get(f"/apk/Sinoky-v{VER}-release.apk", binary=True, timeout=600))
    ))))
else:
    print("  (跳过 APK md5 校验：CI 尚未回写)")

print("\n=== SUMMARY ===")
for k, v in checks:
    print(("PASS " if v else "FAIL ") + k)
print("ALL PASS" if all(v for _, v in checks) else "SOME FAILED")
sys.exit(0 if all(v for _, v in checks) else 1)
