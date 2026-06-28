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
---

## 2026-06-21（残タスク完了・ドキュメント整備）

### 実装
- **在庫管理の高度化**（フェーズ 3）
  - `inventories.valuationMethod`（最終仕入原価法 / 総平均法 / 移動平均法）を追加
  - `inventory_items.itemType`（商品 / 原材料 / 仕掛品 / 製品）を追加
  - `/inventories` 画面に評価方法セレクト・区分列を追加
- **仕入税額控除管理**（フェーズ 4）
  - `journal_details` に `taxRate` / `taxCreditEligible` フィールドを追加
  - `GET /api/tax-credit?year=` で適格 / 非適格別の消費税集計 API を実装
- **電子帳簿保存法対応**（フェーズ 7）
  - `journal_entries.approvalStatus`（draft / pending / approved / rejected）を追加
  - `journal_approvals` テーブル追加（承認アクション履歴）
  - `POST /api/journals/approve`（承認申請 / 承認 / 差戻し）
  - `GET /api/journals/approve?status=&year=&q=`（全文検索対応）
  - `/journals` 画面に承認ステータス表示・ボタンを追加
- **Redis 導入**（フェーズ 8）
  - Docker Compose に Redis 7-alpine サービスを追加（`REDIS_URL` 環境変数）
  - `src/lib/redis.ts` キャッシュユーティリティ実装（接続失敗時はフォールスルー）
  - `/api/closing/statements` と `/api/reports/general-ledger` に TTL 1 時間のキャッシュを適用
- **法人向け決算書出力**（フェーズ 5）
  - `/closing/corporate-print` ページ新設
    - 損益計算書（P/L）・貸借対照表（B/S）・株主資本等変動計算書（S/S）
    - 財務指標注記（流動比率・ROA/ROE 等）・法人税概算申告資料
  - `/closing` ページに「法人決算書類」ボタンを追加
- `task.md` 個人事業主フェーズの完了チェック漏れを修正
- ドキュメント全体を現状に合わせて大幅更新（design.md / history.md / operation.md / task.md）

---

## 2026-06-21（法人・統合会計機能 フェーズ 1〜7）

### 実装
- **マルチテナント基盤**（フェーズ 1）
  - `tenants` テーブル（SOLE_PROPRIETOR / CORPORATION）、`/api/tenants`、`/corporate` 管理画面
  - `fiscal_years` テーブル、`/api/fiscal-years`、`/fiscal-years` 管理画面
  - `accountant` ロールを `authz.ts` に追加（RANK: viewer=1, accountant=2, editor=3, admin=4）
- **会計帳簿機能強化**（フェーズ 2）
  - `journal_templates` / `journal_template_lines`、`/api/journal-templates`、`/journal-templates` 画面
  - AI 仕訳提案: `POST /api/journals/suggest`（過去パターン + キーワードルール）
  - 総勘定元帳: `GET /api/reports/general-ledger`（JSON / CSV）、`/reports/ledger` 画面
  - 試算表: `GET /api/reports/trial-balance`（JSON / CSV）
- **在庫・銀行・借入金管理**（フェーズ 3）
  - `bank_accounts` / `bank_transactions`、`/api/bank-accounts`、`/bank-accounts` 画面
  - `loans` / `loan_repayments`、`/api/loans`、`/loans` 画面
  - `accrued_revenues` / `accrued_expenses`（未収金・未払金）
- **消費税・インボイス強化**（フェーズ 4）
  - `invoices` / `invoice_lines`、`/api/invoices`、`/invoices` 画面（請求番号自動採番）
- **財務分析指標**（フェーズ 7）
  - `/api/closing/statements` に `ratios`（流動比率・自己資本比率・ROA・ROE・売上総利益率・営業利益率）を追加
  - `/closing` 画面に「財務分析」タブを追加
- **法人ガバナンス機能**（フェーズ 6）
  - `officers` / `shareholder_meetings` / `dividends` / `announcements`
  - `/governance` 画面（4 タブ：役員・株主総会・配当・決算公告）

---

## 2026-06-21（個人事業主・確定申告支援機能 フェーズ 1〜4）

### 実装
- **基盤整備**（フェーズ 1）
  - `business_profiles`、`GET/PUT /api/business-profile`、`/settings` 画面
  - `journal_entries` / `journal_details`（複式簿記）、`GET/POST /api/journals`
  - 個人事業主向け勘定科目 seed（`prisma/seed-business-accounts.ts`）
  - `tax_settings`（免税 / 原則課税 / 簡易課税）、`GET/PUT /api/tax-settings`
- **資産・経費管理**（フェーズ 2）
  - `receipts`（証憑ファイル）、Docker volume `uploads_data`
  - `inventories` / `inventory_items`、`fixed_assets` / `depreciations`、`apportionments`
- **債権債務管理**（フェーズ 3）
  - `receivables`（売掛金）、`payables`（買掛金）、入金・支払時の仕訳自動生成
- **決算処理・申告書出力**（フェーズ 4）
  - `fiscal_year_closes`、`POST /api/closing/finalize`
  - `/closing/print`（P/L・月別収支・B/S・家事按分計算書、ブラウザ印刷/PDF保存）
- AppShell ナビゲーションをグループ別に再構成（6 グループ）

---

## 2026-06-17（自動ロールバック / メール通知 / deploy.md）

- CD に**失敗時の自動ロールバック**を追加（直前イメージへ復帰）。
- **メール通知**を追加（`dawidd6/action-send-mail`、成功/失敗を `MAIL_TO` 宛に送信）。
- `docs/deploy.md` を新規作成（デプロイ全体設計・ジョブ詳細・ロールバック・通知・必要 Secrets）。

## 2026-06-17（デプロイ後ヘルスチェック）

- 本番 compose に `healthcheck`（`/api/health` を Node fetch で監視）を追加。
- CD の deploy にデプロイ後ヘルスチェックを追加（最大 60 秒リトライ、失敗時は web ログ出力）。
- 任意の外形監視エンドポイント（`HEALTHCHECK_URL`）対応。

## 2026-06-17（自動デプロイ: SSH + Docker Compose）

- CD `deploy` ジョブを実装。`main` push / `v*` タグで本番サーバーへ自動デプロイ。
  - compose を scp 配置 → `docker compose pull` / `up -d` → `prisma migrate deploy` → イメージ掃除。
  - イメージタグ: `main` → `:main` / `vX.Y.Z` → `:X.Y.Z`。

## 2026-06-17（E2E テスト）

- Playwright を導入、E2E テストを実装（認証ガード・ログイン後フロー）。
- CI に `e2e` ジョブを追加（PostgreSQL + migrate + seed → build → Playwright）。

## 2026-06-17（自動テスト + CI/CD 資料）

- Vitest を導入、ドメインロジックの単体テスト 35 ケースを実装。
- `docs/cicd.md` を新規作成（CI/CD 構成・トリガー・ジョブ・リリース手順）。

## 2026-06-17（Phase 4: 運用・セキュリティ強化）

- RBAC: `requireRole()` 導入。書き込み API を editor 以上、監査ログを admin に制限。
- MFA: TOTP（RFC 6238）を外部依存なしで実装（`lib/totp.ts`）。
- 監査ログ: `lib/audit.ts` でログイン・データ変更・MFA 操作を記録。
- CD ワークフロー（GHCR build & push + deploy プレースホルダ）。
- バックアップ / リストアスクリプト（`platform/scripts/backup.sh` / `restore.sh`）。

## 2026-06-17（Phase 3: 高度な予測・レポート）

- Holt / Holt-Winters 予測追加。シナリオ比較（楽観・標準・悲観）。
- 予実対比レポート（`lib/report.ts`、CSV / PNG / PDF 出力）。

## 2026-06-17（Phase 2: 予測高度化・KPI・モバイル）

- 予測手法 3 種（移動平均・線形回帰・成長率）+ シナリオ。
- KPI 算出（`lib/kpi.ts`、`/api/kpi`）。
- モバイルアプリにダッシュボードを実装。

## 2026-06-17（Phase 1: データ管理・集計・認証）

- Prisma スキーマ定義・シード。マスタ管理 API。実績 API の月次/四半期/年次集計。
- CSV 一括インポート（`POST /api/financials/import`）。
- 認証基盤（scrypt + DB セッション + httpOnly Cookie）。

## 2026-06-17（プロジェクト基盤）

- ディレクトリ構成確立（app/web, app/mobile, platform, docs）。
- バックエンドを Next.js Route Handlers に決定（FastAPI 案から変更）。
- Docker Compose（web + PostgreSQL）、Prisma 導入。
