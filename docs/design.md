# 設計書 / 仕様（design.md）

決算管理システムの仕様および設計をまとめる。

---

## 1. システム概要

財務データの取り込み・集計・将来予測を行い、個人事業主・法人の確定申告・決算を支援する統合会計管理システム。
Web とモバイルの両方から利用できる。

| 項目 | 内容 |
|---|---|
| 想定ユーザー | 個人事業主・中小法人の経営者・経理担当・税理士 |
| 提供形態 | Web アプリ（PC ブラウザ） + モバイルアプリ |
| バックエンド | **Next.js App Router Route Handlers** |
| DB | PostgreSQL 16（Prisma ORM） |
| キャッシュ | Redis 7（TTL 1 時間、接続失敗時は DB フォールスルー） |

---

## 2. アーキテクチャ / ディレクトリ構成

```
.
├── app/
│   ├── web/             # Next.js（フロントエンド + バックエンド API）
│   └── mobile/          # Expo / React Native
├── platform/
│   ├── docker/
│   ├── docker-compose.yml        # 開発環境（web + db + redis）
│   ├── docker-compose.prod.yml   # 本番環境
│   └── scripts/                  # backup.sh / restore.sh
└── docs/
    ├── design.md        # 本書
    ├── task.md          # 開発タスク管理
    ├── history.md       # 変更履歴
    ├── operation.md     # 構築・運用手順
    ├── cicd.md          # CI/CD 解説
    └── deploy.md        # デプロイ設計
```

### システム構成図

```
[Web フロントエンド (React)]    [Mobile (React Native)]
             │                           │
             └──────────────┬────────────┘
                            │ HTTPS (REST / JSON)
                            ▼
         [Next.js Route Handlers  /api/*]
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
       [PostgreSQL]      [Redis]     [uploads vol]
        (Prisma)      (キャッシュ)   (証憑ファイル)
```

---

## 3. 技術スタック

| レイヤー | 採用技術 | バージョン |
|---|---|---|
| Web フロント | TypeScript / React / Next.js (App Router) | Next.js 15 |
| グラフ | Recharts | 2.x |
| バックエンド | Next.js Route Handlers (`/api/*`) | — |
| ORM | Prisma + PostgreSQL | Prisma 6 / PG 16 |
| キャッシュ | Redis（`redis` npm パッケージ） | Redis 7 |
| バリデーション | Zod | 3.x |
| モバイル | Expo / React Native | — |
| テスト | Vitest（単体）/ Playwright（E2E） | — |
| インフラ | Docker Compose | — |
| CI/CD | GitHub Actions | — |

---

## 4. 機能一覧

### 4.1 基本集計・予測・ダッシュボード

| 機能 | 概要 |
|---|---|
| 実績管理 | CSV/Excel インポート・手入力・月次/四半期/年次集計 |
| 将来予測 | 移動平均・線形回帰・Holt・Holt-Winters・シナリオ比較 |
| KPI ダッシュボード | 利益率・YoY・MoM・YTD |
| 予実対比レポート | 予算 vs 実績 vs 予測・差異・達成率・CSV/PNG/PDF 出力 |
| 構成比グラフ | 円グラフ・積み上げ棒グラフ |

### 4.2 個人事業主・確定申告支援（F001〜F015）

| 機能 | テーブル / エンドポイント |
|---|---|
| 事業者情報管理 | `business_profiles` / `GET PUT /api/business-profile` |
| 仕訳入力（複式簿記） | `journal_entries` + `journal_details` / `/api/journals` |
| テンプレート仕訳 | `journal_templates` / `/api/journal-templates` |
| AI 仕訳提案 | `/api/journals/suggest` |
| 証憑ファイル管理 | `receipts` / `/api/journals/[id]/receipts` |
| 棚卸管理 | `inventories` + `inventory_items` (itemType / valuationMethod) |
| 固定資産・減価償却 | `fixed_assets` + `depreciations` |
| 家事按分 | `apportionments` |
| 売掛金管理 | `receivables` |
| 買掛金管理 | `payables` |
| 消費税設定 | `tax_settings` / `/api/tax-settings` |
| 仕入税額控除管理 | `journal_details.taxCreditEligible` / `/api/tax-credit` |
| 決算処理・年度締め | `fiscal_year_closes` / `/api/closing/finalize` |
| 青色申告決算書 印刷 | `/closing/print`（P/L・B/S・月別収支・家事按分計算書） |
| 総勘定元帳 | `/api/reports/general-ledger` (JSON / CSV) |
| 試算表 | `/api/reports/trial-balance` (JSON / CSV) |

### 4.3 法人・統合会計（マルチテナント対応）

| 機能 | テーブル / エンドポイント |
|---|---|
| マルチテナント | `tenants` (SOLE_PROPRIETOR / CORPORATION) / `/api/tenants`。全財務データをテナント単位で分離（詳細は「11. マルチテナント方式（データ分離）」参照） |
| 会計年度管理 | `fiscal_years` / `/api/fiscal-years` |
| 銀行・資金管理 | `bank_accounts` + `bank_transactions` / `/api/bank-accounts` |
| 借入金管理 | `loans` + `loan_repayments` / `/api/loans` |
| インボイス発行 | `invoices` + `invoice_lines` / `/api/invoices` |
| 未収金・未払金 | `accrued_revenues` + `accrued_expenses` |
| 法人向け決算書出力 | `/closing/corporate-print`（P/L・B/S・S/S・法人税概算） |
| 財務分析指標 | `ratios` in `/api/closing/statements`（ROA/ROE/流動比率等） |
| 株主総会管理 | `shareholder_meetings` / `/api/shareholder-meetings` |
| 配当管理 | `dividends` / `/api/dividends` |
| 役員管理 | `officers` / `/api/officers` |
| 決算公告管理 | `announcements` / `/api/announcements` |
| 電子帳簿保存法対応 | `journal_approvals` / `/api/journals/approve`（承認ワークフロー） |

### 4.4 セキュリティ・運用

| 機能 | 概要 |
|---|---|
| 認証 | メール + パスワード（scrypt）+ DB セッション + httpOnly Cookie |
| RBAC | admin / editor / accountant / viewer（4 ロール） |
| MFA | TOTP（RFC 6238、外部依存なし） |
| 監査ログ | ログイン・データ変更を `audit_logs` に記録 |
| ユーザー管理 | `/admin/users`（ロール変更・パスワードリセット・新規作成） |
| キャッシュ | Redis TTL 1h（statements / general-ledger） |

### 4.5 勘定科目変換（家庭 ↔ 法人モード）

家庭モード（`H-` prefix）の勘定科目を法人モードの勘定科目へ変換する機能。詳細仕様は [`account-conversion-system.md`](account-conversion-system.md) を参照。有料 AI 変換・課金・PDF 報告書生成（同ドキュメントの Phase 6）は未実装。

| 機能 | テーブル / エンドポイント |
|---|---|
| 変換マッピングマスタ | `account_mapping_rules`（システム定義 + ユーザー独自ルール） |
| 自動変換候補提案 | `GET /api/account-conversion/preview` |
| マッピング編集・学習 | `GET/PUT /api/account-conversion/mappings` |
| 変換確定・反映 | `POST /api/account-conversion/confirm` → `account_conversion_sessions` / `account_conversion_logs` |
| 変換履歴閲覧・CSV出力 | `GET /api/account-conversion/history`、`GET /api/account-conversion/history/[id]`、`GET /api/account-conversion/history/[id]/export` |
| 画面 | `/account-conversion`（変換確認）、`/account-conversion/history`（変換履歴） |

---

## 5. API エンドポイント一覧

### 認証・ユーザー

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/health` | ヘルスチェック |
| GET/POST | `/api/accounts` | 勘定科目マスタの取得・登録 |
| GET/POST | `/api/departments` | 部門マスタの取得・登録 |
| GET/POST | `/api/periods` | 会計期間マスタの取得・登録 |
| GET | `/api/financials?granularity=month\|quarter\|year` | 実績データの集計（粒度指定） |
| POST | `/api/financials` | 実績データの手入力登録 |
| POST | `/api/financials/import` | CSV による実績の一括取り込み |
| GET | `/api/forecasts?accountCode=&months=N&method=&scenario=` | 将来 N か月の推移を予測（手法・シナリオ指定） |
| GET | `/api/kpi` | 最新月の主要 KPI（利益率・YoY・MoM・YTD） |
| GET | `/api/cashflow?year=` | 資金フロー図（Sankey）データを自動生成 |
| GET/POST | `/api/bank-accounts` | 銀行口座マスタの取得・登録 |
| GET/POST | `/api/transfers` | 資金移動ルール（振込/口座引落/カード引落/入金/支出）の取得・登録（外部端点 null 可） |
| GET | `/api/transfers/flow` | 口座間・外部を含む資金移動フロー図（Sankey）を自動生成 |
| POST | `/api/transfers/simulate` | 期首残高＋資金移動から残高推移をシミュレートし残高不足を検出 |
| GET/POST | `/api/bank-accounts/:id/transactions` | 入出金明細の取得 / CSV 取込 |
| POST | `/api/bank-accounts/:id/sync` | アグリゲーションから入出金を自動取得（既定はモック） |
| GET | `/api/reports/budget-actual?accountCode=&year=&method=` | 予実対比レポート（予算 vs 実績 vs 予測） |
| GET | `/api/reports/budget-actual/export?...` | 予実対比レポートの CSV ダウンロード |
| POST | `/api/auth/mfa/setup` `/enable` `/disable` | MFA（TOTP）の設定・有効化・無効化 |
| GET | `/api/audit-logs` | 監査ログ一覧（admin 限定） |
| POST | `/api/auth/login` | ログイン（セッション Cookie 発行） |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | 現在のログインユーザー取得 |
| Method | Path | 権限 |
|---|---|---|
| POST | `/api/auth/login` | 不要 |
| POST | `/api/auth/logout` | viewer |
| GET  | `/api/auth/me` | viewer |
| POST/GET | `/api/auth/mfa/*` | viewer |
| GET/POST/PUT/DELETE | `/api/admin/users` | admin |
| GET  | `/api/audit-logs` | admin |

### マスタ・基本集計

### 画面（実装済み）
- `/login` … ログイン
- `/dashboard` … KPI カード + 売上の実績＋予測の推移グラフ（予測手法・シナリオ・期間の切替）
- `/entry` … 実績データの手入力フォーム
- `/masters` … 勘定科目・部門マスタの管理
- `/reports` … 予実対比レポート（複合グラフ + 表、CSV/PNG/PDF 出力）
- `/cashflow` … 資金フロー図（Sankey）。勘定科目集計から売上→原価/利益の流れを自動生成
- `/transfers` … 口座間 資金移動フロー。銀行口座と振込/引き落とし（日・種別）を登録し、口座間の資金の流れを自動でフロー図化
- `/bank-transactions` … 入出金明細。自動取得（同期）または CSV 取込
- `/simulation` … 残高シミュレーション。期首残高と振込/引き落とし/入金から日次の残高推移を予測し、残高不足日を検出

### 資金移動（Transfer）の一般化
- `channel`: 口座間振込 / 口座引き落とし / **カード引き落とし** / 入金 / 支出。
- 出金元・入金先は **口座または外部（null）**。入金=出金元が外部、カード/支出=入金先が外部。
- これにより、口座引き落としだけでなくクレジットカード引き落としや給与入金・各種支出を同じ仕組みでフロー図化・残高シミュレーションできる。

### 銀行入出金の自動取得
- `lib/banksync.ts` の `BankSyncProvider` インターフェース＋モック実装。実銀行接続は口座アグリゲーション事業者（Plaid / Moneytree 等）の API に差し替える（認証情報・外部接続が必要）。
- CSV 取込（`date,description,amount[,balance]`）も対応。`externalId` で重複取込を防止。
| Method | Path | 権限 |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/accounts` | viewer/editor |
| GET/POST | `/api/departments` | viewer/editor |
| GET/POST | `/api/periods` | viewer/editor |
| GET/POST | `/api/financials` | viewer/editor |
| POST | `/api/financials/import` | editor |
| GET  | `/api/forecasts` | viewer |
| GET  | `/api/kpi` | viewer |
| GET/POST | `/api/budgets` | viewer/editor |
| GET  | `/api/reports/budget-actual` | viewer |

### 個人事業主・会計帳簿

| Method | Path | 権限 |
|---|---|---|
| GET/PUT | `/api/business-profile` | viewer/editor |
| GET/PUT | `/api/tax-settings` | viewer/editor |
| GET/POST | `/api/journals` | viewer/editor |
| DELETE | `/api/journals/[id]` | editor |
| POST | `/api/journals/suggest` | viewer |
| GET/POST | `/api/journal-templates` | viewer/editor |
| POST | `/api/journals/[id]/receipts` | editor |
| GET/POST | `/api/inventories` | viewer/editor |
| GET/POST/PUT | `/api/fixed-assets` | viewer/editor |
| POST | `/api/fixed-assets/[id]/depreciate` | editor |
| GET/POST | `/api/apportionments` | viewer/editor |
| GET/POST | `/api/receivables` | viewer/editor |
| POST | `/api/receivables/[id]/pay` | editor |
| GET/POST | `/api/payables` | viewer/editor |
| POST | `/api/payables/[id]/pay` | editor |

### 決算・レポート

| Method | Path | 権限 |
|---|---|---|
| GET  | `/api/closing/statements` | viewer |
| POST | `/api/closing/finalize` | editor |
| GET  | `/api/closing/etax` | viewer |
| GET  | `/api/tax-credit` | viewer |
| GET  | `/api/reports/general-ledger` | viewer |
| GET  | `/api/reports/trial-balance` | viewer |
| GET  | `/api/reports/budget-actual` | viewer |
| GET  | `/api/reports/composition` | viewer |
| GET/POST | `/api/journals/approve` | accountant |
| GET  | `/api/portal` | accountant |

### 法人管理

| Method | Path | 権限 |
|---|---|---|
| GET/POST | `/api/tenants` | viewer/editor |
| GET/PUT/DELETE | `/api/tenants/[id]` | viewer/editor |
| GET/POST | `/api/fiscal-years` | viewer/editor |
| GET/POST | `/api/bank-accounts` | viewer/editor |
| POST | `/api/bank-accounts/[id]/transactions` | editor |
| GET/POST | `/api/loans` | viewer/editor |
| POST | `/api/loans/[id]/repay` | editor |
| GET/POST | `/api/invoices` | viewer/editor |
| GET/POST | `/api/officers` | viewer/editor |
| GET/POST | `/api/shareholder-meetings` | viewer/editor |
| GET/POST | `/api/dividends` | viewer/editor |
| GET/POST | `/api/announcements` | viewer/editor |

### 外部連携・その他

| Method | Path | 権限 |
|---|---|---|
| GET/POST | `/api/linked-accounts` | viewer/editor |
| GET/POST | `/api/integrations/freee` | editor |
| GET/POST | `/api/integrations/moneyforward` | editor |
| GET/POST | `/api/integrations/openbanking` | editor |
| GET | `/api/assets` | viewer |
| GET | `/api/health` | 不要 |
| POST | `/api/admin/cleanup` | admin |

---

## 6. データモデル（概略）

- `accounts`（勘定科目）: id, code, name, category
- `departments`（部門）: id, name, parent_id
- `periods`（会計期間）: id, fiscal_year, quarter, month
- `financial_records`（実績）: id, account_id, department_id, period_id, amount
- `forecasts`（予測）: id, account_id, period_id, method, scenario, amount
- `budgets`（予算）: id, account_id, period_id, amount
- `bank_accounts`（銀行口座）: id, name, bank_name, branch_name, account_type, role
- `transfers`（資金移動）: id, from_account_id(null可), to_account_id(null可), amount, kind(MANUAL/AUTO), channel(BANK_TRANSFER/AUTO_DEBIT/CARD_PAYMENT/INCOME/EXPENSE), label, day, note
- `bank_transactions`（入出金明細）: id, account_id, date, description, amount(±), balance, source(MANUAL/CSV/SYNC), external_id
- `users`（ユーザー）: id, email, name, password_hash, role
- `sessions`（セッション）: id, user_id, expires_at
- `audit_logs`（監査ログ）: id, user_id, action, target, changed_at
> 正式定義は `app/web/prisma/schema.prisma` を参照。

### 基本・認証系

| テーブル | 主なカラム |
|---|---|
| `users` | id, email, role(admin/editor/accountant/viewer), mfaEnabled |
| `sessions` | id, userId, expiresAt |
| `audit_logs` | id, userId, action, target, changedAt |

### 財務基盤

| テーブル | 主なカラム |
|---|---|
| `accounts` | id, code, name, category(REVENUE/COGS/EXPENSE/ASSET/LIABILITY/PROFIT/OTHER) |
| `departments` | id, name, manager, parentId |
| `periods` | id, fiscalYear, quarter, month |
| `financial_records` | id, accountId, periodId, amount |
| `budgets` | id, accountId, periodId, amount |

### 個人事業主・会計帳簿

| テーブル | 主なカラム |
|---|---|
| `business_profiles` | tradeName, ownerName, blueReturn, invoiceNumber, taxationType |
| `tax_settings` | taxYear, taxationType(exempt/general/simplified), simplifiedRate |
| `journal_entries` | transactionDate, description, paymentMethod, taxCategory, approvalStatus |
| `journal_details` | journalEntryId, side, accountId, amount, taxRate, taxCreditEligible |
| `journal_approvals` | journalEntryId, action, actorId, comment |
| `receipts` | journalEntryId, fileName, fileUrl |
| `inventories` | name, inventoryDate, valuationMethod, status, totalAmount |
| `inventory_items` | inventoryId, itemName, itemType, quantity, unitPrice |
| `fixed_assets` | name, acquiredOn, acquisitionCost, usefulLife, method, bookValue |
| `depreciations` | fixedAssetId, fiscalYear, amount, method |
| `apportionments` | accountId, businessRate |
| `receivables` | counterparty, billedOn, dueOn, amount, status |
| `payables` | supplier, dueOn, amount, status |
| `fiscal_year_closes` | fiscalYear, status, closedAt |

### 法人管理

| テーブル | 主なカラム |
|---|---|
| `tenants` | companyName, type(CORPORATION/SOLE_PROPRIETOR), corporateNumber, capitalAmount |
| `fiscal_years` | tenantId, startDate, endDate, status |
| `bank_accounts` | tenantId, bankName, accountNumber, balance |
| `bank_transactions` | bankAccountId, transactionDate, amount, type, balance |
| `loans` | tenantId, lenderName, principal, interestRate, status |
| `loan_repayments` | loanId, repaidOn, principal, interest |
| `invoices` | invoiceNumber, issuedOn, dueDate, taxRate, status |
| `invoice_lines` | invoiceId, description, quantity, unitPrice, taxRate |
| `officers` | tenantId, name, role, termStart, termEnd |
| `shareholder_meetings` | tenantId, heldOn, type, agenda, resolution |
| `dividends` | tenantId, fiscalYear, perShare, totalAmount, paidOn |
| `announcements` | tenantId, announcedOn, method, content |
| `accrued_revenues` | tenantId, accountId, amount, accrualDate |
| `accrued_expenses` | tenantId, accountId, amount, accrualDate |

---

## 7. ロール定義

| ロール | ランク | 主な権限 |
|---|---|---|
| viewer | 1 | 全画面・全 API の閲覧のみ |
| accountant | 2 | viewer + 仕訳承認ワークフロー操作 |
| editor | 3 | accountant + データ登録・編集・削除 |
| admin | 4 | editor + ユーザー管理・監査ログ閲覧 |

---

## 8. 画面一覧

| URL | 画面名 | 主な機能 |
|---|---|---|
| `/login` | ログイン | 認証・MFA |
| `/dashboard` | ダッシュボード | KPI カード・推移グラフ・予測 |
| `/entry` | 実績管理 | 手入力・CSV インポート |
| `/assets` | 資産管理 | 純資産推移グラフ |
| `/budget` | 予算管理 | 月別予算クロス集計・インライン編集 |
| `/reports` | 予実対比レポート | 予算 vs 実績 vs 予測・出力 |
| `/journals` | 仕訳帳 | 複式簿記入力・証憑アップロード・承認 |
| `/journal-templates` | 仕訳テンプレート | テンプレート管理・1 クリック入力 |
| `/reports/ledger` | 総勘定元帳 | 科目別取引一覧・CSV 出力 |
| `/receivables` | 売掛金管理 | 入金管理・自動仕訳 |
| `/payables` | 買掛金管理 | 支払管理・自動仕訳 |
| `/invoices` | インボイス発行 | 適格請求書発行・ステータス管理 |
| `/inventories` | 棚卸管理 | 棚卸入力・評価方法設定 |
| `/fixed-assets` | 固定資産管理 | 資産台帳・減価償却計算 |
| `/apportionments` | 家事按分管理 | 科目別事業利用率設定 |
| `/bank-accounts` | 銀行・資金管理 | 口座残高・入出金履歴 |
| `/loans` | 借入金管理 | 借入残高・返済履歴 |
| `/closing` | 決算処理 | P/L・B/S・財務分析・年度締め |
| `/closing/print` | 青色申告書類 印刷 | 個人事業主向け申告書印刷 |
| `/closing/corporate-print` | 法人決算書類 印刷 | 法人向け P/L・B/S・S/S・法人税概算 |
| `/corporate` | 法人・事業者情報管理 | テナント管理 |
| `/fiscal-years` | 会計年度管理 | 法人別会計年度 |
| `/governance` | 法人ガバナンス管理 | 役員・株主総会・配当・決算公告 |
| `/masters` | マスタ管理 | 勘定科目・部門・会計期間 |
| `/settings` | 設定 | 事業者情報・消費税設定・MFA |
| `/linked-accounts` | 口座・カード管理 | 外部金融口座管理 |
| `/integrations` | 外部サービス連携 | freee・マネーフォワード・オープンバンキング管理 |
| `/portal` | 税理士ポータル | テナント横断財務サマリ閲覧（accountant 以上） |
| `/admin/users` | ユーザー管理 | ロール変更・新規作成（admin） |
| `/admin/audit` | 監査ログ | 操作履歴閲覧（admin） |

---

## 9. 非機能要件

| 区分 | 要件 |
|---|---|
| 性能 | 主要画面 2 秒以内（重い集計は Redis キャッシュで TTL 1h） |
| セキュリティ | 認証 + MFA、RBAC（4 ロール）、TLS、監査ログ |
| 可用性 | 平日業務時間帯 99.5% |
| データ保全 | 日次バックアップ、保持期間設定（既定 30 日） |
| 拡張性 | 勘定科目・部門・テナントの追加に柔軟対応 |

---

## 10. 家庭家計への応用（家庭＝一法人モデル）

本システムは「一家庭を一法人に見立てる」運用が可能。勘定科目コード体系だけ変えれば即日運用できる。

| 法人 | 家庭 | カテゴリ |
|---|---|---|
| 売上高 | 給与・副業・配当 | REVENUE |
| 売上原価 | 変動費（食費・交通費） | COGS |
| 販管費 | 固定費（家賃・光熱費・保険） | EXPENSE |
| 営業利益 | 貯蓄額（収入 − 支出） | PROFIT |
| 営業利益率 | **貯蓄率** | KPI |

### 家庭向け勘定科目体系（例）

```
収入（REVENUE）
  H1000  給与・賞与    H1100  副業収入    H1200  投資・配当収益

変動費（COGS）
  H2000  食費          H2100  日用品      H2200  交通費    H2300  娯楽費

固定費（EXPENSE）
  H3000  家賃・住宅ローン    H3100  水道光熱費    H3200  通信費
  H3300  保険料              H3400  教育費        H3500  医療・健康費

貯蓄（PROFIT）
  H9000  貯蓄・投資積立
```

---

## 11. マルチテナント方式（データ分離）

`tenants` を財務データの分離単位とする。**1 テナントに複数ユーザーを所属させられる（Users : Tenant = N : 1）**。各ユーザーは自分の所属テナント配下のデータのみ参照・操作できる。

| 項目 | 内容 |
|---|---|
| モデル | `users.tenantId Int`（非ユニーク、`@@index` 付き）。`POST /api/admin/users` は既定で作成者と同じテナントへ追加し、`newTenant: true` 指定時のみ空の新規テナントをトランザクションで自動作成する |
| ユーザー管理の分離 | `/api/admin/users`（GET/POST/PATCH/DELETE）は**自テナントのユーザーのみ**対象。他テナントのユーザーは一覧に表示されず、ID 指定の変更・削除も 404 を返す |
| セッション | `lib/auth.ts` のセッションユーザーオブジェクトに `tenantId` を含める |
| 分離対象テーブル | `accounts` / `periods` / `budgets` / `financial_records` / `departments` / `bank_accounts` / `transfers` / `journal_entries` / `journal_templates` / `invoices` / `loans` / `receivables` / `payables` / `fixed_assets` / `inventories` / `apportionments` / `linked_accounts` / `business_profiles` / `tax_settings` / `fiscal_years` / `fiscal_year_closes` / `officers` / `shareholder_meetings` / `dividends` / `announcements` / `accrued_revenues` / `accrued_expenses` に `tenantId Int` を付与 |
| API 側の強制 | 全 API ルート（約 45 ファイル）で `where: { tenantId: session.user.tenantId }` を必須化。ID 指定の GET/PUT/DELETE も所有テナント確認後に処理し、他テナントのリソースは 403 / 404 を返す（例: `/api/tenants/[id]`） |
| 複合ユニークキー | 単体ユニーク制約から `tenantId` を含む複合キーに変更。テナントを跨いで同じ科目コード・会計期間・予算行を独立管理できる |

### 複合ユニークキー一覧

| `@@unique` 定義 | 対象テーブル | Prisma `where` キー名 |
|---|---|---|
| `[tenantId, code]` | `accounts` | `tenantId_code` |
| `[tenantId, fiscalYear, month]` | `periods` | `tenantId_fiscalYear_month` |
| `[tenantId, accountId, periodId]` | `budgets` | `tenantId_accountId_periodId` |
| `[tenantId, fiscalYear]` | `fiscal_year_closes` | `tenantId_fiscalYear` |
| `[tenantId, accountId]` | `apportionments` | `tenantId_accountId` |
| `[tenantId]` | `business_profiles` | `tenantId` |
| `[tenantId, taxYear]` | `tax_settings` | `tenantId_taxYear` |
| `[tenantId, invoiceNumber]` | `invoices` | `tenantId_invoiceNumber` |

### Seed データ

`prisma/seed.ts` は**デモテナント**（id=1, 株式会社テックソリューション / CORPORATION）を 1 つ作成し、デモの財務データ（勘定科目・実績・予算・仕訳・請求書等）をすべてそこへ投入する。デモユーザー 4 名（`admin@example.com` / `editor@example.com` / `viewer@example.com` / `demo@example.com`、パスワードはいずれも `password`）は全員このデモテナントに所属する。テナント id を明示指定して upsert するため、seed 末尾で `tenants_id_seq` を実データに同期させている（ずれたままだと以降の `tenant.create` が id 重複で失敗する）。

### 移行時の注意

- 開発 DB に既存データがある状態でこの変更を適用する場合、`tenantId` は必須列でデフォルト値を持たないため通常の `prisma migrate dev` では適用できない（既存行に値を埋められないため）。ローカル開発では `prisma migrate reset` で DB を初期化してから新しいマイグレーションを適用し、`npm run db:seed` で再投入する（本番相当データがある環境には適用しないこと）。

---

## 12. 勘定科目変換方式（家庭 ↔ 法人モード）

詳細な UI・課金設計は [`account-conversion-system.md`](account-conversion-system.md) を参照。ここでは実装済み範囲（Phase 1〜5 の無料部分）の要点のみ記す。

### スコープ

| 項目 | 内容 |
|---|---|
| 対象 | テナント内の家庭モード科目（`accounts.code` が `H-` で始まるもの）を、同一テナント内の法人/個人事業主科目（`H-` 以外のコード）へ変換 |
| 未実装 | Phase 6（AI 有料変換・キャッシュ課金・PDF 報告書）。`ai_conversion_results` / `ai_conversion_usages` テーブルはスキーマのみ存在し、書き込みロジックは未実装 |
| データ分離 | `account_mapping_rules` / `account_conversion_sessions` / `account_conversion_logs` は `tenantId` を持たず、`userId` で所有者を識別する（変換ルール・履歴は実行ユーザー個人に帰属） |

### 自動変換の判定ロジック（`lib/account-conversion.ts`）

仕様書の 5 段階判定のうち、無料 AI 推論ステップ（Step 4）は実際の LLM 呼び出しではなく、ルールベースの疑似 AI（カテゴリ別フォールバック）で代替している。

| 優先度 | 判定方法 | matchType | 信頼度 |
|---|---|---|---|
| 1 | `account_mapping_rules` 直引き（ユーザー独自ルール優先、次にシステム定義） | `TABLE` / `MANUAL` | ルールの値（既定 1.0） |
| 2 | キーワード一致（科目名に「税」「保険」等を含む） | `KEYWORD` | 0.9 |
| 3 | あいまい一致（科目名の bigram Dice 係数、閾値 0.5） | `FUZZY` | 類似度スコア |
| 4 | カテゴリ別フォールバック（疑似 AI。REVENUE→売上高、COGS→仕入高、EXPENSE→雑費） | `AI_FREE` | 0.4 固定 |
| 5 | 候補なし | `MANUAL`（`corporateAccountId: null`） | — |

バッジ判定（`badgeFor`）: `isConvertible=false` → 変換不可 / 変換先未確定 → 手動 / 信頼度 0.8 以上 → 自動 / 0.5〜0.79 → 要確認 / それ未満 → 手動。

### 変換の確定・反映（`POST /api/account-conversion/confirm`）

- `AccountConversionSession` + `AccountConversionLog` を作成して結果を保存する。
- ユーザーが手動で変換先を変更した行（`isManuallyOverridden: true`）は、`account_mapping_rules` に自分専用ルール（`userId` 指定、`matchType: MANUAL`）として upsert され、次回以降の自動変換に反映される（学習）。
- **注意**: 既存の `financial_records` / `journal_details` 等が参照している家庭モード科目 ID を法人科目 ID へ一括で付け替える処理は行わない（データ整合性・巻き戻しの設計が仕様書側で未確定のため、意図的にスコープ外としている）。本機能は「変換マッピングの提案・記録」までを担い、実データの一括移行は別途の仕組みが必要。

### Seed

- `npm run db:seed:business-accounts` / `db:seed:home-accounts`: それぞれ法人向け・家庭向けの勘定科目マスタを投入するスタンドアロンスクリプト（`tenantId: 1` 固定、主に開発用）。
- `npm run db:seed:account-mapping`: `account_mapping_rules` にシステム定義の変換ルール（76 件、`userId: null`）を投入する。`homeCode_userId` の複合ユニークキーは `userId` が `null` の場合 Prisma の `upsert` で直接指定できないため、`findFirst` + `create`/`update` で代用している。

---

## 13. モード別 科目表示名（`Account.soleName` / `Account.corporateName`）

勘定科目は**家庭モードの科目名**（`Account.name`）を既定として登録し、個人事業主モード・法人モードで表示する際の科目名を科目レコード上のエイリアスとして保持する。§12 の変換機能（家庭科目→別の法人科目レコードへの変換提案）とは別軸で、「同一科目を各モードでどう呼ぶか」を管理する。

| 項目 | 内容 |
|---|---|
| モデル | `Account.soleName String?`（個人事業主モード表示名）、`Account.corporateName String?`（法人モード表示名）。いずれも `null` の場合は `name`（家庭科目名）にフォールバック |
| 既定値 | `prisma/account-display-names.ts`（[`account-master-mapping.md`](account-master-mapping.md) の「個人事業主科目名」「法人科目名」列を転記）を出典とする。マッピング表対象外の経過勘定（H-5001〜H-5004）は家庭科目名と同一 |
| 管理画面 | `/settings` の「科目名設定」タブ。全科目の個人事業主/法人モード表示名を一括編集し保存する（空欄で保存すると `null` = 家庭科目名フォールバック） |
| API | `GET /api/accounts`（`soleName`/`corporateName` を含めて返す）、`PUT /api/accounts/display-names`（`{ items: [{ id, soleName?, corporateName? }] }` の一括更新、editor 以上、自テナントの科目のみ）。単体の `POST`/`PATCH /api/accounts[/id]` も両フィールドを受け付ける |
| データ分離 | `PUT /api/accounts/display-names` は対象 `id` が全て自テナントに属することを検証し、他テナントの科目が含まれる場合は 403 |

> 表示名はあくまで表示用エイリアスであり、`accounts.code` や集計・仕訳のリレーションには影響しない。各画面での表示切り替え（現在の閲覧モードに応じて `name`/`soleName`/`corporateName` のどれを出すか）は今後の画面側対応の余地がある（現時点ではマスタとして保持・管理まで）。

### 新規テナント作成時の自動登録

テナントが作成されるたびに、家庭モードの既定勘定科目一式（76 科目、モード別表示名込み）を自動登録する。

| 項目 | 内容 |
|---|---|
| 実装 | `src/lib/default-accounts.ts` の `HOME_ACCOUNTS_SEED`（既定科目一覧）と `seedDefaultAccountsForTenant(db, tenantId)`（未登録のコードのみ作成、既存科目は上書きしない） |
| 呼び出し元 | `POST /api/admin/users`（`newTenant: true` でテナントを新規作成する場合。`$transaction` 内でテナント作成直後に実行）、`POST /api/tenants` |
| `prisma/seed-home-accounts.ts` との関係 | 同じ `HOME_ACCOUNTS_SEED` を参照するデモテナント（id=1）専用の再投入スクリプト。ロジックの重複を避けるため実データは `src/lib/default-accounts.ts` 側に一本化している |
| 既存テナントへの後付け投入 | 本機能導入前に作成されたテナントには自動投入されないため、`seedDefaultAccountsForTenant(prisma, tenantId)` を一度呼び出して個別に投入する（[`account-setup.md`](account-setup.md) 参照） |
