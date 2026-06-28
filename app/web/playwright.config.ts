import { defineConfig, devices } from "@playwright/test";

// E2E テスト設定。
// webServer で本番ビルド済みのアプリを起動し、ブラウザから操作する。
// DB 依存テストは事前に migrate + seed しておくこと（CI / operation.md 参照）。
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // E2E_BASE_URL が指定された場合は既存サーバーを使う（自前起動しない）
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
