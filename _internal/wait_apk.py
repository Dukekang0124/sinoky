# -*- coding: utf-8 -*-
"""通用轮询：等 CI 出包（dist 分支）+ main 回写 md5/size + 线上 APK 可下载"""
import json, ssl, subprocess, time, urllib.request

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
VER = json.load(open(APP + r"\version.json", encoding="utf-8"))["apk"]["version"]
APK = f"https://sinoky.pages.dev/apk/Sinoky-v{VER}-release.apk"
print("waiting for", VER, flush=True)


def get(url, t=45):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
                                  timeout=t, context=ctx).read()


ok = False
for i in range(1, 41):
    dist = subprocess.run(["git", "-C", APP, "ls-remote", "origin", "dist"],
                          capture_output=True, text=True).stdout.strip()
    meta = json.loads(get(f"https://sinoky.pages.dev/version.json?cb={time.time()}").decode())
    code, size = None, None
    try:
        req = urllib.request.Request(APK, headers={"User-Agent": "Mozilla/5.0", "Range": "bytes=0-1023"})
        with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
            code = r.status
            size = r.headers.get("Content-Range") or r.headers.get("Content-Length")
    except Exception as e:
        code, size = None, str(e)[:40]
    print(f"[{i}] dist={'YES' if dist else 'no'} | md5={meta['apk']['md5'][:12]!r} size={meta['apk']['size']} | apk={code} {size}", flush=True)
    if code == 200 and meta["apk"]["md5"] and meta["apk"]["size"] > 1_000_000:
        ok = True; break
    time.sleep(30)
print("READY" if ok else "TIMEOUT")
