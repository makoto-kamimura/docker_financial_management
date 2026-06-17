#!/usr/bin/env bash
# PostgreSQL の論理バックアップを取得する。
# 使い方: DATABASE_URL=postgres://... ./platform/scripts/backup.sh [出力ディレクトリ]
#
# 保持ポリシー: RETENTION_DAYS（既定 30 日）より古いダンプを自動削除する。
set -euo pipefail

OUT_DIR="${1:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
: "${DATABASE_URL:?DATABASE_URL を設定してください}"

mkdir -p "$OUT_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/financial-$TIMESTAMP.sql.gz"

echo "Backing up to $FILE ..."
pg_dump "$DATABASE_URL" | gzip > "$FILE"
echo "Done: $FILE"

# 保持期間を超えた古いバックアップを削除
find "$OUT_DIR" -name 'financial-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete
