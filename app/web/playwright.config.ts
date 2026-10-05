import { defineConfig, devices } from "@playwright/test";

// E2E テスト設定。
// webServer で本番ビルド済みのアプリを起動し、ブラウザから操作する。
// DB 依存テストは事前に migrate + seed しておくこと（CI / readme.md「18.7 クイックスタート」参照）。
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
  projects: [
    // ログインを 1 回だけ行い、セッションを保存する（e2e/auth.setup.ts）
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // ログイン後の画面のテスト。保存したセッションを使う
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
      testIgnore: /auth\.(spec|setup)\.ts/,
    },
    // ログイン画面そのもののテスト。未ログインの状態で動かす
    { name: "chromium-anon", use: { ...devices["Desktop Chrome"] }, testMatch: /auth\.spec\.ts/ },
  ],
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
