# platform

決算管理システムのインフラ・実行基盤関連ファイルを配置する。

## 内容
- `docker/web.Dockerfile` … Web (Next.js) アプリのコンテナイメージ定義
- `docker-compose.yml` … ローカル開発用（web + PostgreSQL）
- `.env.example` … 環境変数のサンプル

## 使い方
```bash
cp platform/.env.example platform/.env
docker compose -f platform/docker-compose.yml up --build
# Web: http://localhost:3000
```
