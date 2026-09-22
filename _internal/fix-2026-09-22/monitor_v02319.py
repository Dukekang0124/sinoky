#!/usr/bin/env python3
"""Monitor CI run 58 (apk.yml v0.23.19) then verify live web + APK.
Polls anonymously via api.github.com (works with --ssl-no-revoke equivalent:
we disable cert verification here)."""
import json, ssl, time, hashlib, sys, urllib.request

RUN_ID = "35734335627"
RUN_URL = f"https://api.github.com/repos/Dukekang0124/sinoky/actions/runs/{RUN_ID}"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
UA = {"User-Agent": "sinoky-monitor", "Accept": "application/vnd.github+json"}

def get(url, extra=None, timeout=30):
    h = dict(UA)
    if extra:
        h.update(extra)
    req = urllib.request.Request(url, headers=h)
    return urllib.request.urlopen(req, timeout=timeout, context=CTX)

def api_json(url):
    with get(url) as r:
        return json.load(r)

def log(msg):
    print(msg, flush=True)

def main():
    log(f"[monitor] watching run {RUN_ID}")
    status = concl = None
    for i in range(60):  # up to ~45 min at 45s
        try:
            j = api_json(RUN_URL)
            status, concl = j["status"], j.get("conclusion")
            log(f"[{i:02d}] status={status} conclusion={concl} updated={j.get('updated_at')}")
            if status == "completed":
                break
        except Exception as e:
            log(f"[{i:02d}] poll error: {e}")
        time.sleep(45)
    log(f"[monitor] run finished status={status} conclusion={concl}")
    if concl != "success":
        log(f"[monitor] run did NOT succeed ({concl}) -> see {RUN_URL}")
        return
    # ---- verify live ----
    cb = str(int(time.time()))
    try:
        with get(f"https://sinoky.pages.dev/version.json?cb={cb}") as r:
            vj = json.load(r)
        log("[live] version.json:")
        log("   version   = " + str(vj.get("version")))
        log("   apk       = " + json.dumps(vj.get("apk")))
    except Exception as e:
        log(f"[live] version.json error: {e}")
        vj = {}
    # APK head check (PK magic) + full md5/size
    apk_url = f"https://sinoky.pages.dev/apk/Sinoky-v0.23.19-release.apk?cb={cb}"
    try:
        req = urllib.request.Request(apk_url, headers={**UA, "Range": "bytes=0-3"})
        with urllib.request.urlopen(req, timeout=40, context=CTX) as r:
            head = r.read(4)
        log(f"[apk] first4 = {head.hex()}  (504b0304 == PK ok)")
    except Exception as e:
        log(f"[apk] head error: {e}")
    # full download md5+size
    try:
        req = urllib.request.Request(apk_url, headers=UA)
        m = hashlib.md5()
        n = 0
        with urllib.request.urlopen(req, timeout=300, context=CTX) as r:
            while True:
                b = r.read(1 << 16)
                if not b:
                    break
                n += len(b)
                m.update(b)
        md5 = m.hexdigest()
        log(f"[apk] size={n} md5={md5}")
        exp = vj.get("apk") or {}
        log(f"[apk] match size={n == exp.get('size')} md5={md5 == exp.get('md5')}")
    except Exception as e:
        log(f"[apk] download error: {e}")
    log("[monitor] DONE")

if __name__ == "__main__":
    main()
