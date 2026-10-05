import { expect, test as setup } from "@playwright/test";

// ログインを 1 回だけ行い、セッション（Cookie・localStorage）を保存する。
// ログイン後のテストはこれを使う（playwright.config.ts の storageState）。
// テストごとにログインすると、ログイン API の IP ごとの回数制限（5 分に 10 回）に
// リトライ分で届き、429 で失敗するため。
// シードユーザー: admin@example.com / password
const STORAGE_STATE = "e2e/.auth/admin.json"; // playwright.config.ts の storageState と同じ

setup("ログインしてセッションを保存する", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("admin@example.com");
  await page.getByLabel("パスワード").fill("password");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.context().storageState({ path: STORAGE_STATE });
});
