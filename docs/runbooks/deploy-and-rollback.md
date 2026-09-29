# デプロイとロールバック

本番へのリリースと、手動でのロールバックの手順。仕組みは [design/deploy.md](../design/deploy.md) を参照。

## 1. リリースする

1. 機能ブランチから PR を作る。CI（整形・lint・型・単体テスト・ビルド・マイグレーションの確認・E2E）が通ることを確かめる。
2. `main` にマージする。CD（`.github/workflows/cd.yml`）が起動し、イメージの push → 本番の compose の更新 → マイグレーション → ヘルスチェックまで自動で進む。
3. Actions の結果と通知メール（`MAIL_TO` を設定している場合）で、成否を確かめる。
4. バージョンを付けて配信するときは、タグを push する（`:X.Y.Z` のイメージが使われる）。

   ```bash
   git tag vX.Y.Z && git push --tags
   ```

## 2. 自動ロールバックが起きたとき

ヘルスチェックに失敗すると、CD は直前のイメージに戻して、ジョブを失敗で終える。

1. Actions のログで、`docker compose logs web` の出力を確かめる。
2. **DB のマイグレーションは戻らない。** 新しいマイグレーションが適用済みで、古いイメージがそれに対応していないときは、直したイメージを出し直すか、[バックアップから復元](backup-restore.md)する。
3. 原因を直して、もう一度リリースする。障害として記録するときは [incidents/](../incidents/) に `YYYY-MM-DD-<概要>.md` を作る。

## 3. 手動でロールバックする

```bash
cd "$DEPLOY_PATH"

# 稼働中のイメージを確かめる
docker compose -f platform/docker-compose.prod.yml images web

# 特定のバージョンに戻す
WEB_IMAGE=ghcr.io/<owner>/<repo>/web:1.2.2 \
  docker compose -f platform/docker-compose.prod.yml up -d web

# ヘルスチェック
curl -fsS http://localhost:3000/api/health
```

`WEB_IMAGE` の `<owner>/<repo>` は、GitHub のリポジトリ（`ghcr.io/${{ github.repository }}/web`）に合わせる。
