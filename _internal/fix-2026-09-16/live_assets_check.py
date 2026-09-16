# -*- coding: utf-8 -*-
"""线上资产逐文件核对：把 assets/{mascot,empty,onboard,read} 逐个从 sinoky.pages.dev 取回，
与本地 md5 比对（带 ?cb= 击穿缓存）。同时验证旧 APK 已下线。"""
import io, os, ssl, time, hashlib, urllib.request

APP = r"D:/写作工具/知识管理/01-Projects-项目/求职与作品集/03-作品集/Sinoky/sinoky-app"
BASE = "https://sinoky.pages.dev"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def md5b(b):
    return hashlib.md5(b).hexdigest()


def get(path, timeout=120):
    url = BASE + path + ("&" if "?" in path else "?") + "cb=%d" % int(time.time() * 1000)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read(), r.status, r.headers.get("content-type", "")


groups = ["mascot", "empty", "onboard", "read"]
total = ok = 0
fails = []
for g in groups:
    d = os.path.join(APP, "assets", g)
    for f in sorted(os.listdir(d)):
        lp = os.path.join(d, f)
        local = md5b(open(lp, "rb").read())
        total += 1
        try:
            b, st, ct = get("/assets/%s/%s" % (g, f))
        except Exception as e:
            fails.append("%s/%s 取回异常 %s" % (g, f, e)); continue
        lm = md5b(b)
        if lm == local:
            ok += 1
        else:
            fails.append("%s/%s 不一致 线上%s 本地%s (len %d vs %d, ct=%s)" % (
                g, f, lm[:8], local[:8], len(b), os.path.getsize(lp), ct))
print("资产逐文件核对：%d/%d 一致" % (ok, total))
for x in fails:
    print("  ✗", x)

# 旧 APK 是否已下线
print()
print("=== 旧包下线核验 ===")
for v in ["0.23.12", "0.23.13"]:
    try:
        b, st, ct = get("/apk/Sinoky-v%s-release.apk" % v)
        magic = b[:4]
        isapk = magic == b"PK\x03\x04"
        print("  v%s → %dB ct=%s 首4=%r %s" % (v, len(b), ct, magic, "真包" if isapk else "非包(已下线/兜底)"))
    except Exception as e:
        print("  v%s → 取回异常 %s" % (v, e))
