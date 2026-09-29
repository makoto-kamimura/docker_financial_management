# バックアップと復元

DB（PostgreSQL）のバックアップと復元の手順。スクリプトは `platform/scripts/` にある。

## 1. バックアップ

```bash
DATABASE_URL=postgresql://app:app@localhost:5432/financial \
  RETENTION_DAYS=30 ./platform/scripts/backup.sh backups
```

- `pg_dump` の結果を gzip して、`backups/financial-YYYYmmdd-HHMMSS.sql.gz` に保存する。
- `RETENTION_DAYS`（既定30日）より古いファイルは消す。
- 毎日、cron やクラウドのスケジューラから実行する。
- `backups/` は git 管理の外にある。

## 2. 復元

```bash
DATABASE_URL=postgresql://app:app@localhost:5432/financial \
  ./platform/scripts/restore.sh backups/financial-YYYYmmdd-HHMMSS.sql.gz
```

- 復元の前に、web を止めてから行う（`docker compose -f platform/docker-compose.yml stop web`）。
- 復元のあと、web を起動すると、entrypoint が未適用のマイグレーションを適用する。
- 証憑のファイル（`/app/uploads`）は DB のバックアップに含まれない。開発環境では `uploads_data` ボリュームに残る。
