import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ドメインロジック（src/lib）の単体テスト設定。
// DB に依存しない純粋関数を対象とする。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
