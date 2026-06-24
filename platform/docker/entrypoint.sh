#!/bin/sh
set -e

echo "[entrypoint] Resolving any previously failed migrations..."
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$executeRawUnsafe('UPDATE \"_prisma_migrations\" SET rolled_back_at = NOW() WHERE finished_at IS NULL AND rolled_back_at IS NULL')
  .then(() => p.\$disconnect())
  .catch(() => p.\$disconnect());
" || true

echo "[entrypoint] Running migrations..."
npx prisma migrate deploy

echo "[entrypoint] Checking if initial seed is needed..."
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count()
  .then(n => { p.\$disconnect(); process.exit(n === 0 ? 0 : 1); })
  .catch(() => { p.\$disconnect(); process.exit(0); });
" && npm run db:seed && echo "[entrypoint] Seed completed." || echo "[entrypoint] Seed skipped (data exists)."

echo "[entrypoint] Starting app..."
exec npm run start
