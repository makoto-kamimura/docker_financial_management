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
    // KPI カード（exact: true でオプション要素との strict mode 違反を回避）
    await expect(page.getByText("売上高", { exact: true })).toBeVisible();
    await expect(page.getByText("営業利益率", { exact: true })).toBeVisible();
    // 予測手法セレクタ
    await expect(page.getByText("予測手法")).toBeVisible();
  });

  test("予測手法を切り替えても表示が維持される", async ({ page }) => {
    // holt_winters オプションを持つ予測手法セレクトを直接指定
    const select = page.locator('select:has(option[value="holt_winters"])');
    await select.selectOption("holt_winters");
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
  });

  test("レポートページへ遷移して表が表示される", async ({ page }) => {
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole("heading", { name: "レポート" })).toBeVisible();
    await expect(page.getByText("達成率")).toBeVisible();
    // CSV 出力リンクが存在する
    await expect(page.getByRole("link", { name: "CSV 出力" })).toBeVisible();
  });

  test("実績管理画面へ遷移できる", async ({ page }) => {
    await page.getByRole("link", { name: "実績管理" }).click();
    await expect(page).toHaveURL(/\/entry/);
    await expect(page.getByRole("heading", { name: "実績管理" })).toBeVisible();
  });
});
