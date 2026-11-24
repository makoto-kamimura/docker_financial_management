import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Prisma 7 はドライバーアダプター経由で DB に接続する（PostgreSQL は node-postgres の @prisma/adapter-pg）。
// 接続は最初のクエリまで張らないので、ビルド時のダミーの DATABASE_URL でも import できる。
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

// 開発時のホットリロードで接続が増殖しないよう、グローバルに 1 インスタンスを保持する
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
