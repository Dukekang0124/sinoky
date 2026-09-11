# -*- coding: utf-8 -*-
"""轮询 CI：dist 分支出包 + main 回写 md5/size + 线上 APK 可下载"""
import json, ssl, subprocess, time, urllib.request

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE


def git(*a):
    return subprocess.run(["git", "-C", APP] + list(a), capture_output=True, text=True).stdout.strip()


def head(url, timeout=60):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Range": "bytes=0-1023"})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status, r.headers.get("Content-Range") or r.headers.get("Content-Length")
    except Exception as e:
        return None, str(e)[:60]


APK = "https://sinoky.pages.dev/apk/Sinoky-v0.14.9-release.apk"
done = False
for i in range(1, 41):
    dist = git("ls-remote", "origin", "dist")
    meta = json.loads(urllib.request.urlopen(
        urllib.request.Request("https://sinoky.pages.dev/version.json?cb=" + str(time.time()),
                               headers={"User-Agent": "Mozilla/5.0"}), timeout=40, context=ctx).read().decode())
    st, ln = head(APK)
    print(f"[{i}] dist={'YES' if dist else 'no'} | main_md5={meta['apk']['md5'][:12]!r} size={meta['apk']['size']} | apk_status={st} range={ln}", flush=True)
    if st == 200 and meta["apk"]["md5"]:
        done = True
        break
    time.sleep(30)

print("READY" if done else "TIMEOUT")
