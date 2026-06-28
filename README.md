# financial-management（決算管理システム）

財務データの取り込み・集計・将来予測を行い、個人事業主・法人の確定申告・決算を支援する統合会計管理システムです。Web とモバイルの両方から利用できます。

> **構築・起動方法は [`docs/operation.md`](docs/operation.md) に集約しています。**
> 仕様は [`docs/design.md`](docs/design.md)、CI/CD は [`docs/cicd.md`](docs/cicd.md)、デプロイ設計は [`docs/deploy.md`](docs/deploy.md)、変更履歴は [`docs/history.md`](docs/history.md)、開発タスクは [`docs/task.md`](docs/task.md) を参照してください。

---

## システム概要

| 項目 | 内容 |
| --- | --- |
| 想定ユーザー | 個人事業主・中小法人の経営者・経理担当・税理士 |
| 提供形態 | Web アプリ（PC ブラウザ） + モバイルアプリ（iOS / Android） |
| バックエンド | Next.js App Router Route Handlers |
| DB | PostgreSQL 16（Prisma ORM） |
| キャッシュ | Redis 7（TTL 1 時間） |

---

## 主な機能

### 基本集計・予測・ダッシュボード
- **データ取込**: CSV 一括インポート、手入力フォーム、実績履歴管理
- **集計**: 月次 / 四半期 / 年次の自動集計、KPI（利益率・YoY・MoM・YTD）
- **将来予測**: 5 手法（移動平均 / 線形回帰 / 成長率 / Holt / Holt-Winters）＋ シナリオ（楽観・標準・悲観）＋ 精度評価（MAPE / RMSE）
- **予算管理**: 月別予算クロス集計・インライン編集、予実対比レポート（CSV / PNG / PDF 出力）
- **構成比グラフ**: 円グラフ・積み上げ棒グラフ

### 個人事業主・確定申告支援
- 複式簿記による仕訳入力（テンプレート仕訳・AI 仕訳提案）
- 証憑ファイルアップロード管理
- 棚卸管理（評価方法：最終仕入原価法 / 総平均法 / 移動平均法）
- 固定資産・減価償却（定額法・定率法）
- 家事按分管理
- 売掛金・買掛金管理（入金・支払時の仕訳自動生成）
- 消費税設定（免税 / 原則課税 / 簡易課税）
- 決算処理・年度締め、青色申告決算書 印刷（P/L・B/S・月別収支・家事按分計算書）
- 総勘定元帳・試算表（JSON / CSV 出力）
- e-Tax / eLTAX 向け XML 生成（青色申告・法人税・消費税）

### 法人・統合会計（マルチテナント対応）
- マルチテナント管理（SOLE_PROPRIETOR / CORPORATION）・会計年度管理
- 銀行口座・資金管理、借入金・返済管理
- 適格請求書（インボイス）発行・ステータス管理
- 未収金・未払金管理
- 法人向け決算書出力（P/L・B/S・株主資本等変動計算書・法人税概算）
- 財務分析指標（流動比率・自己資本比率・ROA / ROE 等）
- 法人ガバナンス（役員・株主総会・配当・決算公告）
- 電子帳簿保存法対応（仕訳承認ワークフロー）

### セキュリティ・運用
- 認証（メール + パスワード）・httpOnly Cookie セッション
- RBAC（admin / editor / accountant / viewer の 4 ロール）
- MFA（TOTP・RFC 6238、外部依存なし）・リカバリーコード
- 監査ログ（before / after 差分記録）、パスワードポリシー・アカウントロック
- ユーザー管理画面（ロール変更・パスワードリセット・新規作成）

### 外部連携・その他
- freee / マネーフォワード API 連携（OAuth 2.0 skeleton）
- オープンバンキング API 連携
- 税理士ポータル（テナント横断財務サマリ）
- 国際化（日本語 / English 切り替え）
- a11y 対応（スキップリンク・ARIA・reduced-motion）
- 観点切り替え（家計 / 個人会計 / 法人 の 3 モード）

---

## 技術スタック

| レイヤー | 採用技術 | バージョン |
| --- | --- | --- |
| Web フロント | TypeScript / React / Next.js (App Router) / Recharts / TanStack Query / Tailwind CSS | Next.js 15 |
| バックエンド | Next.js Route Handlers (`/api/*`) / Zod | — |
| ORM | Prisma + PostgreSQL | Prisma 6 / PG 16 |
| キャッシュ | Redis（`redis` npm パッケージ） | Redis 7 |
| モバイル | Expo / React Native / react-native-svg | Expo 54 |
| テスト | Vitest（単体）/ Playwright（E2E） | — |
| インフラ | Docker Compose | — |
| CI/CD | GitHub Actions / GHCR | — |

---

## アーキテクチャ

```
[Web フロントエンド (React)]    [Mobile (React Native)]
             │                           │
             └──────────────┬────────────┘
                            │ HTTPS (REST / JSON)
                            ▼
         [Next.js Route Handlers  /api/*]
            認証/認可・集計・予測・レポート
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
       [PostgreSQL]      [Redis]     [uploads vol]
        (Prisma)      (キャッシュ)   (証憑ファイル)
```

### プロジェクト構成（モノレポ）

```
.
├── app/
│   ├── web/             # Next.js（フロント + バックエンド API）
│   └── mobile/          # Expo / React Native
├── platform/
│   ├── docker/
│   ├── docker-compose.yml        # 開発環境（web + db + redis + cron）
│   ├── docker-compose.prod.yml   # 本番環境
│   └── scripts/                  # backup.sh / restore.sh
└── docs/
    ├── design.md        # 仕様・設計書
    ├── operation.md     # 構築・運用手順
    ├── cicd.md          # CI/CD 解説
    ├── deploy.md        # デプロイ設計
    ├── task.md          # 開発タスク管理
    └── history.md       # 変更履歴
```

---

## デモ画面

ダッシュボード（1920×1080）のイメージです。KPI カードと、売上の実績＋将来予測の推移グラフを表示します。

![ダッシュボード デモ（1920×1080）](docs/images/dashboard-demo.svg)

> 上図はレイアウトを示すイメージ図です。実機のスクリーンショットは、ローカルでアプリと DB を起動した状態で次のコマンドで生成できます（`docs/images/dashboard.png` に出力）。
>
> ```bash
> cd app/web
> npm run e2e:install                 # 初回のみ: ブラウザ導入
> docker compose -f ../../platform/docker-compose.yml up -d db redis
> npm run db:migrate && npm run db:seed
> npm run build && npm run start &    # アプリ起動
> npm run screenshot                  # 1920×1080 で撮影 → docs/images/dashboard.png
> ```
>
> 生成後、上の画像参照を `docs/images/dashboard.png` に差し替えてください。

---

## クイックスタート

### Docker（推奨）

```bash
# ビルド & 起動（web + db + redis）
docker compose -f platform/docker-compose.yml up --build

# 初回のみ: マイグレーション + シード
docker compose -f platform/docker-compose.yml exec web npm run db:migrate
docker compose -f platform/docker-compose.yml exec web npm run db:seed
```

### ローカル開発

```bash
# DB・Redis だけ Docker で起動
docker compose -f platform/docker-compose.yml up -d db redis

cd app/web
npm install
npm run db:generate   # Prisma Client 生成
npm run db:migrate    # マイグレーション
npm run db:seed       # 初期データ投入
npm run dev           # http://localhost:3000
```

### 初期ログインアカウント（パスワードはいずれも `password`）

| メール | ロール | 権限 |
| --- | --- | --- |
| `admin@example.com` | admin | 全操作 + ユーザー管理 + 監査ログ |
| `editor@example.com` | editor | データ登録・編集・削除 |
| `viewer@example.com` | viewer | 閲覧のみ |

`accountant` ロールは `/admin/users` でロール変更して使用する。

---

## モバイルアプリ

```bash
cd app/mobile
npm install
npm run start    # Expo Dev Server 起動 → QR コードを Expo Go で読み取る
# npm run ios    # iOS Simulator
# npm run android  # Android Emulator
```

実機から接続する場合は `app/mobile/app.json` の `extra.apiBaseUrl` を開発 PC の LAN IP に変更する。

```json
"extra": {
  "apiBaseUrl": "http://192.168.x.x:3000/api"
}
```

---

## 主要画面

| URL | 画面名 |
| --- | --- |
| `/dashboard` | KPI カード・予実推移グラフ・将来予測 |
| `/entry` | 実績管理（CSV インポート・手入力） |
| `/assets` | 資産管理（純資産推移グラフ） |
| `/budget` | 予算管理 |
| `/reports` | 予実対比レポート |
| `/journals` | 仕訳帳（承認ワークフロー付き） |
| `/journal-templates` | 仕訳テンプレート |
| `/reports/ledger` | 総勘定元帳（CSV 出力） |
| `/receivables` / `/payables` | 売掛金・買掛金管理 |
| `/invoices` | インボイス（適格請求書）発行 |
| `/inventories` | 棚卸管理 |
| `/fixed-assets` | 固定資産管理 |
| `/apportionments` | 家事按分管理 |
| `/bank-accounts` / `/loans` | 銀行・資金管理・借入金管理 |
| `/closing` | 決算処理（P/L・B/S・財務分析） |
| `/closing/print` | 青色申告書類 印刷 |
| `/closing/corporate-print` | 法人決算書類 印刷 |
| `/corporate` | 法人・事業者情報管理 |
| `/fiscal-years` | 会計年度管理 |
| `/governance` | 法人ガバナンス管理 |
| `/linked-accounts` | 口座・カード管理 |
| `/integrations` | 外部サービス連携 |
| `/portal` | 税理士ポータル |
| `/masters` | マスタ管理（勘定科目・部門・会計期間） |
| `/settings` | 設定（事業者情報・消費税設定・MFA） |
| `/admin/users` | ユーザー管理（admin） |
| `/admin/audit` | 監査ログ（admin） |

---

## CI/CD

- **CI** (`ci.yml`): PR・`main` push ごとに型チェック・単体テスト（Vitest）・ビルド・マイグレーション検証・E2E（Playwright）を自動実行。
- **CD** (`cd.yml`): `main` push または `v*` タグで Docker イメージを GHCR に push し、SSH + Docker Compose で本番自動デプロイ。ヘルスチェック失敗時は直前イメージへ自動ロールバック。

詳細は [`docs/cicd.md`](docs/cicd.md) / [`docs/deploy.md`](docs/deploy.md) を参照。

---

## 非機能要件

| 区分 | 要件 |
| --- | --- |
| 性能 | 主要画面 2 秒以内（重い集計は Redis キャッシュで TTL 1h） |
| セキュリティ | 認証 + MFA、RBAC（4 ロール）、TLS、監査ログ |
| 可用性 | 平日業務時間帯 99.5% |
| データ保全 | 日次バックアップ、保持期間設定（既定 30 日） |
| 拡張性 | 勘定科目・部門・テナントの追加に柔軟対応 |
