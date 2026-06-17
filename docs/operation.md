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

初期ログイン: `admin@example.com` / `password`

主要画面:
- `/login` … ログイン
- `/dashboard` … KPI カード + 売上推移グラフ（予測手法・シナリオ・期間を切替）
- `/entry` … 実績データ手入力
- `/masters` … 勘定科目・部門の管理
- `/reports` … 予実対比レポート（CSV / PNG / PDF 出力）

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
`main` への push と PR 時に typecheck / build を実行する。

---

## 9. よくある操作

| やりたいこと | コマンド |
| --- | --- |
| DB を初期化して入れ直す | `npm run db:migrate` → `npm run db:seed` |
| Prisma スキーマ変更後 | `npm run db:migrate`（Client 再生成含む） |
| ヘルスチェック | `curl http://localhost:3000/api/health` |
| KPI 確認 | `curl http://localhost:3000/api/kpi` |
