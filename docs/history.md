# 変更履歴（history.md）

決算管理システムの変更履歴を新しい順に記録する。

## 2026-06-17
- プロジェクト構成を確立。
  - ディレクトリ構成を作成: `app/`（`web` / `mobile`）, `platform/`, `docs/`。
  - **バックエンドを Next.js（App Router の Route Handlers）に決定**。FastAPI/Python 案から変更。
  - `app/web` … Next.js による Web フロントエンド + バックエンド API を作成。
    - API: `GET /api/health`, `GET/POST /api/financials`, `GET /api/forecasts`。
    - ドメインロジック: 月次集計（`lib/aggregate.ts`）、線形回帰予測（`lib/forecast.ts`）。
  - `app/mobile` … Expo / React Native の雛形を作成。
  - `platform/` … Dockerfile（web）、docker-compose（web + PostgreSQL）、`.env.example` を配置。
  - `docs/` … `design.md`（仕様）、`history.md`（本書）、`task.md`（開発タスク）を追加。
- README.md に要件定義と技術スタック選定を記載（初版）。
