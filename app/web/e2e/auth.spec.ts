import { expect, test } from "@playwright/test";

// 認証・アクセス制御の E2E（DB シード不要）。
test.describe("認証ガード", () => {
  test("未ログインで保護ページにアクセスするとログインへリダイレクトされる", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    // リダイレクト元が保持される
    await expect(page).toHaveURL(/redirect=%2Fdashboard/);
  });

  test("/reports も保護されている", async ({ page }) => {
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/login/);
  });

  test("ログイン画面のフォームが表示される", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ログイン" })).toBeVisible();
  });

  test("誤った資格情報ではエラーが表示される", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("nobody@example.com");
    await page.getByLabel("パスワード").fill("wrong");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByText(/正しくありません/)).toBeVisible();
  });

  test("トップページから各画面へ遷移できる", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "決算管理システム" })).toBeVisible();
    await expect(page.getByRole("link", { name: /ログイン/ })).toBeVisible();
  });
});
