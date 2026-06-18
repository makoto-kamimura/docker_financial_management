# 構築・運用手順書（operation.md）

決算管理システムの **環境構築・起動・運用** に関する情報を本書に集約する。

---

## 1. 前提ソフトウェア

| ツール | バージョン目安 | 用途 |
| --- | --- | --- |
| Node.js | 22.x | Web（Next.js）/ Mobile |
| npm | 10.x 以上 | パッケージ管理 |
| Docker / Docker Compose | 最新 | PostgreSQL・コンテナ実行 |
| PostgreSQL | 16 | データベース（Docker で起動可） |

---

## 2. リポジトリ構成（再掲）

```
.
├── app/
│   ├── web/        # Next.js（フロント + バックエンドAPI）
│   └── mobile/     # Expo / React Native
├── platform/       # Docker / docker-compose / .env.example
└── docs/           # design.md / history.md / task.md / operation.md
```

---

## 3. 環境変数

`platform/.env.example` をコピーして設定する。

```bash
cp platform/.env.example platform/.env
```

| 変数 | 説明 | 例 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 接続文字列 | `postgresql://app:app@localhost:5432/financial` |
| `NODE_ENV` | 実行モード | `development` / `production` |

Web をローカルで `npm run dev` する場合は `app/web/.env` にも `DATABASE_URL` を設定する。

---

## 4. データベースの起動（Docker）

```bash
# PostgreSQL のみ起動
docker compose -f platform/docker-compose.yml up -d db
```

---

## 5. Web アプリの構築・起動

### 5.1 ローカル開発
```bash
cd app/web
npm install                  # 依存インストール
npm run db:generate          # Prisma Client 生成
npm run db:migrate           # マイグレーション（DB 起動が必要）
npm run db:seed              # 初期データ投入
npm run dev                  # http://localhost:3000
```

初期ログイン（パスワードはいずれも `password`）:

| メール | ロール | 権限 |
| --- | --- | --- |
| `admin@example.com` | admin | 全操作 + 監査ログ閲覧 |
| `editor@example.com` | editor | データ登録・編集・インポート |
| `viewer@example.com` | viewer | 閲覧のみ |

主要画面:
- `/login` … ログイン
- `/dashboard` … KPI カード + 売上推移グラフ（予測手法・シナリオ・期間を切替）
- `/entry` … 実績データ手入力
- `/masters` … 勘定科目・部門の管理
- `/reports` … 予実対比レポート（CSV / PNG / PDF 出力）
- `/settings` … 多要素認証（MFA）の設定
- `/admin/audit` … 監査ログ閲覧（admin 限定）

### 5.2 本番ビルド
```bash
cd app/web
npm run build
npm run start                # http://localhost:3000
```

### 5.3 Docker でまとめて起動（Web + DB）
```bash
docker compose -f platform/docker-compose.yml up --build
# 別ターミナルでマイグレーション・シード（初回のみ）
docker compose -f platform/docker-compose.yml exec web npm run db:migrate
docker compose -f platform/docker-compose.yml exec web npm run db:seed
```

---

## 6. データ取り込み（CSV / Excel）

ヘッダ列: `accountCode, fiscalYear, month, amount`

```bash
# CSV
curl -X POST http://localhost:3000/api/financials/import \
  -H "Content-Type: text/csv" \
  --data-binary @app/web/sample-data/financials.csv

# Excel(xlsx) はバイナリで送信（Content-Type はバイナリ系）
curl -X POST http://localhost:3000/api/financials/import \
  -H "Content-Type: application/octet-stream" \
  --data-binary @data.xlsx
```

---

## 7. モバイルアプリの起動

```bash
cd app/mobile
npm install
npm run start                # Expo Dev Server（QR から実機/シミュレータ）
```

API 接続先は `app/mobile/app.json` の `extra.apiBaseUrl` で設定する。
実機から接続する場合は `localhost` ではなく開発 PC の LAN IP を指定する。

---

## 8. 品質チェック（ローカル / CI）

```bash
cd app/web
npm run typecheck            # 型チェック
npm run test                 # 単体テスト（Vitest）
npm run build                # 本番ビルド
```

### E2E テスト（Playwright）
```bash
cd app/web
npm run e2e:install          # 初回のみ: ブラウザ(chromium)を導入
# DB を起動・初期化（DB 依存テスト用）
docker compose -f ../../platform/docker-compose.yml up -d db
npm run db:migrate && npm run db:seed
npm run build                # webServer は本番ビルドを起動するため必要
npm run e2e                  # http://localhost:3000 を自動起動して実行
```
- 既に起動中のサーバーに対して実行する場合は `E2E_BASE_URL=http://... npm run e2e`。
- テスト: `e2e/auth.spec.ts`（認証ガード・DB 不要）、`e2e/dashboard.spec.ts`（ログイン後フロー・要シード）。

### スクリーンショット（README 用デモ画像）
```bash
cd app/web
npm run e2e:install          # 初回のみ: ブラウザ導入
npm run build && npm run start &   # アプリ起動（DB は migrate + seed 済みであること）
npm run screenshot           # 1920×1080 で撮影 → docs/images/dashboard.png
```
`E2E_BASE_URL` で既存サーバーを指定可能。

CI は `.github/workflows/ci.yml`（GitHub Actions）で
`main` への push と PR 時に以下を実行する。
- `web`: 依存インストール → Prisma 生成 → typecheck → test → build
- `migrate-check`: PostgreSQL サービス上で `prisma migrate deploy` を検証
- `e2e`: PostgreSQL 上で migrate + seed → build → Playwright 実行（レポートを artifact 保存）

---

## 9. セキュリティ（RBAC / MFA / 監査ログ）

### ロール（RBAC）
| ロール | 権限 |
| --- | --- |
| admin | 全操作 + 監査ログ閲覧 |
| editor | マスタ・実績の登録/編集/インポート + 閲覧 |
| viewer | 閲覧のみ |

API は `lib/authz.ts` の `requireRole()` で保護する。
書き込み系（POST）は editor 以上、監査ログは admin のみ。

### 多要素認証（MFA / TOTP）
1. ログイン後 `/settings` で「シークレット発行」。
2. 表示された otpauth URI / シークレットを認証アプリ（Google Authenticator 等）に登録。
3. 6 桁コードを入力して有効化。以降のログインでコード入力が必須になる。

実装は外部依存なし（`lib/totp.ts`、RFC 6238 TOTP / SHA1 / 30 秒）。

### 監査ログ
ログイン・データ登録・インポート・MFA 操作を `audit_logs` に記録。
`/admin/audit`（admin 限定）または `GET /api/audit-logs` で閲覧。

---

## 10. バックアップ / リストア / 保持ポリシー

```bash
# バックアップ（保持期間を超えた古いダンプは自動削除）
DATABASE_URL=postgresql://app:app@localhost:5432/financial \
  RETENTION_DAYS=30 ./platform/scripts/backup.sh backups

# リストア
DATABASE_URL=postgresql://app:app@localhost:5432/financial \
  ./platform/scripts/restore.sh backups/financial-YYYYMMDD-HHMMSS.sql.gz
```

- 日次でのバックアップを cron / クラウドのスケジューラに登録することを推奨。
- 保持日数は `RETENTION_DAYS`（既定 30 日）で調整。

---

## 11. デプロイ（CD / 自動デプロイ：SSH + Docker Compose）

> デプロイの動作概要・設計（ロールバック / 通知含む）は [`deploy.md`](deploy.md) に集約。

`main` への push（マージ）または `v*` タグ push で `.github/workflows/cd.yml` が起動し、**自動デプロイ**される。
ヘルスチェック失敗時は**直前イメージへ自動ロールバック**し、結果を**メール通知**する（いずれも設定時）。

1. `build-and-push`: Docker イメージをビルドし GHCR（`ghcr.io/<repo>/web`）へ push。
2. `deploy`: 本番サーバーへ SSH し、
   - 本番用 `platform/docker-compose.prod.yml` を配置（scp）
   - `docker compose pull` → `up -d` で新イメージに更新
   - `docker compose run --rm web npx prisma migrate deploy` で DB マイグレーション適用
   - **デプロイ後ヘルスチェック**: `/api/health` が応答するまで最大 60 秒待機。失敗時は web ログを出力してジョブを失敗させる
   - 古いイメージを `docker image prune -f` で掃除
   - デプロイするタグ: `main` push → `:main` / `vX.Y.Z` タグ → `:X.Y.Z`
3. `External health check`（任意）: `HEALTHCHECK_URL` シークレットを設定すると、公開エンドポイントへ外形監視（200 を確認）。

> ヘルスチェックは二重構成: ①Compose の `healthcheck`（コンテナ単位で `/api/health` を定期監視）、②CD のデプロイ直後チェック（リリースの成否判定）。

### 本番サーバー側の前提
- Docker / Docker Compose v2 がインストール済み。
- `DEPLOY_PATH`（例: `/opt/financial-management`）に **`.env`** を配置（compose が自動読込）。
  ```env
  WEB_IMAGE=ghcr.io/<owner>/-financial-management/web:main
  DATABASE_URL=postgresql://<user>:<pass>@db:5432/financial
  POSTGRES_USER=<user>
  POSTGRES_PASSWORD=<pass>
  POSTGRES_DB=financial
  ```
  ※ `WEB_IMAGE` は CD 実行時に上書きされるが、手動 `docker compose` 用に置いておくとよい。

### 必要な GitHub Secrets（Settings → Secrets and variables → Actions）
| シークレット | 用途 | 必須 |
| --- | --- | --- |
| `DEPLOY_HOST` | デプロイ先サーバーのホスト/IP | ✅ |
| `DEPLOY_USER` | SSH ユーザー名 | ✅ |
| `DEPLOY_SSH_KEY` | SSH 秘密鍵（対応する公開鍵をサーバーに登録） | ✅ |
| `DEPLOY_PATH` | サーバー上の配置ディレクトリ（compose / .env の場所） | ✅ |
| `DEPLOY_PORT` | SSH ポート（未設定時は 22） | 任意 |
| `GHCR_USER` / `GHCR_PAT` | GHCR が private の場合のサーバー側ログイン（public なら不要） | 任意 |
| `HEALTHCHECK_URL` | デプロイ後の公開エンドポイント外形チェック先（例: `https://example.com/api/health`） | 任意 |
| `GITHUB_TOKEN` | GHCR への push（Actions が自動付与） | 自動 |

> `production` 環境（`environment: production`）に required reviewers を設定すれば、デプロイ前に承認を挟める。
> 初回はサーバーで `docker compose -f platform/docker-compose.prod.yml up -d db` などで DB を用意し、`db:seed` 相当の初期投入を行う。

---

## 12. よくある操作

| やりたいこと | コマンド |
| --- | --- |
| DB を初期化して入れ直す | `npm run db:migrate` → `npm run db:seed` |
| Prisma スキーマ変更後 | `npm run db:migrate`（Client 再生成含む） |
| ヘルスチェック | `curl http://localhost:3000/api/health` |
| バックアップ | `./platform/scripts/backup.sh` |
