# 変更履歴（history.md）

決算管理システムの変更履歴を新しい順に記録する。

## 2026-06-17 (Phase 1)
- **Phase 1: データ管理・基本集計・推移グラフ・認証** を実装。
  - Prisma スキーマを定義（accounts / departments / periods / financial_records / forecasts / users / sessions / audit_logs）＋シード（`prisma/seed.ts`）。
  - マスタ管理 API を追加: `accounts` / `departments` / `periods`（GET・POST）。
  - 実績 API を Prisma 化し、月次 / 四半期 / 年次の粒度別集計に対応（`GET /api/financials?granularity=`）。手入力登録（POST）も対応。
  - CSV 一括取り込み API を追加（`POST /api/financials/import`、papaparse + Zod）。
  - 予測 API を DB 実績ベースに変更（`/api/forecasts`）。
  - 認証基盤を追加: scrypt パスワードハッシュ + DB セッション + httpOnly Cookie。`login` / `logout` / `me` API。
  - 画面を追加: `/login`、`/dashboard`（Recharts 推移グラフ、実績＋予測）、`/entry`（手入力フォーム）。React Query プロバイダを導入。
  - `集計ロジック（aggregate.ts）` を粒度対応にリファクタ。
  - 依存追加: prisma, @prisma/client, papaparse, tsx。

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
