# 決算管理システム Web (Next.js) 用 Dockerfile
# ビルドコンテキストはリポジトリルートを想定: docker build -f platform/docker/web.Dockerfile .
# 除外するファイルは web.Dockerfile.dockerignore（ホストの node_modules・.next を入れない）。

FROM node:22-alpine AS base
WORKDIR /app

# 依存関係のインストール（lockfile に厳密一致）
FROM base AS deps
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci

# ビルド
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY app/web ./
# Prisma Client を生成（@prisma/client のため必須）
RUN npx prisma generate
# next build 中の PrismaClient 生成に備えたダミー接続文字列（DB へは接続しない）
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
# lint と型チェックは CI（web ジョブ）で済ませているので、イメージのビルドでは飛ばす
# （next build の中で tsc と eslint を全体に走らせると、メモリのピークが重なるため）。
ENV SKIP_TYPECHECK=1
# メモリの上限。足りないときはホストを巻き込まずに、このビルドだけが失敗する
ENV NODE_OPTIONS=--max-old-space-size=2048
# .next/cache（ビルドの中間キャッシュ）は実行時に要らないので消す
RUN npx next build --no-lint && rm -rf .next/cache

# 実行
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# migrate deploy・seed・起動に必要なファイルを同梱
COPY --from=builder /app/prisma ./prisma
# 初期データ投入（prisma/seed.ts）が読む lib（tsx で実行する。新しい DB の初回起動時だけ使う）
COPY --from=builder /app/src/lib ./src/lib
COPY platform/docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh && mkdir -p /app/uploads
EXPOSE 3000
# 起動時に migrate deploy → 初回のみ seed → next start を順に実行する
CMD ["./entrypoint.sh"]
