# CI/CD 説明資料（cicd.md）

決算管理システムの継続的インテグレーション（CI）／継続的デリバリー（CD）の構成と運用方針をまとめる。
ローカルでの実行手順は [`operation.md`](operation.md) を参照。

---

## 1. 全体像

```
   ┌──────────────────── Pull Request / push(main) ────────────────────┐
   │                                                                    │
   │   CI (.github/workflows/ci.yml)                                    │
   │   ┌──────────────┐        ┌──────────────────────────┐            │
   │   │  web job     │        │  migrate-check job       │            │
   │   │ install      │        │ (PostgreSQL service)     │            │
   │   │ prisma gen   │        │ prisma migrate deploy    │            │
   │   │ typecheck    │        │ prisma generate          │            │
   │   │ test (vitest)│        └──────────────────────────┘            │
   │   │ build        │                                                 │
   │   └──────────────┘                                                 │
   └────────────────────────────────────────────────────────────────────┘
                                   │ merge to main / tag v*
                                   ▼
   ┌──────────────────── CD (.github/workflows/cd.yml) ─────────────────┐
   │   build-and-push job  →  GHCR にイメージ push                       │
   │   deploy job          →  本番反映（基盤に応じて実装：プレースホルダ）│
   └────────────────────────────────────────────────────────────────────┘
```

- **CI**: 変更のたびに品質ゲート（型・テスト・ビルド・マイグレーション）を実行する。
- **CD**: `main` への取り込み・リリースタグで成果物（Docker イメージ）を作成し、本番へ配信する。

---

## 2. CI（`.github/workflows/ci.yml`）

### トリガー
- `pull_request`（すべての PR）
- `push`（`main` ブランチ）

### ジョブ
| ジョブ | 目的 | 主なステップ |
| --- | --- | --- |
| `web` | アプリの品質ゲート | `npm ci` → `prisma generate` → `typecheck` → `test` → `build` |
| `migrate-check` | マイグレーションの健全性検証 | PostgreSQL サービスを起動し `prisma migrate deploy` |
| `e2e` | 画面の通しテスト | PostgreSQL で migrate + seed → `build` → Playwright（chromium）実行、レポートを artifact 保存 |

### ポイント
- Node.js 22 / `actions/setup-node` の npm キャッシュを利用。
- `web` ジョブのビルドは DB へ接続しないため `DATABASE_URL` はダミーで可。
- `migrate-check` は `services.postgres`（`postgres:16-alpine`）に対して実際にマイグレーションを適用し、スキーマ崩れを早期検知する。

### ローカルでの同等チェック
```bash
cd app/web
npm run typecheck
npm run test
npm run build
```

---

## 3. 自動テスト

- フレームワーク: **Vitest**（設定: `app/web/vitest.config.ts`）。
- 対象: `src/**/*.test.ts`（DB 非依存の純粋なドメインロジック）。
- 実行: `npm run test`（CI）/ `npm run test:watch`（開発時）。

### テスト対象
| ファイル | 検証内容 |
| --- | --- |
| `src/lib/aggregate.test.ts` | 月次/四半期/年次の集計・キー生成 |
| `src/lib/forecast.test.ts` | 各予測手法（線形/移動平均/成長率/Holt/Holt-Winters）と dispatch |
| `src/lib/kpi.test.ts` | 利益率・MoM・YoY・YTD の算出 |
| `src/lib/report.test.ts` | 予実対比（差異・達成率・合計） |
| `src/lib/totp.test.ts` | Base32・TOTP 検証・otpauth URI |

### E2E テスト（Playwright）
- 設定: `app/web/playwright.config.ts`（`webServer` で本番ビルドを起動、baseURL `http://localhost:3000`）。
- 対象: `app/web/e2e/*.spec.ts`
  - `auth.spec.ts`: 認証ガード（未ログイン時のリダイレクト、ログイン画面、誤資格情報）— DB シード不要。
  - `dashboard.spec.ts`: ログイン〜ダッシュボード（KPI/グラフ）〜予実対比レポート〜実績入力 — シード必要。
- 実行: `npm run e2e`（初回は `npm run e2e:install` でブラウザ導入）。
- CI の `e2e` ジョブで PostgreSQL を用意して自動実行する。

---

## 4. CD（`.github/workflows/cd.yml`）

### トリガー
- `push`（`main`）
- `push`（`v*` タグ）
- `workflow_dispatch`（手動）

### ジョブ
| ジョブ | 目的 |
| --- | --- |
| `build-and-push` | `platform/docker/web.Dockerfile` でイメージをビルドし、GHCR（`ghcr.io/<repo>/web`）へ push |
| `deploy` | 本番サーバーへ **SSH + Docker Compose** で自動反映（`environment: production`） |

### タグ付け（`docker/metadata-action`）
- ブランチ名（`main`）
- セマンティックバージョン（`v1.2.3` → `1.2.3`）
- コミット SHA

### deploy ジョブの処理（SSH + Docker Compose）
1. デプロイ対象イメージタグを決定（`main` push → `:main` / `vX.Y.Z` → `:X.Y.Z`）。
2. `platform/docker-compose.prod.yml` をサーバーへ scp 配置。
3. SSH して `docker compose pull` → `up -d` で更新。
4. `docker compose run --rm web npx prisma migrate deploy` で DB マイグレーション。
5. `docker image prune -f` で古いイメージを掃除。

本番サーバーの前提（Docker / `.env` の配置など）と必要 Secrets の一覧は
[`operation.md`](operation.md) 「11. デプロイ」を参照。

### 必要な GitHub Secrets（要約）
| シークレット | 用途 |
| --- | --- |
| `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_PATH` | SSH デプロイ（必須） |
| `DEPLOY_PORT` | SSH ポート（任意・既定 22） |
| `GHCR_USER` / `GHCR_PAT` | GHCR が private の場合のサーバー側ログイン（任意） |
| `GITHUB_TOKEN` | GHCR への push（Actions が自動付与） |

> シークレットは GitHub の **Settings → Secrets and variables → Actions** に登録する。
> `deploy` ジョブは `environment: production` を使うため、必要に応じて承認（required reviewers）を設定できる。

---

## 5. リリースの流れ（推奨）

1. 機能ブランチで開発 → PR を作成（CI が自動実行）。
2. CI グリーンを確認しレビュー → `main` へマージ。
3. マージで CD が起動し、イメージが GHCR に push される。
4. リリースする場合は `vX.Y.Z` タグを push（バージョン付きイメージ + deploy）。
5. デプロイ後、マイグレーション（`prisma migrate deploy`）が適用されることを確認。

---

## 6. データベースマイグレーション運用

- 開発: `npm run db:migrate`（`prisma migrate dev`、マイグレーション生成 + 適用）。
- CI: `prisma migrate deploy`（既存マイグレーションの適用検証）。
- 本番: デプロイ手順内で `prisma migrate deploy` を実行（自動マイグレーション）。
- スキーマ変更時は必ずマイグレーションファイルをコミットする。

---

## 7. 関連ファイル

| パス | 役割 |
| --- | --- |
| `.github/workflows/ci.yml` | CI 定義 |
| `.github/workflows/cd.yml` | CD 定義 |
| `app/web/vitest.config.ts` | テスト設定 |
| `app/web/src/lib/*.test.ts` | 単体テスト |
| `platform/docker/web.Dockerfile` | Web イメージ定義 |
| `platform/docker-compose.prod.yml` | 本番用 Compose |
| `platform/scripts/backup.sh` / `restore.sh` | バックアップ/リストア |
