#!/bin/sh
set -e

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
