#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Sinoky B3 反馈智能分诊 —— 周报生成器（v0.23.21）

拉取线上用户反馈，交给后端 AI 做摘要 + 主题聚类（/api/feedback?digest=1），
渲染成一份中文 markdown 周报，落到 OB 的 09-用户洞察/。

只读：不写 KV、不改任何线上数据。可安全重复运行。

用法：
  python _internal/feedback_digest.py                  # 生成周报，写入 OB
  python _internal/feedback_digest.py --json           # 只打印 digest JSON（给自动化用）
  python _internal/feedback_digest.py --stdout         # 只打印 markdown，不写文件
  python _internal/feedback_digest.py --days 7         # 只统计最近 7 天（默认全部）
  python _internal/feedback_digest.py --token XXX      # 显式给 token

token 解析顺序（不硬编码，仓库是公开的）：
  1) --token 参数
  2) 环境变量 SINOKY_FEEDBACK_TOKEN 或 FEEDBACK_TOKEN
  3) 本地文件 _internal/.feedback_token（已在 .gitignore 中）
获取方式：Cloudflare Dashboard → Workers & Pages → sinoky → Settings →
          Environment variables → FEEDBACK_TOKEN（secret）。
"""
import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://sinoky.pages.dev"
HERE = os.path.dirname(os.path.abspath(__file__))
# OB 落盘位置：Sinoky/09-用户洞察/
OB_OUT_DIR = os.path.abspath(os.path.join(HERE, "..", "..", "09-用户洞察"))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def resolve_token(cli_token=None):
    if cli_token:
        return cli_token.strip()
    for env_name in ("SINOKY_FEEDBACK_TOKEN", "FEEDBACK_TOKEN"):
        v = (os.environ.get(env_name) or "").strip()
        if v:
            return v
    p = os.path.join(HERE, ".feedback_token")
    if os.path.isfile(p):
        with open(p, "r", encoding="utf-8-sig") as f:
            v = f.read().strip()
        if v:
            return v
    return ""


def fetch_json(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "sinoky-feedback-digest/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode("utf-8", "replace"))


def days_ago_iso(days):
    if not days:
        return None
    return (datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(days=days)).strftime("%Y-%m-%d")


def filter_items(items, days=None):
    if not days:
        return items
    cut = days_ago_iso(days)
    out = []
    for it in items:
        t = str(it.get("t") or "")
        if t and t[:10] >= cut:
            out.append(it)
    return out


CAT_LABEL = {
    "bug": "🐛 故障",
    "audio": "🔇 无声音",
    "mic": "🎤 麦克风",
    "confusing": "🤔 困惑",
    "idea": "💡 建议",
    "wantline": "💬 想说不会说",
    "other": "✍️ 其他",
}


def render_md(digest, raw_items, days=None, digest_model="", total=0):
    today = datetime.datetime.now().strftime("%Y-%m-%d")
    scope = "最近 %d 天" % days if days else "全部累计"
    lines = []
    lines.append("# Sinoky 用户反馈周报 · %s" % today)
    lines.append("")
    lines.append("> 自动生成（B3 反馈智能分诊）。范围：%s；本批共 **%d** 条反馈；"
                 "分类模型：`%s`。" % (scope, total, digest_model or "n/a"))
    lines.append("")
    lines.append("## 一、AI 摘要")
    lines.append("")
    lines.append(digest.get("summary") or "（无）")
    lines.append("")

    urgent = digest.get("urgent")
    if urgent:
        lines.append("## 二、⚠️ 最需立刻处理")
        lines.append("")
        lines.append("- **%s**" % (urgent.get("topic") or "未命名"))
        lines.append("  - 原因：%s" % (urgent.get("why") or "—"))
        lines.append("")

    clusters = digest.get("clusters") or []
    if clusters:
        lines.append("## 三、主题聚类")
        lines.append("")
        lines.append("| 主题 | 分类 | 条数 | 处理建议 |")
        lines.append("|---|---|---|---|")
        for c in clusters:
            if not isinstance(c, dict):
                continue
            cat = str(c.get("cat") or "other")
            lines.append("| %s | %s | %s | %s |" % (
                str(c.get("topic") or "—").replace("|", "/"),
                CAT_LABEL.get(cat, cat),
                c.get("count") if c.get("count") is not None else "—",
                str(c.get("action") or "—").replace("|", "/").replace("\n", " "),
            ))
        lines.append("")
        lines.append("### 代表性原话")
        lines.append("")
        for c in clusters:
            if not isinstance(c, dict):
                continue
            samples = c.get("samples") or []
            if not samples:
                continue
            lines.append("- **%s**" % (c.get("topic") or "—"))
            for s in samples:
                lines.append("  - “%s”" % str(s).replace("\n", " ").strip())
        lines.append("")

    if raw_items:
        lines.append("## 四、原始反馈（按时间倒序）")
        lines.append("")
        lines.append("| 时间(UTC) | 分类 | 版本 | 国家 | 内容 |")
        lines.append("|---|---|---|---|---|")
        for it in raw_items:
            msg = str(it.get("msg") or "").replace("|", "/").replace("\n", " ").strip()
            if len(msg) > 160:
                msg = msg[:160] + "…"
            cat = str(it.get("cat") or "other")
            lines.append("| %s | %s | %s | %s | %s |" % (
                str(it.get("t") or "")[:19],
                CAT_LABEL.get(cat, cat),
                it.get("v") or "—",
                it.get("country") or "—",
                msg or "—",
            ))
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("*由 `_internal/feedback_digest.py` 生成；AI 摘要仅供参考，原文为准。*")
    lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="Sinoky 反馈智能分诊周报生成器")
    ap.add_argument("--token", default=None, help="覆盖 FEEDBACK_TOKEN")
    ap.add_argument("--days", type=int, default=0, help="只统计最近 N 天（0=全部）")
    ap.add_argument("--json", action="store_true", help="只打印 digest JSON")
    ap.add_argument("--stdout", action="store_true", help="只打印 markdown，不落盘")
    ap.add_argument("--no-raw", action="store_true", help="不拉原始反馈附表")
    ap.add_argument("--base", default=BASE, help="站点根（默认生产）")
    args = ap.parse_args()

    token = resolve_token(args.token)
    if not token:
        print("ERROR: 未找到 FEEDBACK_TOKEN。", file=sys.stderr)
        print("  可用 --token / 环境变量 SINOKY_FEEDBACK_TOKEN / 本地文件 "
              "_internal/.feedback_token 提供。", file=sys.stderr)
        print("  获取：Cloudflare Dashboard → Workers & Pages → sinoky → Settings → "
              "Environment variables → FEEDBACK_TOKEN", file=sys.stderr)
        return 2

    base = args.base.rstrip("/")
    digest_url = "%s/api/feedback?token=%s&digest=1" % (base, urllib.parse.quote(token))
    raw_url = "%s/api/feedback?token=%s" % (base, urllib.parse.quote(token))

    # --- 1) 拉原始反馈（用于过滤 + 附表） ---
    raw_items, total_raw = [], 0
    try:
        code, data = fetch_json(raw_url)
        if code != 200 or not data.get("ok"):
            print("ERROR: 读反馈失败 HTTP %s %s" % (code, data.get("error")), file=sys.stderr)
            return 3
        raw_items = data.get("items") or []
        total_raw = data.get("count") or len(raw_items)
    except urllib.error.HTTPError as e:
        print("ERROR: HTTP %s（token 是否正确？）" % e.code, file=sys.stderr)
        return 3
    except Exception as e:
        print("ERROR: 读取失败 %s" % e, file=sys.stderr)
        return 3

    scoped = filter_items(raw_items, args.days or None)

    # --- 2) 拉 AI digest ---
    try:
        code, data = fetch_json(digest_url)
        if code != 200 or not data.get("ok"):
            print("ERROR: digest 失败 HTTP %s %s" % (code, data.get("error")), file=sys.stderr)
            return 4
        digest = data.get("digest") or {}
    except Exception as e:
        print("ERROR: digest 调用失败 %s" % e, file=sys.stderr)
        return 4

    if args.json:
        print(json.dumps(digest, ensure_ascii=False, indent=2))
        return 0

    md = render_md(
        digest,
        [] if args.no_raw else scoped,
        days=args.days or None,
        digest_model=digest.get("model") or "",
        total=len(scoped),
    )

    if args.stdout:
        print(md)
        return 0

    os.makedirs(OB_OUT_DIR, exist_ok=True)
    fname = "%s-Sinoky用户反馈周报.md" % datetime.datetime.now().strftime("%Y-%m-%d")
    out = os.path.join(OB_OUT_DIR, fname)
    with open(out, "w", encoding="utf-8") as f:
        f.write(md)

    flag = " [DEGRADED]" if digest.get("degraded") else ""
    print("OK: %d 条反馈 -> %s%s" % (len(scoped), out, flag))
    print("   summary: %s" % (digest.get("summary") or "")[:120])
    return 0


if __name__ == "__main__":
    sys.exit(main())
