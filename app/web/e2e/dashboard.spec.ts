import { expect, test } from "@playwright/test";

// ログイン後のフローの E2E（DB の migrate + seed が前提）。
// シードユーザー: admin@example.com / password
test.describe("ダッシュボードと主要フロー", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("admin@example.com");
    await page.getByLabel("パスワード").fill("password");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("ダッシュボードに KPI と推移グラフが表示される", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    // KPI カード
    await expect(page.getByText("売上高")).toBeVisible();
    await expect(page.getByText("営業利益率")).toBeVisible();
    // 予測手法セレクタ
    await expect(page.getByText("予測手法")).toBeVisible();
  });

  test("予測手法を切り替えても表示が維持される", async ({ page }) => {
    const select = page.locator("select").first();
    await select.selectOption("holt_winters");
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
  });

  test("予実対比レポートへ遷移して表が表示される", async ({ page }) => {
    await page.getByRole("link", { name: "予実対比レポート" }).click();
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole("heading", { name: /予実対比レポート/ })).toBeVisible();
    await expect(page.getByText("達成率")).toBeVisible();
    // CSV 出力ボタンが存在する
    await expect(page.getByRole("button", { name: "CSV 出力" })).toBeVisible();
  });

  test("実績入力画面へ遷移できる", async ({ page }) => {
    await page.getByRole("link", { name: "実績入力" }).click();
    await expect(page).toHaveURL(/\/entry/);
    await expect(page.getByRole("heading", { name: "実績データ入力" })).toBeVisible();
  });
});
