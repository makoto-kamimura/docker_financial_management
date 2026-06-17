# app/web

決算管理システムの **Web アプリケーション**。Next.js (App Router) で
フロントエンド（ダッシュボード・グラフ）と **バックエンド API**（Route Handlers）を提供する。

## 構成
- `src/app/` … 画面（React Server / Client Components）
- `src/app/api/` … バックエンド API（Route Handlers）
  - `GET /api/health` … ヘルスチェック
  - `GET/POST /api/financials` … 実績データの取得・登録
  - `GET /api/forecasts?months=N` … 将来推移の予測
- `src/lib/` … 集計・予測などのドメインロジック

## 開発
```bash
npm install
npm run dev      # http://localhost:3000
npm run typecheck
```
