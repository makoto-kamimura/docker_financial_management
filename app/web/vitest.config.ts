import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";

// ドメインロジック（src/lib）の単体テスト設定。
// DB に依存しない純粋関数を対象とする。
// 実 DB が必要な結合テスト（*.integration.test.ts）は除外し、
// vitest.integration.config.ts / `npm run test:integration` で別途実行する。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
