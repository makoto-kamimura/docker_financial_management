# app/web

カケイカイケイの **Web アプリケーション**。Next.js（App Router）で、画面とバックエンドの API（Route Handlers、`/api/*`）を提供する。

仕様・構成・起動の手順はリポジトリ直下の [readme.md](../../readme.md) にまとめている。

| 知りたいこと                       | readme の節                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| 画面の一覧                         | [5.1 Web](../../readme.md#51-web)                                                    |
| ディレクトリ構成                   | [18.4 リポジトリ構成](../../readme.md#184-リポジトリ構成)                            |
| 起動・テスト・よく使うコマンド     | [18.7 クイックスタート](../../readme.md#187-クイックスタート)                        |
| 認証・テナント分離・API の共通処理 | [19章](../../readme.md#19-認証の実装)・[20章](../../readme.md#20-機能ごとの実装方針) |
| データモデル・API                  | [21章](../../readme.md#21-データモデル)・[22章](../../readme.md#22-api)              |

## 開発

```bash
npm install
npm run db:generate   # Prisma Client を生成する
npm run db:migrate    # マイグレーションを適用する（PostgreSQL が要る）
npm run db:seed       # 初期データを入れる
npm run dev           # http://localhost:3000
```

DB と Redis は `docker compose -f ../../platform/docker-compose.yml up -d db redis` で起動できる。接続先は `.env` の `DATABASE_URL`・`REDIS_URL` で設定する。

`src/lib/` のうち `shared-with-mobile.ts` に載っているファイルはモバイルと共有している。直したら `npm run sync:mobile` を実行する（[readme 18.5節](../../readme.md#185-web-とモバイルのロジック共有)）。
