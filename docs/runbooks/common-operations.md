# よくある操作

開発環境（`platform/docker-compose.yml`）での、よく使う操作。起動の手順は [readme 18.7節](../../readme.md#187-クイックスタート)を参照。

| やりたいこと | コマンド |
|---|---|
| ヘルスチェック | `curl http://localhost:3000/api/health` |
| ログを見る | `docker compose -f platform/docker-compose.yml logs -f web` |
| web を作り直す | `docker compose -f platform/docker-compose.yml up -d --build web` |
| Redis のキャッシュを全部消す | `docker compose -f platform/docker-compose.yml exec redis redis-cli FLUSHALL` |
| Prisma のスキーマを変えた | `cd app/web && npm run db:migrate`（マイグレーションを作って適用し、Client を作り直す） |
| ローカルの DB を作り直す | `cd app/web && npx prisma migrate reset --force` のあと `npm run db:seed`。**全データが消える。本番では実行しない** |
| 手動でバックアップする | [backup-restore.md](backup-restore.md) |

## 必須の列を追加するマイグレーションが失敗する

既存の行がある表に、既定値のない NOT NULL の列を追加すると、マイグレーションが失敗する。

- ローカルの開発 DB なら、上の「ローカルの DB を作り直す」で初期化してから、もう一度 `npm run db:migrate` を実行する。
- 本番に関わる変更では、既定値を付けるか、列の追加 → データの埋め込み → NOT NULL の付与、と段階を分ける（ロールバックでマイグレーションは戻らないため。[design/deploy.md](../design/deploy.md)）。

## 途中で止まったマイグレーション

web の起動時に、entrypoint が `_prisma_migrations` の終わっていない行を取り消し済みにしてから `prisma migrate deploy` を実行する。それでも起動しないときは `docker compose -f platform/docker-compose.yml logs web` でエラーを確かめる。
