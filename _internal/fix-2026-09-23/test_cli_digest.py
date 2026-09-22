#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""B3 CLI 端到端自测：起真 HTTP server → 跑 feedback_digest.py → 断言渲染结果。

运行：python _internal/fix-2026-09-23/test_cli_digest.py
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))
CLI = os.path.join(APP, "_internal", "feedback_digest.py")
PY = sys.executable

DIGEST = {
    "summary": "本批反馈集中在音频无声与麦克风授权，整体情绪偏挫败。",
    "clusters": [
        {"topic": "音频无声", "cat": "audio", "count": 2, "samples": ["No sound at all"], "action": "检查 iOS 静音开关"},
        {"topic": "麦克风问题", "cat": "mic", "count": 1, "samples": ["Mic never starts"], "action": "补权限引导文案"},
    ],
    "urgent": {"topic": "音频无声", "why": "新用户第一句就听不到声音，直接流失"},
    "model": "glm-4-flash", "degraded": False, "count": 3,
}
ITEMS = [
    {"t": "2026-09-23T02:00:00Z", "msg": "I want to say my job", "cat": "wantline", "v": "0.23.19", "country": "FR"},
    {"t": "2026-09-22T11:00:00Z", "msg": "Mic never starts", "cat": "mic", "v": "0.23.20", "country": "DE"},
    {"t": "2026-09-22T10:00:00Z", "msg": "No sound at all|with pipe", "cat": "audio", "v": "0.23.20", "country": "US"},
    {"t": "2026-01-01T00:00:00Z", "msg": "ANCIENT_FEEDBACK_MARKER", "cat": "other", "v": "0.3.8", "country": "GB"},
]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if "/api/feedback" not in self.path:
            self.send_response(404); self.end_headers(); return
        if "token=" not in self.path:
            self.send_response(403); self.end_headers(); return
        if "digest=1" in self.path:
            body = {"ok": True, "count": len(ITEMS), "digest": DIGEST}
        else:
            body = {"ok": True, "count": len(ITEMS), "items": ITEMS}
        raw = json.dumps(body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


pass_n, fail_n = 0, 0


def ok(m):
    global pass_n; pass_n += 1; print("  \u2713 " + m)


def no(m):
    global fail_n; fail_n += 1; print("  \u2717 " + m)


def main():
    srv = HTTPServer(("127.0.0.1", 0), H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % port

    # T1: --stdout 渲染
    r = subprocess.run([PY, CLI, "--base", base, "--token", "t", "--stdout"],
                       capture_output=True, text=True, encoding="utf-8")
    md = r.stdout or ""
    (r.returncode == 0 and "## 一、AI 摘要" in md and "## 三、主题聚类" in md
     and "## 四、原始反馈" in md and "音频无声" in md and "No sound at all" in md)
    if r.returncode == 0 and "## 一、AI 摘要" in md and "## 三、主题聚类" in md \
            and "## 四、原始反馈" in md and "音频无声" in md and "No sound at all" in md:
        ok("T1 --stdout 输出完整周报（摘要/聚类/原文）")
    else:
        no("T1 rc=%s len=%d head=%r" % (r.returncode, len(md), md[:120]))

    # T2: pipe 被替换（markdown 表格不被破坏）
    ("|" not in md.split("No sound at all")[1][:40]) if "No sound at all" in md else False
    if "No sound at all/with pipe" in md:
        ok("T2 原文含 | 被替换为 / ，表格结构不被破坏")
    else:
        no("T2 pipe 未替换")

    # T3: 紧急项渲染
    ("## 二、⚠️ 最需立刻处理" in md)
    if "## 二、⚠️ 最需立刻处理" in md and "直接流失" in md:
        ok("T3 urgent 段渲染")
    else:
        no("T3 urgent 段缺失")

    # T4: --json
    r = subprocess.run([PY, CLI, "--base", base, "--token", "t", "--json"],
                       capture_output=True, text=True, encoding="utf-8")
    try:
        j = json.loads(r.stdout)
        (j.get("model") == "glm-4-flash" and j.get("degraded") is False)
        if j.get("model") == "glm-4-flash" and j.get("degraded") is False:
            ok("T4 --json 原样吐出 digest JSON")
        else:
            no("T4 json 内容异常: %s" % r.stdout[:120])
    except Exception as e:
        no("T4 json 解析失败: %s / %r" % (e, r.stdout[:120]))

    # T5: --days 只保留近期（ITEMS 含一条 2026-01-01 的老反馈，必须被排除）
    r = subprocess.run([PY, CLI, "--base", base, "--token", "t", "--stdout", "--days", "7"],
                       capture_output=True, text=True, encoding="utf-8")
    has_recent = "本批共 **3** 条" in r.stdout
    no_old = "ANCIENT_FEEDBACK_MARKER" not in r.stdout
    if has_recent and no_old:
        ok("T5 --days 7 排除 6 个月前的旧反馈（4 -> 3 条）")
    else:
        no("T5 days 过滤异常: recent=%s old_excluded=%s" % (has_recent, no_old))

    # T6: 无 token → 退出码 2
    env2 = dict(os.environ)
    env2.pop("SINOKY_FEEDBACK_TOKEN", None)
    env2.pop("FEEDBACK_TOKEN", None)
    r = subprocess.run([PY, CLI, "--base", base], capture_output=True, text=True,
                       encoding="utf-8", env=env2, cwd=APP)
    if r.returncode == 2 and "未找到 FEEDBACK_TOKEN" in (r.stderr or ""):
        ok("T6 无 token -> 退出码 2 + 明确指引")
    else:
        no("T6 rc=%s err=%r" % (r.returncode, (r.stderr or "")[:120]))

    srv.shutdown()
    print("\n=== %d passed, %d failed ===\n" % (pass_n, fail_n))
    return 1 if fail_n else 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
