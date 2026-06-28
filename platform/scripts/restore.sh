#!/usr/bin/env bash
# PostgreSQL を gzip 圧縮されたダンプから復元する。
# 使い方: DATABASE_URL=postgres://... ./platform/scripts/restore.sh backups/financial-XXXX.sql.gz
set -euo pipefail

FILE="${1:?復元するダンプファイルを指定してください}"
: "${DATABASE_URL:?DATABASE_URL を設定してください}"

echo "Restoring from $FILE ..."
gunzip -c "$FILE" | psql "$DATABASE_URL"
echo "Done."
