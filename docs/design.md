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
| GET | `/api/forecasts?accountCode=&months=N` | 過去実績から将来 N か月の推移を予測 |
| POST | `/api/auth/login` | ログイン（セッション Cookie 発行） |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | 現在のログインユーザー取得 |

> Phase 1 で **Prisma + PostgreSQL** による永続化に移行済み。実績は `prisma/seed.ts` で初期投入できる。

### 画面（Phase 1 実装済み）
- `/login` … ログイン
- `/dashboard` … 売上の実績＋予測の推移グラフ（Recharts）
- `/entry` … 実績データの手入力フォーム

### 認証方式
- メール + パスワード（scrypt ハッシュ、`node:crypto`）でログイン。
- セッションは DB（`sessions`）に保存し、httpOnly Cookie（`fm_session`）で識別。
- 役割（admin / editor / viewer）を `users.role` で保持（RBAC は Phase 4 で本格化）。

---

## 6. データモデル（概略）

- `accounts`（勘定科目）: id, code, name, category
- `departments`（部門）: id, name, parent_id
- `periods`（会計期間）: id, fiscal_year, quarter, month
- `financial_records`（実績）: id, account_id, department_id, period_id, amount
- `forecasts`（予測）: id, account_id, period_id, method, scenario, amount
- `users`（ユーザー）: id, email, name, password_hash, role
- `sessions`（セッション）: id, user_id, expires_at
- `audit_logs`（監査ログ）: id, user_id, action, target, changed_at

> 実装は `app/web/prisma/schema.prisma` を正とする。

---

## 7. 非機能要件

| 区分 | 要件 |
| --- | --- |
| 性能 | 主要画面 2 秒以内、集計バッチは夜間完了 |
| セキュリティ | 認証 + MFA、RBAC、TLS、監査ログ |
| 可用性 | 平日業務時間帯 99.5% |
| データ保全 | 日次バックアップ、保持期間設定 |
| 拡張性 | 勘定科目・部門・指標の追加に柔軟対応 |
