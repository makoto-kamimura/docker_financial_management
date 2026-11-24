import { defineConfig } from "prisma/config";

// Prisma CLI（generate / migrate / db seed）の設定。
// Prisma 7 から接続先と seed の指定は schema.prisma・package.json ではなく、このファイルに書く。
// Prisma 7 は .env を自動では読まないので、app/web/.env があれば読む（環境変数が優先）。
try {
  process.loadEnvFile();
} catch {
  // .env が無ければ環境変数だけを使う（Docker・CI）
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // generate は DB に接続しないので、未設定でも動くようにしておく（migrate は接続先が要る）
    url: process.env.DATABASE_URL ?? "",
  },
});
