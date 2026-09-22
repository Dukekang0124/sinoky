#!/usr/bin/env python3
"""Generic Sinoky release monitor: find the apk.yml run for a tag, wait, then verify live web + APK."""
import json, ssl, time, hashlib, sys, urllib.request

TAG = sys.argv[1] if len(sys.argv) > 1 else 'v0.23.20'
VER = TAG.lstrip('v')
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = {"User-Agent": "sinoky-monitor", "Accept": "application/vnd.github+json"}

def get(url, extra=None, timeout=40):
    h = dict(UA)
    if extra: h.update(extra)
    return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout, context=CTX)

def api(url):
    with get(url) as r: return json.load(r)

def log(m): print(m, flush=True)

run = None
for i in range(20):
    try:
        d = api("https://api.github.com/repos/Dukekang0124/sinoky/actions/runs?per_page=15")
        for r in d["workflow_runs"]:
            if r["name"] == "Build Sinoky APK" and r["head_branch"] == TAG:
                run = r; break
    except Exception as e:
        log(f"[{i:02d}] list error: {e}")
    if run: break
    time.sleep(10)
if not run:
    log(f"[monitor] could not find apk run for {TAG}"); sys.exit(1)
log(f"[monitor] run #{run['run_number']} id={run['id']} -> {run['html_url']}")

url = f"https://api.github.com/repos/Dukekang0124/sinoky/actions/runs/{run['id']}"
status = concl = None
for i in range(70):
    try:
        j = api(url); status, concl = j["status"], j.get("conclusion")
        log(f"[{i:02d}] status={status} conclusion={concl}")
        if status == "completed": break
    except Exception as e:
        log(f"[{i:02d}] poll error: {e}")
    time.sleep(45)
log(f"[monitor] finished status={status} conclusion={concl}")
if concl != "success":
    log("[monitor] NOT success -> inspect " + run["html_url"]); sys.exit(2)

cb = str(int(time.time()))
vj = {}
try:
    with get(f"https://sinoky.pages.dev/version.json?cb={cb}") as r: vj = json.load(r)
    log("[live] version   = " + str(vj.get("version")))
    log("[live] apk       = " + json.dumps(vj.get("apk")))
except Exception as e:
    log(f"[live] version.json error: {e}")

apk_url = f"https://sinoky.pages.dev/apk/Sinoky-{TAG}-release.apk?cb={cb}"
try:
    with urllib.request.urlopen(urllib.request.Request(apk_url, headers={**UA, "Range": "bytes=0-3"}), timeout=40, context=CTX) as r:
        log(f"[apk] first4 = {r.read(4).hex()} (504b0304 == PK ok)")
except Exception as e:
    log(f"[apk] head error: {e}")
try:
    m = hashlib.md5(); n = 0
    with urllib.request.urlopen(urllib.request.Request(apk_url, headers=UA), timeout=600, context=CTX) as r:
        while True:
            b = r.read(1 << 16)
            if not b: break
            n += len(b); m.update(b)
    md5 = m.hexdigest(); exp = vj.get("apk") or {}
    log(f"[apk] size={n} md5={md5}")
    log(f"[apk] match size={n == exp.get('size')} md5={md5 == exp.get('md5')} ver={exp.get('version')}")
except Exception as e:
    log(f"[apk] download error: {e}")
log("[monitor] DONE")
