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
npm run build                # 本番ビルド
```

CI は `.github/workflows/ci.yml`（GitHub Actions）で
`main` への push と PR 時に以下を実行する。
- `web`: 依存インストール → Prisma 生成 → typecheck → build
- `migrate-check`: PostgreSQL サービス上で `prisma migrate deploy` を検証

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

## 11. デプロイ（CD）

- `.github/workflows/cd.yml` が `main` マージ / `v*` タグ push で起動。
- Docker イメージをビルドし GHCR（`ghcr.io/<repo>/web`）に push。
- `deploy` ジョブは基盤に合わせて実装する（プレースホルダ）。例:
  - SSH + `docker compose -f platform/docker-compose.prod.yml pull && up -d`
  - AWS ECS / Google Cloud Run へのイメージ反映
  - Kubernetes（`kubectl set image` / `helm upgrade`）
- 本番用 Compose は `platform/docker-compose.prod.yml`。機密値は環境変数 / シークレットで注入する。

### 必要なシークレット（例）
| シークレット | 用途 |
| --- | --- |
| `GITHUB_TOKEN` | GHCR への push（自動付与） |
| `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` | SSH デプロイ時 |
| `DATABASE_URL` | 本番 DB 接続 |

---

## 12. よくある操作

| やりたいこと | コマンド |
| --- | --- |
| DB を初期化して入れ直す | `npm run db:migrate` → `npm run db:seed` |
| Prisma スキーマ変更後 | `npm run db:migrate`（Client 再生成含む） |
| ヘルスチェック | `curl http://localhost:3000/api/health` |
| バックアップ | `./platform/scripts/backup.sh` |
