# 構築・運用手順書（operation.md）

決算管理システムの **環境構築・起動・運用** に関する情報を集約する。

---

## 1. 前提ソフトウェア

| ツール | バージョン目安 | 用途 |
|---|---|---|
| Node.js | 22.x | Web（Next.js）/ Mobile |
| npm | 10.x 以上 | パッケージ管理 |
| Docker / Docker Compose | v2 以上 | PostgreSQL・Redis・コンテナ実行 |
| PostgreSQL | 16 | データベース（Docker で起動可） |
| Redis | 7 | キャッシュ（Docker で起動可） |

---

## 2. リポジトリ構成

```
.
├── app/
│   ├── web/        # Next.js（フロント + バックエンドAPI）
│   └── mobile/     # Expo / React Native
├── platform/
│   ├── docker/
│   ├── docker-compose.yml        # 開発環境（web + db + redis）
│   ├── docker-compose.prod.yml   # 本番環境
│   └── scripts/                  # backup.sh / restore.sh
└── docs/
    ├── design.md / task.md / history.md / operation.md / cicd.md / deploy.md
```

---

## 3. 環境変数

`platform/.env.example` をコピーして設定する。

```bash
cp platform/.env.example platform/.env
```

| 変数 | 説明 | 例 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 接続文字列 | `postgresql://app:app@localhost:5432/financial` |
| `REDIS_URL` | Redis 接続文字列 | `redis://localhost:6379` |
| `NODE_ENV` | 実行モード | `development` / `production` |

Web をローカルで `npm run dev` する場合は `app/web/.env` にも設定する。

---

## 4. Docker で起動（推奨）

```bash
# ビルド & 起動（web + db + redis）
docker compose -f platform/docker-compose.yml up --build

# 初回のみ: マイグレーション + シード
docker compose -f platform/docker-compose.yml exec web npm run db:migrate
docker compose -f platform/docker-compose.yml exec web npm run db:seed
```

---

## 5. ローカル開発

```bash
# DB・Redis だけ Docker で起動
docker compose -f platform/docker-compose.yml up -d db redis

cd app/web
npm install                  # 依存インストール（redis パッケージ含む）
npm run db:generate          # Prisma Client 生成
npm run db:migrate           # マイグレーション（DB 起動が必要）
npm run db:seed              # 初期データ投入
npm run dev                  # http://localhost:3000
```

---

## 6. 初期ログインアカウント

パスワードはいずれも `password`。

| メール | ロール | 権限 |
|---|---|---|
| `admin@example.com`      | admin      | 全操作 + ユーザー管理 + 監査ログ |
| `editor@example.com`     | editor     | データ登録・編集・削除 |
| `viewer@example.com`     | viewer     | 閲覧のみ |

accountant ロールは `/admin/users` でロール変更して使用する。

---

## 7. 主要画面

| URL | 画面名 |
|---|---|
| `/login` | ログイン（MFA 対応） |
| `/dashboard` | KPI カード + 予実推移グラフ・予測 |
| `/entry` | 実績管理（CSV インポート・手入力） |
| `/assets` | 資産管理（純資産推移グラフ） |
| `/budget` | 予算管理 |
| `/reports` | 予実対比レポート |
| `/journals` | 仕訳帳（承認ワークフロー付き） |
| `/journal-templates` | 仕訳テンプレート |
| `/reports/ledger` | 総勘定元帳（CSV 出力） |
| `/receivables` / `/payables` | 売掛金・買掛金管理 |
| `/invoices` | インボイス（適格請求書）発行 |
| `/inventories` | 棚卸管理（評価方法・品目種別） |
| `/fixed-assets` | 固定資産管理 |
| `/apportionments` | 家事按分管理 |
| `/bank-accounts` / `/loans` | 銀行・資金管理・借入金管理 |
| `/closing` | 決算処理（P/L・B/S・財務分析） |
| `/closing/print` | 青色申告書類 印刷 |
| `/closing/corporate-print` | 法人決算書類 印刷（P/L・B/S・S/S・法人税概算） |
| `/corporate` | 法人・事業者情報管理 |
| `/fiscal-years` | 会計年度管理 |
| `/governance` | 法人ガバナンス管理（役員・株主総会・配当・決算公告） |
| `/masters` | マスタ管理（勘定科目・部門・会計期間） |
| `/settings` | 設定（事業者情報・消費税設定・MFA） |
| `/linked-accounts` | 口座・カード管理 |
| `/integrations` | 外部サービス連携（freee / MF / オープンバンキング） |
| `/portal` | 税理士ポータル（accountant 以上） |
| `/admin/users` | ユーザー管理（admin） |
| `/admin/audit` | 監査ログ（admin） |

---

## 8. データ取り込み（CSV / Excel）

ヘッダ列: `accountCode, fiscalYear, month, amount`

```bash
# CSV
curl -X POST http://localhost:3000/api/financials/import \
  -H "Content-Type: text/csv" \
  --data-binary @app/web/sample-data/financials.csv

# Excel(xlsx)
curl -X POST http://localhost:3000/api/financials/import \
  -H "Content-Type: application/octet-stream" \
  --data-binary @data.xlsx
```

---

## 9. モバイルアプリの起動

```bash
cd app/mobile
npm install
npm run start    # Expo Dev Server（QR から実機/シミュレータ）
```

API 接続先は `app/mobile/app.json` の `extra.apiBaseUrl` で設定する。
実機から接続する場合は `localhost` → 開発 PC の LAN IP に変更する。

---

## 10. 品質チェック

```bash
cd app/web
npm run typecheck            # TypeScript 型チェック
npm run test                 # 単体テスト（Vitest）
npm run lint                 # ESLint
npm run format:check         # Prettier
npm run build                # 本番ビルド
```

### E2E テスト（Playwright）

```bash
cd app/web
npm run e2e:install          # 初回のみ: ブラウザ(chromium)を導入
docker compose -f ../../platform/docker-compose.yml up -d db redis
npm run db:migrate && npm run db:seed
npm run build
npm run e2e                  # http://localhost:3000 を自動起動して実行
```

既に起動中のサーバーに対しては `E2E_BASE_URL=http://... npm run e2e`。

---

## 11. セキュリティ（RBAC / MFA / 監査ログ）

### ロール（RBAC）

| ロール | ランク | 主な権限 |
|---|---|---|
| viewer | 1 | 閲覧のみ |
| accountant | 2 | viewer + 仕訳承認ワークフロー |
| editor | 3 | accountant + データ登録・編集・削除 |
| admin | 4 | editor + ユーザー管理・監査ログ閲覧 |

API は `lib/authz.ts` の `requireRole()` で保護する。

### 多要素認証（MFA / TOTP）

1. ログイン後 `/settings` で「シークレット発行」。
2. 表示された otpauth URI を認証アプリ（Google Authenticator 等）に登録。
3. 6 桁コードを入力して有効化。以降のログインでコード入力が必須。

実装は外部依存なし（`lib/totp.ts`、RFC 6238 TOTP / SHA1 / 30 秒）。

### 電子帳簿保存法対応（仕訳承認ワークフロー）

1. editor が仕訳を作成（`approvalStatus: approved` が初期値）。
2. 承認申請ボタンで `pending` に遷移。
3. accountant / admin が `/journals` 画面で承認（`approved`）または差戻し（`rejected`）。
4. 承認履歴は `journal_approvals` テーブルで保持。

---

## 12. バックアップ / リストア

```bash
# バックアップ（30 日以上古いダンプは自動削除）
DATABASE_URL=postgresql://app:app@localhost:5432/financial \
  RETENTION_DAYS=30 ./platform/scripts/backup.sh backups

# リストア
DATABASE_URL=postgresql://app:app@localhost:5432/financial \
  ./platform/scripts/restore.sh backups/financial-YYYYMMDD-HHMMSS.sql.gz
```

日次 cron / クラウドスケジューラへの登録を推奨。

---

## 13. Redis キャッシュ

Docker Compose 起動時に自動で Redis が起動する。

| 対象 API | キャッシュキー | TTL |
|---|---|---|
| `/api/closing/statements` | `closing:statements:{year}` | 1 時間 |
| `/api/reports/general-ledger` | `reports:ledger:{year}:{accountId}` | 1 時間 |

決算確定（`/api/closing/finalize`）後に該当年度のキャッシュが無効化されることが理想的だが、
現状は TTL 切れまで古いデータが返る。重要な操作後は Redis を再起動するか TTL を待つ。

Redis 接続失敗時はキャッシュなしで DB から直接取得する（フォールスルー）。

---

## 14. デプロイ（CD / 自動デプロイ）

> 詳細は [`deploy.md`](deploy.md) を参照。

`main` への push または `v*` タグ push で `.github/workflows/cd.yml` が起動し自動デプロイされる。
ヘルスチェック失敗時は直前イメージへ自動ロールバックし、結果をメール通知する。

### 本番サーバーの前提

- Docker / Docker Compose v2 インストール済み。
- `DEPLOY_PATH` に `.env` を配置（`DATABASE_URL`, `REDIS_URL`, `POSTGRES_*` 等）。

### 必要な GitHub Secrets

| シークレット | 用途 | 必須 |
|---|---|---|
| `DEPLOY_HOST` | デプロイ先サーバーホスト/IP | ✅ |
| `DEPLOY_USER` | SSH ユーザー名 | ✅ |
| `DEPLOY_SSH_KEY` | SSH 秘密鍵 | ✅ |
| `DEPLOY_PATH` | サーバー上の配置ディレクトリ | ✅ |
| `DEPLOY_PORT` | SSH ポート（未設定時は 22） | 任意 |
| `HEALTHCHECK_URL` | 外形監視エンドポイント | 任意 |
| `GITHUB_TOKEN` | GHCR への push（Actions 自動付与） | 自動 |

---

## 15. よくある操作

| やりたいこと | コマンド |
|---|---|
| DB を初期化して入れ直す | `npm run db:migrate` → `npm run db:seed` |
| Prisma スキーマ変更後 | `npm run db:generate`（Client 再生成）→ マイグレーション SQL 作成 → DB 適用 |
| Redis キャッシュを全削除 | `docker exec platform-redis-1 redis-cli FLUSHALL` |
| ヘルスチェック | `curl http://localhost:3000/api/health` |
| Docker 再ビルド | `docker compose -f platform/docker-compose.yml build web` |
| ログ確認 | `docker compose -f platform/docker-compose.yml logs -f web` |
| 手動バックアップ | `./platform/scripts/backup.sh backups` |
