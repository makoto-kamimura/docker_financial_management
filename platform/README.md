# platform

カケイカイケイのインフラ・実行基盤のファイルを置く。構成の説明は [readme 18.6節](../readme.md#186-docker-compose-の構成)、起動の手順は [18.7節](../readme.md#187-クイックスタート) を参照。

## 内容

| パス | 内容 |
|---|---|
| `docker-compose.yml` | 開発環境（web・db・redis・session-cleanup） |
| `docker-compose.prod.yml` | 本番環境（web・db）。CD がサーバーに置く |
| `docker/web.Dockerfile` | web のイメージ |
| `docker/entrypoint.sh` | web の起動処理（マイグレーションの適用、空の DB への初期データの投入） |
| `scripts/backup.sh` / `scripts/restore.sh` | DB のバックアップと復元（[docs/runbooks/backup-restore.md](../docs/runbooks/backup-restore.md)） |
| `.env.example` | 環境変数の例 |
| `db/` | 開発環境の DB のデータ（git 管理外） |

## 使い方

```bash
cp platform/.env.example platform/.env
docker compose -f platform/docker-compose.yml up -d --build
# Web: http://localhost:3000
```
