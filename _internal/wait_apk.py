# -*- coding: utf-8 -*-
"""通用轮询：等 CI 出包。
判据必须同时满足（v0.14.11 踩坑后加严）：
  ① 线上 version.json 的 version == 本地目标版本（否则会读到上一版的 md5 而误判）
  ② md5 非空、size > 1MB
  ③ APK 实际下载字节数 == size
    —— 不能用 HTTP 200 判断存在性：CF Pages 的 SPA 回退对不存在的 .apk 也返回 200
       （实测返回 ~467KB 的 index.html）
"""
import json, ssl, subprocess, time, urllib.request

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
VER = json.load(open(APP + r"\version.json", encoding="utf-8"))["apk"]["version"]
APK = f"https://sinoky.pages.dev/apk/Sinoky-v{VER}-release.apk"
print("strict-wait for", VER, flush=True)


def get(u, t=90):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}),
                                  timeout=t, context=ctx)


ok = False
for i in range(1, 41):
    try:
        m = json.loads(get(f"https://sinoky.pages.dev/version.json?cb={time.time()}").read().decode())
    except Exception as e:
        print(f"[{i}] version.json 读取失败 {str(e)[:40]}", flush=True); time.sleep(30); continue
    ver_ok = m["version"] == VER
    md5, size = m["apk"]["md5"], m["apk"]["size"]
    try:
        with get(APK) as r:
            n = len(r.read())
    except Exception as e:
        n = f"ERR {str(e)[:30]}"
    dist = subprocess.run(["git", "-C", APP, "ls-remote", "origin", "dist"],
                          capture_output=True, text=True).stdout.strip()
    print(f"[{i}] dist={'Y' if dist else 'n'} live_ver={m['version']} ver_ok={ver_ok} "
          f"md5={md5[:12]!r} size={size} apk_bytes={n}", flush=True)
    if ver_ok and md5 and size > 1_000_000 and n == size:
        ok = True; break
    time.sleep(30)
print("READY" if ok else "TIMEOUT")
