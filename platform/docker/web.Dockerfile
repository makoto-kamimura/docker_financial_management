# 決算管理システム Web (Next.js) 用 Dockerfile
# ビルドコンテキストはリポジトリルートを想定: docker build -f platform/docker/web.Dockerfile .

FROM node:22-alpine AS base
WORKDIR /app

# 依存関係のインストール
FROM base AS deps
COPY app/web/package.json ./
RUN npm install

# ビルド
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY app/web ./
RUN npm run build

# 実行
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "run", "start"]
