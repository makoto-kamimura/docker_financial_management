# 自動デプロイ 設計・運用資料（deploy.md）

決算管理システムの **自動デプロイ（CD）** の動作概要と設計をまとめる。
CI 全体の構成は [`cicd.md`](cicd.md)、起動・サーバー手順は [`operation.md`](operation.md) を参照。

---

## 1. 概要

`main` への push（PR マージ）または `v*` タグ push を契機に、GitHub Actions が
Docker イメージをビルドして GHCR に公開し、本番サーバーへ **SSH + Docker Compose** で反映する。
デプロイ後は **ヘルスチェック**で成否を判定し、**失敗時は直前イメージへ自動ロールバック**、
結果は **メール通知**する。

| 項目 | 内容 |
| --- | --- |
| トリガー | `push`（`main` / `v*` タグ）、`workflow_dispatch`（手動） |
| ビルド成果物 | Docker イメージ（`ghcr.io/<repo>/web`） |
| デプロイ方式 | SSH 経由で本番サーバーの `docker compose` を更新 |
| デプロイ単位 | `app/web`（Next.js）コンテナ + PostgreSQL |
| 定義ファイル | `.github/workflows/cd.yml` / `platform/docker-compose.prod.yml` / `platform/docker/web.Dockerfile` |

---

## 2. パイプライン全体

```
push(main) / tag(v*)
      │
      ▼
┌─────────────────────────────┐
│ job: build-and-push         │
│  - GHCR ログイン            │
│  - タグ算出(metadata-action)│
│  - Docker ビルド & push     │
└─────────────┬───────────────┘
              ▼
┌──────────────────────────────────────────────┐
│ job: deploy (environment: production)         │
│  1. compose を scp 配置                        │
│  2. SSH:                                       │
│     - 現行 web イメージID を控える(ロールバック用)│
│     - docker compose pull / up -d              │
│     - prisma migrate deploy                    │
│     - ヘルスチェック(/api/health, 最大60秒)     │
│        ├─ OK  → 古いイメージ prune             │
│        └─ NG  → 直前イメージへ自動ロールバック  │
│                 → exit 1                        │
│  3. 外形ヘルスチェック(HEALTHCHECK_URL 任意)    │
│  4. メール通知(成功/失敗, MAIL_TO 任意)         │
└──────────────────────────────────────────────┘
```

---

## 3. ジョブ詳細

### 3.1 build-and-push
- `docker/login-action` で GHCR にログイン（`GITHUB_TOKEN`、`packages: write`）。
- `docker/metadata-action` でタグを算出。
  - ブランチ名（`main`）/ セマンティックバージョン（`v1.2.3`→`1.2.3`）/ コミット SHA。
- `docker/build-push-action` で `platform/docker/web.Dockerfile` をビルドして push。

### 3.2 deploy
- `environment: production`（required reviewers を付ければ承認制にできる）。
- **イメージ参照の決定**: `main` push → `:main` / `vX.Y.Z` → `:X.Y.Z`。
- **compose 配置**: `appleboy/scp-action` で `docker-compose.prod.yml` を `DEPLOY_PATH` へ。
- **更新**: `appleboy/ssh-action` で SSH し、`pull` → `up -d` → `prisma migrate deploy`。

---

## 4. ヘルスチェック（二重構成）

| 層 | 仕組み | 目的 |
| --- | --- | --- |
| コンテナ | `docker-compose.prod.yml` の `healthcheck`（`/api/health` を Node fetch、30 秒間隔） | 常時のコンテナ健全性監視・`restart: always` と連携 |
| リリース | deploy 内でデプロイ直後に `/api/health` を最大 60 秒リトライ | 新リリースの稼働確認・成否判定 |
| 外形（任意） | `HEALTHCHECK_URL` 設定時、公開 URL へ 200 確認 | 外部到達性のエンドツーエンド確認 |

監視対象エンドポイント: `GET /api/health` → `{"status":"ok","timestamp":...}`。

---

## 5. 自動ロールバック

### 動作
1. デプロイ前に、稼働中 web コンテナの **イメージ ID**（`docker inspect {{.Image}}`）を控える。
2. 新イメージで起動・マイグレーション後、ヘルスチェックを実施。
3. **失敗した場合**、控えたイメージ ID を `WEB_IMAGE` に指定して `docker compose up -d web` で**直前バージョンへ戻す**。
4. ロールバック後も再度ヘルスチェックし、結果をログ出力。ジョブ自体は `exit 1`（失敗）で終了。

### 設計上の注意（重要）
- ロールバックは **アプリコンテナ（イメージ）単位**で行う。**DB マイグレーションは戻さない**（Prisma migrate は前進専用）。
  - そのため、スキーマ変更は **後方互換**（旧コードでも動く）を原則とする（例: カラム追加は可、破壊的変更は段階移行）。
- 初回デプロイ（前イメージ無し）はロールバック対象が無いため、ログに警告を出して失敗終了する。
- 古いイメージは **成功時のみ** `docker image prune -f` で掃除するため、失敗時のロールバック対象は保持される。

---

## 6. メール通知

- `dawidd6/action-send-mail` を使用し、deploy ジョブの最後に **成功 / 失敗**を送信。
- `MAIL_TO` 未設定時は通知ステップをスキップ（任意機能）。
- 本文にはリポジトリ・参照・コミット・実行ログ URL を含める。
- 補足: GitHub は標準でもワークフロー失敗時に実行者へ通知メールを送る（本機能は宛先固定の明示通知）。

---

## 7. 必要な GitHub Secrets

| シークレット | 用途 | 必須 |
| --- | --- | --- |
| `DEPLOY_HOST` | デプロイ先ホスト/IP | ✅ |
| `DEPLOY_USER` | SSH ユーザー | ✅ |
| `DEPLOY_SSH_KEY` | SSH 秘密鍵 | ✅ |
| `DEPLOY_PATH` | サーバー上の配置先（compose / `.env`） | ✅ |
| `DEPLOY_PORT` | SSH ポート（既定 22） | 任意 |
| `GHCR_USER` / `GHCR_PAT` | GHCR private 時のサーバー側ログイン | 任意 |
| `HEALTHCHECK_URL` | 外形チェック先 URL | 任意 |
| `MAIL_SERVER` / `MAIL_PORT` | SMTP サーバー / ポート | メール通知時 |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | SMTP 認証 | メール通知時 |
| `MAIL_FROM` / `MAIL_TO` | 送信元 / 宛先 | メール通知時 |
| `GITHUB_TOKEN` | GHCR push（自動付与） | 自動 |

---

## 8. 本番サーバーの前提

- Docker / Docker Compose v2 インストール済み。
- `DEPLOY_PATH` に **`.env`**（compose が自動読込）:
  ```env
  WEB_IMAGE=ghcr.io/<owner>/-financial-management/web:main
  DATABASE_URL=postgresql://<user>:<pass>@db:5432/financial
  POSTGRES_USER=<user>
  POSTGRES_PASSWORD=<pass>
  POSTGRES_DB=financial
  ```
- 初回は DB を起動し初期データを投入（`operation.md` 参照）。

---

## 9. リリース手順

1. 機能ブランチ → PR（CI 実行）→ レビュー。
2. `main` にマージ → CD が起動し本番へ自動デプロイ。
3. デプロイ後ヘルスチェック・通知で結果を確認。
4. バージョン付与する場合は `git tag vX.Y.Z && git push --tags`（`:X.Y.Z` イメージで配信）。

---

## 10. 手動オペレーション

```bash
# サーバー上で特定バージョンへ手動ロールバック
cd "$DEPLOY_PATH"
WEB_IMAGE=ghcr.io/<owner>/-financial-management/web:1.2.2 \
  docker compose -f platform/docker-compose.prod.yml up -d web

# 稼働中イメージの確認
docker compose -f platform/docker-compose.prod.yml images web

# 手動ヘルスチェック
curl -fsS http://localhost:3000/api/health
```

---

## 11. 今後の拡張余地（task.md 参照）

- Blue/Green・カナリアデプロイ、ゼロダウンタイム切替（ロードバランサ前段）。
- マイグレーションの後方互換運用ガイドライン整備、失敗時の DB スナップショット復元手順。
- 通知の多重化（メール + チャット）、外形監視の常時化（Uptime 監視）。
