# 決算管理システム Web (Next.js) 用 Dockerfile
# ビルドコンテキストはリポジトリルートを想定: docker build -f platform/docker/web.Dockerfile .

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
RUN npm run build

# 実行
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# マイグレーション(prisma migrate deploy)と起動に必要なファイルを同梱
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["npm", "run", "start"]
