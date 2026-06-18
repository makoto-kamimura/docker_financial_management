# 設計書 / 仕様（design.md）

決算管理システムの仕様および設計をまとめる。

---

## 1. システム概要
過去の財務データを取り込み・集計し、将来の推移を予測してグラフで可視化する決算管理システム。
Web とモバイルの両方からアクセスできるダッシュボードを提供する。

| 項目 | 内容 |
| --- | --- |
| 想定ユーザー | 経営者、経理・財務担当、経営企画 |
| 提供形態 | Web アプリ（PC ブラウザ） + モバイルアプリ |
| バックエンド | **Next.js（App Router の Route Handlers）** |

---

## 2. アーキテクチャ / ディレクトリ構成

```
.
├── app/                 # アプリケーションのソースコード
│   ├── web/             # Web（Next.js: フロントエンド + バックエンド API）
│   └── mobile/          # モバイル（Expo / React Native）
├── platform/            # 実行基盤（Docker など）
│   ├── docker/
│   ├── docker-compose.yml
│   └── .env.example
└── docs/                # ドキュメント
    ├── design.md        # 仕様（本書）
    ├── history.md       # 変更履歴
    └── task.md          # 開発タスク
```

### システム構成図
```
[app/web フロントエンド (React)]   [app/mobile (React Native)]
            │                              │
            └──────────────┬───────────────┘
                           │ HTTPS (REST / JSON)
                           ▼
        [app/web バックエンド API (Next.js Route Handlers)]
                           │
                           ▼
                  [PostgreSQL (Prisma)]
```

> **バックエンドは Next.js に一本化**する。`app/web/src/app/api/*` の Route Handlers が
> REST API を提供し、Web フロントエンドとモバイルアプリの両方から利用する。

---

## 3. 技術スタック

| レイヤー | 採用技術 | 備考 |
| --- | --- | --- |
| Web フロント | TypeScript / React / **Next.js (App Router)** | ダッシュボード・グラフ表示 |
| Web グラフ | Recharts | 実績＋予測の複合表示 |
| **バックエンド** | **Next.js Route Handlers (`/api/*`)** | フロントと同一プロジェクトで API を提供 |
| モバイル | Expo / React Native / Victory Native | Web と共通 API を参照 |
| ORM / DB | Prisma + PostgreSQL | 集計クエリ・整合性 |
| バリデーション | Zod | API 入出力スキーマ |
| インフラ | Docker / Docker Compose | `platform/` 配下 |
| CI/CD | GitHub Actions | テスト・ビルド・デプロイ |

---

## 4. 機能要件

### 4.1 データ管理
- CSV / Excel インポート、手入力による実績登録・編集
- マスタ管理（勘定科目・部門/セグメント・会計期間）

### 4.2 集計
- 月次 / 四半期 / 年次の自動集計
- PL 指標（売上総利益、営業利益、経常利益、当期純利益）
- 経営指標（利益率、前年同月比 YoY、前月比 MoM、累計 YTD）
- 部門別・セグメント別の内訳とドリルダウン

### 4.3 将来予測
- Phase 1: 移動平均・線形回帰・成長率ベース
- Phase 3: 季節性を考慮した時系列予測（指数平滑法 / Holt-Winters 等）
- 予測期間（先 N か月/年）、シナリオ比較（楽観・標準・悲観）

### 4.4 可視化
- 推移グラフ（折れ線・棒・複合、実績＋予測）
- 構成比グラフ（円・積み上げ棒）、KPI ダッシュボード
- 期間・部門・指標でのフィルタ、エクスポート（PNG/PDF/CSV）

### 4.5 レポート
- 月次・四半期・年次レポートの自動生成
- 予実対比レポート（予算 vs 実績 vs 予測）

---

## 5. API 仕様（バックエンド / Next.js Route Handlers）

ベースパス: `/api`

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
| GET | `/api/reports/budget-actual?accountCode=&year=&method=` | 予実対比レポート（予算 vs 実績 vs 予測） |
| GET | `/api/reports/budget-actual/export?...` | 予実対比レポートの CSV ダウンロード |
| POST | `/api/auth/mfa/setup` `/enable` `/disable` | MFA（TOTP）の設定・有効化・無効化 |
| GET | `/api/audit-logs` | 監査ログ一覧（admin 限定） |
| POST | `/api/auth/login` | ログイン（セッション Cookie 発行） |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | 現在のログインユーザー取得 |

> Phase 1 で **Prisma + PostgreSQL** による永続化に移行済み。実績は `prisma/seed.ts` で初期投入できる。

### 画面（実装済み）
- `/login` … ログイン
- `/dashboard` … KPI カード + 売上の実績＋予測の推移グラフ（予測手法・シナリオ・期間の切替）
- `/entry` … 実績データの手入力フォーム
- `/masters` … 勘定科目・部門マスタの管理
- `/reports` … 予実対比レポート（複合グラフ + 表、CSV/PNG/PDF 出力）

### 予測手法
- `moving_average`（移動平均）/ `linear_regression`（線形回帰）/ `growth_rate`（成長率）
- `holt`（Holt 二重指数平滑）/ `holt_winters`（Holt-Winters 三重指数平滑・加法的季節モデル）
- Holt-Winters はデータが 2 季節周期未満の場合 Holt → 線形へ自動フォールバック
- シナリオ係数: 楽観 ×1.1 / 標準 ×1.0 / 悲観 ×0.9

### レポート / エクスポート（Phase 3）
- 予実対比: 予算（`budgets`）vs 実績 vs 予測を月次でマージし、差異・達成率・合計を算出。
- 出力: CSV（サーバー生成・BOM 付）、PNG（チャート SVG→Canvas）、PDF（ブラウザ印刷）。

### アクセス制御
- `middleware.ts` で `/dashboard` `/entry` `/masters` を保護（セッション Cookie 必須）。
- 構築・起動の手順は `docs/operation.md` を参照。

### 認証・認可方式
- メール + パスワード（scrypt ハッシュ、`node:crypto`）でログイン。
- セッションは DB（`sessions`）に保存し、httpOnly Cookie（`fm_session`）で識別。
- **RBAC**: admin / editor / viewer の 3 ロール。`lib/authz.ts` の `requireRole()` で API を保護（書き込みは editor 以上、監査ログは admin）。
- **MFA**: TOTP（RFC 6238、`lib/totp.ts`、外部依存なし）。`users.mfaEnabled` / `users.totpSecret` で管理。
- **監査ログ**: ログイン・データ変更・MFA 操作を `audit_logs` に記録（`lib/audit.ts`）。
- 画面アクセスは `middleware.ts` でセッション Cookie の有無を確認。

---

## 6. データモデル（概略）

- `accounts`（勘定科目）: id, code, name, category
- `departments`（部門）: id, name, parent_id
- `periods`（会計期間）: id, fiscal_year, quarter, month
- `financial_records`（実績）: id, account_id, department_id, period_id, amount
- `forecasts`（予測）: id, account_id, period_id, method, scenario, amount
- `budgets`（予算）: id, account_id, period_id, amount
- `users`（ユーザー）: id, email, name, password_hash, role
- `sessions`（セッション）: id, user_id, expires_at
- `audit_logs`（監査ログ）: id, user_id, action, target, changed_at

> 実装は `app/web/prisma/schema.prisma` を正とする。

---

## 7. 家庭家計への応用（家庭＝一法人モデル）

### 概念

本システムは「一家庭を一法人に見立てる」運用が可能である。
法人財務と家計は構造的に同型であり、以下の対応関係が成立する。

| 法人 | 家庭 | 勘定カテゴリ |
|---|---|---|
| 売上高 | 給与・副業・配当収益 | `REVENUE` |
| 売上原価 | 変動費（食費・交通費・日用品） | `COGS` |
| 販管費 | 固定費（家賃・光熱費・通信・保険） | `EXPENSE` |
| 営業利益 | 収入 − 支出 ＝ 貯蓄額 | `PROFIT` |
| 営業利益率 | **貯蓄率**（= 貯蓄額 ÷ 収入） | KPI |
| YoY / MoM | 前年同月・前月の収支変化 | KPI |
| 予実対比 | 月予算 vs 実支出 | レポート |
| 将来予測 | 来月・来年の支出・貯蓄見通し | 予測機能 |

### 運用方針

- **マスタ登録だけで即日運用可能**。コードの変更は不要。
- 勘定科目コードは法人用（`4000`〜）と家庭用（`H1000`〜）を共存させて識別する。
- 部門を「家族メンバー」や「用途分類」として使い、個人別・用途別の内訳分析が可能。
- RBAC・MFA・監査ログは家庭運用では使用しなくてもよいが、家族共有で editor/viewer ロールを活用することもできる。

### 家庭向け勘定科目体系

```
収入（REVENUE）
  H1000  給与・賞与
  H1100  副業・フリーランス収入
  H1200  投資・配当収益

変動費（COGS）— 月ごとに変動する支出
  H2000  食費
  H2100  日用品・消耗品
  H2200  交通・移動費
  H2300  娯楽・交際費

固定費（EXPENSE）— 毎月ほぼ一定の支出
  H3000  家賃・住宅ローン
  H3100  水道光熱費
  H3200  通信費（スマホ・ネット）
  H3300  保険料（生命・医療・自動車）
  H3400  教育費
  H3500  医療・健康費

貯蓄（PROFIT）
  H9000  貯蓄・投資積立
```

---

## 8. 非機能要件

| 区分 | 要件 |
| --- | --- |
| 性能 | 主要画面 2 秒以内、集計バッチは夜間完了 |
| セキュリティ | 認証 + MFA、RBAC、TLS、監査ログ |
| 可用性 | 平日業務時間帯 99.5% |
| データ保全 | 日次バックアップ、保持期間設定 |
| 拡張性 | 勘定科目・部門・指標の追加に柔軟対応 |
