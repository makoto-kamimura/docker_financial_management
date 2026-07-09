import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// 実 DB が必要な結合テスト専用の設定。
// テナント越境の分離を、実際のルートハンドラ経由で検証する（tenant-isolation.integration.test.ts）。
// 実行前に platform-db（postgres:5432）が起動していること。
// Next のランタイム外で動くため、DATABASE_URL を .env から明示的に読み込んで注入する。
const env = loadEnv("", process.cwd(), "");

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    env: { DATABASE_URL: env.DATABASE_URL },
    // 同一 DB を共有するため直列実行（テスト間のデータ汚染・デッドロックを避ける）
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
