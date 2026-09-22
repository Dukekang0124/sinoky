#!/usr/bin/env bash
# build-deploy-dir.sh — 构建「精简部署目录」，剔除一切开发期/构建期资源，
# 避免内部脚本与文档被公网直下（对应项目里的 static-asset-leak-audit 闸门）。
#
# 用法:  bash scripts/build-deploy-dir.sh [SRC] [DST]
#   SRC 默认仓库根(.), DST 默认 dist/
#
# ⚠️ 关键事实（实测 2026-09-22 确认）:
#   Cloudflare Pages 的「直接上传」路径（wrangler pages deploy / cloudflare/pages-action）
#   不读取 .assetsignore，也不读取 .gitignore 来做排除——实测会把 _internal/ scripts/ .github/
#   全部上传。因此必须用本脚本先构建精简目录，再部署「该目录」。不要依赖 .assetsignore。
#   （.assetsignore 仅对 CF 的「Git 集成自动构建」生效，而本项目走的是直接上传。）
#
# CI 环境(ubuntu-latest)自带 rsync；本地 Windows 无 rsync 时，请用 robocopy 等价命令
# （见 MEMORY.md「wrangler 直连部署」段落，排除清单必须与下方 EXCLUDES 保持一致）。

set -euo pipefail

SRC="${1:-.}"
DST="${2:-dist}"

# 单一事实源：运行时不需要、绝不能上线的资源
EXCLUDES=(
  '.git'
  '_internal'
  '.github'
  'scripts'
  'www'
  'node_modules'
  '.wrangler'
  'package.json'
  'package-lock.json'
  'capacitor.config.json'
  '_audit_i18n.txt'
  # 根目录一次性脚本（与 .assetsignore 对齐）
  # ⚠️ badge-backend.mjs 被 _worker.js import，是 Worker 运行时依赖，【不能排除】！
  'verify-cards.cjs'
  # data/ 下的构建器与字段规范（内部文档，不公开；data/*.json 与 strokes/ 是前端运行时数据，必须保留）
  'data/build-flashcards.mjs'
  'data/flashcards.schema.md'
)

mkdir -p "$DST"

if command -v rsync >/dev/null 2>&1; then
  ARGS=(--archive --delete)
  for e in "${EXCLUDES[@]}"; do ARGS+=(--exclude="$e"); done
  ARGS+=(--exclude='*.log')   # 运行时不需任何日志
  rsync "${ARGS[@]}" "$SRC/" "$DST/"
else
  echo "ERROR: 当前环境无 rsync。Windows 本地请用以下 robocopy 等价命令构建 dist/：" >&2
  echo "  robocopy \"$SRC\" \"$DST\" /E /XD .git _internal .github scripts www node_modules .wrangler \\" >&2
  echo "    /XF package.json package-lock.json capacitor.config.json _audit_i18n.txt *.log" >&2
  exit 1
fi

echo "✅ Built deploy dir: $DST"
echo "   excluded: ${EXCLUDES[*]} + *.log"
echo "   file count: $(find "$DST" -type f | wc -l)"
