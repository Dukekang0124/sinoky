# -*- coding: utf-8 -*-
"""生产环境验收：v0.14.9 主视觉上线 + 四处版本一致"""
import json, ssl, time, urllib.request

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
BASE = "https://sinoky.pages.dev"


def get(path, binary=False):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "Mozilla/5.0 verifier"})
    with urllib.request.urlopen(req, timeout=45, context=ctx) as r:
        data = r.read()
        return r.status, (data if binary else data.decode("utf-8", "replace")), dict(r.headers)


def check(label, fn):
    for attempt in range(1, 9):
        try:
            ok, detail = fn()
        except Exception as e:
            ok, detail = False, f"EXC {e}"
        print(f"  [{attempt}] {label}: {'OK' if ok else '...'} {detail}")
        if ok:
            return True
        time.sleep(20)
    return False


results = {}

results["version.json"] = check("version.json", lambda: (
    (lambda s, b, h: (json.loads(b)["version"] == "0.14.9" and json.loads(b)["apk"]["versionCode"] == 1409,
                      f"version={json.loads(b)['version']} code={json.loads(b)['apk']['versionCode']} md5={json.loads(b)['apk']['md5'][:12]!r}"))(*get(f"/version.json?cb={time.time()}"))
))

results["index"] = check("index.html", lambda: (
    (lambda s, b, h: ("dragon-nono.svg" in b and "APP_VERSION = '0.14.9'" in b,
                      f"status={s} splash_ref={'dragon-nono.svg' in b} ver={'0.14.9' if chr(48)+'.14.9' in b else '?'}"))(*get(f"/?cb={time.time()}"))
))

results["sw.js"] = check("sw.js", lambda: (
    (lambda s, b, h: ("sinoky-v0.14.9" in b, f"status={s}"))(*get(f"/sw.js?cb={time.time()}"))
))

results["brand svg"] = check("assets/brand/dragon-nono.svg", lambda: (
    (lambda s, b, h: (s == 200 and len(b) > 15000 and b"<svg" in b,
                      f"status={s} bytes={len(b)} type={h.get('content-type','?')}"))(*get(f"/assets/brand/dragon-nono.svg?cb={time.time()}", binary=True))
))

results["download"] = check("download.html", lambda: (
    (lambda s, b, h: ("Sinoky-v0.14.9-release.apk" in b, f"status={s}"))(*get(f"/download.html?cb={time.time()}"))
))

print()
print("=== SUMMARY ===")
for k, v in results.items():
    print(("PASS " if v else "FAIL ") + k)
print("ALL PASS" if all(results.values()) else "SOME FAILED")
