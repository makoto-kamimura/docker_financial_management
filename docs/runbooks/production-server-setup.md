# 本番サーバーの準備

CD（`.github/workflows/cd.yml`）で自動デプロイできるように、本番サーバーと GitHub の設定を整える手順。仕組みは [design/deploy.md](../design/deploy.md) を参照。

## 1. サーバーを用意する

1. Docker と Docker Compose v2 を入れる。
2. デプロイ用のユーザーを作る（専用のユーザーを推奨）。
3. 配置するディレクトリ（`DEPLOY_PATH`）を作り、`.env` を置く。compose はこれを自動で読む。

   ```env
   WEB_IMAGE=ghcr.io/<owner>/<repo>/web:main
   DATABASE_URL=postgresql://<user>:<pass>@db:5432/financial
   POSTGRES_USER=<user>
   POSTGRES_PASSWORD=<pass>
   POSTGRES_DB=financial
   ```

   - 初回の起動時に、web の entrypoint がマイグレーションを適用し、ユーザーが1人もいなければ初期データ（デモテナントとデモユーザー）を入れる。本番で使う前に、デモユーザーのパスワードを変えるか削除する。
   - 本番の compose は今、`DATABASE_URL` と `NODE_ENV` しか web に渡さない。`APP_ORIGIN`・`REDIS_URL`・`CLEANUP_SERVICE_KEY` などを使うには compose の見直しが要る（[readme 25章](../../readme.md#25-未決事項)・[tasks/task.md](../tasks/task.md)）。

## 2. SSH の鍵を登録する

1. 鍵の組を作る。

   ```bash
   ssh-keygen -t ed25519 -f deploy_key -N "" -C "github-actions-deploy"
   ```

2. 公開鍵をサーバーに登録する。

   ```bash
   ssh-copy-id -i deploy_key.pub <デプロイユーザー>@<サーバー>
   ```

3. `ssh -i deploy_key <デプロイユーザー>@<サーバー>` で接続できることを確かめる。

## 3. GitHub Secrets を登録する

`cd.yml` は `environment: production` を使うので、**Repository ではなく Environment（production）の Secrets** に登録する。

1. GitHub のリポジトリで **Settings → Environments → `production`** を開く（なければ作る）。
2. 「Environment secrets」に次を登録する。`DEPLOY_SSH_KEY` には秘密鍵 `deploy_key` の中身を改行ごと貼る。

   | シークレット | 値 | 必須 |
   |---|---|---|
   | `DEPLOY_HOST` | サーバーの IP / ホスト名 | ✅ |
   | `DEPLOY_USER` | デプロイ用のユーザー | ✅ |
   | `DEPLOY_SSH_KEY` | 秘密鍵の内容 | ✅ |
   | `DEPLOY_PATH` | 配置するディレクトリ | ✅ |
   | `DEPLOY_PORT` | SSH のポート（既定 22） | 任意 |
   | `GHCR_USER` / `GHCR_PAT` | GHCR のパッケージが非公開のときの、サーバー側のログイン | 任意 |
   | `HEALTHCHECK_URL` | 外から確かめる URL | 任意 |
   | `MAIL_SERVER` / `MAIL_PORT` / `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_FROM` / `MAIL_TO` | 結果の通知メール | 任意 |

3. 手元の秘密鍵 `deploy_key` は、コミットせずに消す。
4. Actions でワークフローを再実行（`workflow_dispatch`）し、`Copy compose file to server` から最後まで通ることを確かめる。
