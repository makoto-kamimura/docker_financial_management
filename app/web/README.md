# app/web

決算管理システムの **Web アプリケーション**。Next.js (App Router) で
フロントエンド（ダッシュボード・グラフ）と **バックエンド API**（Route Handlers）を提供する。

## 構成

- `src/app/` … 画面
  - `/` トップ、`/login` ログイン、`/dashboard` 推移グラフ、`/entry` 実績入力
- `src/app/api/` … バックエンド API（Route Handlers）
  - `GET /api/health` … ヘルスチェック
  - `GET/POST /api/accounts` `/api/departments` `/api/periods` … マスタ管理
  - `GET /api/financials?granularity=month|quarter|year` … 実績の集計
  - `POST /api/financials` … 実績の手入力登録
  - `POST /api/financials/import` … CSV 一括取り込み（本文に CSV）
  - `GET /api/forecasts?accountCode=4000&months=6` … 将来推移の予測
  - `POST /api/auth/login` `/api/auth/logout`, `GET /api/auth/me` … 認証
- `src/lib/` … 集計（`aggregate.ts`）・予測（`forecast.ts`）・認証（`auth.ts`）・Prisma クライアント
- `prisma/` … スキーマ（`schema.prisma`）とシード（`seed.ts`）
- `sample-data/financials.csv` … インポート用サンプル

## 開発

```bash
npm install
npm run db:generate          # Prisma Client 生成
npm run db:migrate           # マイグレーション（PostgreSQL 必要）
npm run db:seed              # 初期データ投入（admin@example.com / password）
npm run dev                  # http://localhost:3000
npm run typecheck
```

DB は `platform/docker-compose.yml` で起動できる（PostgreSQL）。
接続情報は環境変数 `DATABASE_URL` で設定する。

### CSV インポート例

```bash
curl -X POST http://localhost:3000/api/financials/import \
  -H "Content-Type: text/csv" --data-binary @sample-data/financials.csv
```
