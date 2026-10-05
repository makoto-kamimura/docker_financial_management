import { test, expect } from "@playwright/test";

// 予算の確定（予算管理）と実績の確定（実績管理）のタブ。
// DB の migrate + seed が前提。シードユーザー: admin@example.com / password
test.describe("予算と実績の確定", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("admin@example.com");
    await page.getByLabel("パスワード").fill("password");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("予算管理の「予算の確定」タブを ?tab=confirm で開ける", async ({ page }) => {
    await page.goto("/budget?tab=confirm&month=2026-05");
    await expect(page.getByLabel("比べる月")).toHaveValue("2026-05");
    await expect(page.getByRole("button", { name: "予算の確定" })).toBeVisible();
  });

  test("実績管理の「実績の確定」タブで明細の最終日と確定ボタンが出る", async ({ page }) => {
    await page.goto("/entry?tab=confirm&month=2026-05");
    await expect(page.getByLabel("対象月")).toHaveValue("2026-05");
    await expect(page.getByRole("heading", { name: /5月の実績/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^5月の実績(を確定|の確定を解除)$/ }),
    ).toBeVisible();
  });
});
