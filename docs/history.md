# 変更履歴（history.md）

決算管理システムの変更履歴を新しい順に記録する。

## 2026-06-17 (Phase 4 + CI/CD 基盤)
- **Phase 4: 運用・セキュリティ強化** を実装。
  - RBAC: `lib/authz.ts` の `requireRole()` を導入。書き込み API（マスタ・実績・インポート）を editor 以上、監査ログを admin に制限。読み取り API はログイン必須に。
  - MFA: TOTP（RFC 6238）を外部依存なしで実装（`lib/totp.ts`）。`/api/auth/mfa/setup|enable|disable` と `/settings` 画面。ログインフローを MFA 対応に更新。
  - 監査ログ: `lib/audit.ts` でログイン・データ変更・MFA 操作を記録。`/api/audit-logs`（admin）と `/admin/audit` 画面。
  - User スキーマに `mfaEnabled` / `totpSecret` を追加。シードを admin/editor/viewer の 3 ロールに拡充。
- **CI/CD 基盤**を整備。
  - CI に `migrate-check` ジョブ（PostgreSQL サービス上で `prisma migrate deploy` を検証）を追加。
  - CD ワークフロー `.github/workflows/cd.yml`（GHCR へのイメージ build & push + deploy プレースホルダ）。
  - 本番用 `platform/docker-compose.prod.yml`、`app/web/.dockerignore`。
  - バックアップ / リストアスクリプト（`platform/scripts/backup.sh` / `restore.sh`、保持ポリシー対応）。
- ドキュメント: operation.md にセキュリティ・バックアップ・デプロイ節を追加。design / history / task を更新。task.md を全面的に洗い出し。

## 2026-06-17 (Phase 3)
- **Phase 3: 高度な予測・予実対比レポート・エクスポート** を実装。
  - 予測手法に Holt（二重指数平滑）と Holt-Winters（三重指数平滑・加法的季節モデル）を追加。データ不足時は自動フォールバック。`/api/forecasts` と各画面の手法選択に反映。
  - 予算モデル `budgets` を Prisma に追加（シードに月次予算を投入）。
  - 予実対比レポート: `lib/report.ts` + `GET /api/reports/budget-actual`（予算 vs 実績 vs 予測、差異・達成率・合計）。
  - エクスポート: CSV（`/api/reports/budget-actual/export`、BOM 付）、PNG（`lib/export-client.ts` で SVG→Canvas）、PDF（ブラウザ印刷）。
  - 画面 `/reports`（予実対比の複合グラフ + 表 + 出力ボタン）を追加。`middleware.ts` の保護対象にも追加。
  - design / task を更新。

## 2026-06-17 (Phase 2 + 残課題)
- **Phase 2: 予測高度化・KPI ダッシュボード・モバイル** を実装。
  - 予測手法を 3 種に拡充（移動平均 / 線形回帰 / 成長率）。`/api/forecasts` に `method`・`scenario`（楽観/標準/悲観）パラメータを追加。
  - KPI 算出ロジック（`lib/kpi.ts`）と `GET /api/kpi` を追加（売上総利益率・営業利益率・YoY・MoM・YTD）。
  - ダッシュボードに KPI カードと、予測手法・シナリオ・期間の切替 UI を追加。
  - モバイルアプリにダッシュボード（実績＋予測の折れ線、react-native-svg）を実装。共通 API を参照。
- **残課題対応**。
  - マスタ管理画面 `/masters`（勘定科目・部門の追加・一覧）を実装。
  - Excel(xlsx) インポートに対応（`lib/import.ts` で CSV/Excel を共通処理、xlsx 依存追加）。
  - 認証ミドルウェア `middleware.ts` を追加し `/dashboard` `/entry` `/masters` を保護。
  - CI（GitHub Actions: `.github/workflows/ci.yml`）で typecheck / build を自動化。
- ドキュメント: `docs/operation.md`（構築・起動・運用手順）を新規作成し情報を集約。design / task を更新。

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
