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
| マルチテナント | `tenants` (SOLE_PROPRIETOR / CORPORATION) / `/api/tenants` |
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
