# 変更履歴（history.md）

決算管理システムの変更履歴を新しい順に記録する。

## 2026-06-24 (外部入出金・カード引落・銀行入出金の自動取得)
- 資金移動（Transfer）を一般化。出金元/入金先を null 許容にし、`channel`（口座間振込/口座引落/**カード引落**/入金/支出）と `label` を追加。
  - 入金（外部→口座）・支出/カード/口座引落（口座→外部）を同じ仕組みで扱え、フロー図・残高シミュレーションに反映。
  - `lib/transferflow.ts` を外部端点対応に、`lib/balance.ts` を null 端点対応に更新。
- 銀行入出金の自動取得を追加。
  - `bank_transactions` モデル、`lib/banksync.ts`（`BankSyncProvider` IF + モック、実 API 差し替え可）、`lib/banktxn-import.ts`（CSV、重複防止 externalId）。
  - API: `GET/POST /api/bank-accounts/:id/transactions`（取得/CSV取込）、`POST /api/bank-accounts/:id/sync`（同期）。
  - 画面 `/bank-transactions`（口座選択・自動取得・CSV取込・明細一覧）。
- `/transfers` 画面に channel・外部端点・label を追加。seed に給与入金/カード引落/家賃引落の例を追加。
- マイグレーション `20260624010000_transfer_channels_and_bank_txns`。単体テスト +6（計 55 件）。
- 注: 実銀行接続はアグリゲーション事業者の API・認証情報・外部接続が必要なため、本リポジトリではモック＋CSV取込で提供（差し替え前提）。

## 2026-06-24 (残高シミュレーション)
- 残高推移シミュレーション機能を追加。期首残高と登録済みの振込/引き落とし（毎月の日付）から、日次の残高推移を計算し残高不足日を検出。
  - `lib/balance.ts`（日次シミュレーション、月末超え日付は月末に実行、残高不足検出）。
  - `POST /api/transfers/simulate`、`/simulation` 画面（口座別期首残高入力・推移グラフ・不足警告）、`components/BalanceChart.tsx`。
  - AppShell ナビ・middleware に追加。単体テスト 4 件追加（計 49 件）。

## 2026-06-24 (口座間 資金移動フロー)
- 銀行口座間の資金移動（給与口座→引き落とし口座への振込/引き落とし等）をモデル化し、フロー図を自動生成する機能を追加。
  - Prisma に `BankAccount` / `Transfer`（種別 MANUAL/AUTO、振込日/引き落とし日 `day`）を追加。マイグレーション `20260624000000_bank_transfers`。
  - `lib/transferflow.ts`（口座→Sankey グラフ構築、循環検出 `hasCycle`）。
  - API: `GET/POST /api/bank-accounts`、`GET/POST /api/transfers`、`GET /api/transfers/flow`。
  - `/transfers` 画面（口座・振替の登録フォーム + フロー図 + 振替一覧）。AppShell ナビ・middleware・seed に追加。
  - 単体テスト 6 件追加（計 45 件）。design を更新。

## 2026-06-17 (資金フロー図 / Sankey)
- 資金フロー図機能を追加。勘定科目カテゴリ別集計から Sankey ダイアグラムを自動生成。
  - `lib/cashflow.ts`（売上→原価/総利益、総利益→販管費/営業利益のフロー構築。損失時は該当フローを除外）。
  - `GET /api/cashflow?year=`、`/cashflow` 画面（Recharts Sankey）、`components/CashFlowSankey.tsx`。
  - 単体テスト 4 件追加（計 39 件）。middleware 保護・ダッシュボード導線に追加。

## 2026-06-17 (自動ロールバック / メール通知 / deploy.md)
- CD に **失敗時の自動ロールバック**を追加。デプロイ前に稼働中イメージ ID を控え、ヘルスチェック失敗時は直前イメージへ `docker compose up -d` で復帰（DB マイグレーションは前進専用のため戻さない旨を明記）。
- **メール通知**を追加（`dawidd6/action-send-mail`）。deploy 成功/失敗を `MAIL_TO` 宛に送信（任意）。
- デプロイ設計・運用資料 `docs/deploy.md` を新規作成（全体像・ジョブ詳細・ヘルスチェック・ロールバック・通知・必要 Secrets・手動オペ）。
- README / operation / cicd / task からの導線・記述を更新。

## 2026-06-17 (デプロイ後ヘルスチェック)
- 本番 compose の web サービスに `healthcheck`（`/api/health` を Node fetch で監視）を追加。
- CD の deploy にデプロイ後ヘルスチェックを追加（`/api/health` が応答するまで最大 60 秒リトライ、失敗時は web ログ出力 + ジョブ失敗）。
- 任意の公開エンドポイント外形チェック（`HEALTHCHECK_URL` シークレット設定時）を追加。
- operation.md / cicd.md を更新（ヘルスチェック構成・必要シークレット）。

## 2026-06-17 (自動デプロイ: SSH + Docker Compose)
- CD の `deploy` ジョブを実装（プレースホルダから差し替え）。`main` push / `v*` タグで本番サーバーへ自動デプロイ。
  - compose を scp 配置 → `docker compose pull` / `up -d` → `prisma migrate deploy` → 古いイメージ掃除。
  - イメージタグ: `main` push → `:main` / `vX.Y.Z` → `:X.Y.Z`。`DEPLOY_PORT` 既定 22。
- 本番 Dockerfile を修正: `prisma generate` 実行、`prisma/` を runner に同梱（マイグレーション対応）、`npm ci`・ビルド用ダミー DATABASE_URL。
- operation.md / cicd.md にデプロイ手順・サーバー前提・必要 Secrets を追記。

## 2026-06-17 (README システム概要)
- README 冒頭に「システム概要」セクションを追加（主な機能・技術スタック・アーキテクチャ図・モノレポ構成）。リポジトリを開いた際にひと目で把握できる説明を集約。

## 2026-06-17 (手動実行項目の明記)
- README のデモ画像は SVG イメージ図のまま運用することを確定。
- task.md に「手動実行が必要な項目」セクションを追加（xlsx の lockfile 更新、実機スクショ生成、E2E のローカル検証）。サンドボックスのネットワーク制約で未実施の作業を明記。

## 2026-06-17 (デモ画像 / 公開準備)
- README に「デモ画面」セクションを追加。1920×1080 のダッシュボードのイメージ図（`docs/images/dashboard-demo.svg`）を掲載。
- 実機スクリーンショット生成スクリプト `app/web/scripts/screenshot.ts`（Playwright・1920×1080）と `npm run screenshot` を追加。`docs/images/dashboard.png` に出力。
- operation.md にスクリーンショット手順を追記。
- xlsx を公式 SheetJS CDN 配布版に変更（lockfile は CDN 到達環境で `npm install` 再実行が必要）。
- 注: 本サンドボックスはブラウザ取得が制限され実機スクショは未生成。README には差し替え用の生成手順を記載。

## 2026-06-17 (E2E テスト)
- Playwright を導入し E2E テストを実装。
  - `playwright.config.ts`（webServer 自動起動、`E2E_BASE_URL` で外部サーバー利用も可）。
  - `e2e/auth.spec.ts`: 認証ガード・ログイン画面（DB 不要）。
  - `e2e/dashboard.spec.ts`: ログイン〜ダッシュボード〜予実対比〜実績入力（要シード）。
  - スクリプト `e2e` / `e2e:install` を追加。
- CI（`ci.yml`）に `e2e` ジョブを追加（PostgreSQL で migrate + seed → build → Playwright 実行、レポート artifact 保存）。
- operation / cicd / task を更新。
- 注: 本サンドボックスではブラウザ取得が制限され E2E のローカル実行は未検証。型チェック・単体テスト・ビルドは通過。CI で実行される。

## 2026-06-17 (自動テスト + CI/CD 資料)
- Vitest を導入し、ドメインロジックの単体テストを実装（35 ケース）。
  - `aggregate` / `forecast` / `kpi` / `report` / `totp` を対象（DB 非依存）。
  - `vitest.config.ts`、`npm run test` / `test:watch` を追加。
- CI（`ci.yml`）の `web` ジョブに `test` ステップを追加。
- CI/CD 説明資料 `docs/cicd.md` を新規作成（CI/CD の構成・トリガー・ジョブ・リリース手順・シークレット）。
- README / task を更新。

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
