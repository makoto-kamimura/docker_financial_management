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

> API ルートや UI の結合/E2E テスト（route handlers / Playwright）は `task.md` のバックログに記載。

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
| `deploy` | 本番環境へ反映（基盤未確定のためプレースホルダ。`environment: production`） |

### タグ付け（`docker/metadata-action`）
- ブランチ名（`main`）
- セマンティックバージョン（`v1.2.3` → `1.2.3`）
- コミット SHA

### deploy ジョブの実装方針
利用する基盤に合わせて、`deploy` ジョブのプレースホルダを置き換える。代表例:
- **SSH + Docker Compose**: リモートホストで `docker compose -f platform/docker-compose.prod.yml pull && up -d` ＋ `npm run db:migrate`
- **AWS ECS / Google Cloud Run**: 新イメージのタスク定義/リビジョン反映
- **Kubernetes**: `kubectl set image` / `helm upgrade`

### 必要なシークレット（例）
| シークレット | 用途 |
| --- | --- |
| `GITHUB_TOKEN` | GHCR への push（Actions が自動付与） |
| `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` | SSH デプロイ |
| `DATABASE_URL` | 本番 DB 接続 |

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
