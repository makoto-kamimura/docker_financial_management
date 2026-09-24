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
    // KPI カード（F-11: 初期 viewMode は household）。
    // 「収入」は KPI カード・構成比グラフの凡例・月次収支サマリーの見出しにも出るため first() で先頭を見る。
    await expect(page.getByText("収入", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("貯蓄額")).toBeVisible();
    // 予測手法セレクタ（構成比グラフの将来月の予測に使う）
    await expect(page.getByText("予測手法")).toBeVisible();
  });

  test("予測手法を切り替えても表示が維持される", async ({ page }) => {
    // holt_winters オプションを持つ予測手法セレクトを直接指定
    const select = page.locator('select:has(option[value="holt_winters"])');
    await select.selectOption("holt_winters");
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
  });

  test("実績管理画面へ遷移できる", async ({ page }) => {
    await page.getByRole("link", { name: "実績管理" }).click();
    await expect(page).toHaveURL(/\/entry/);
    await expect(page.getByRole("heading", { name: "実績管理" })).toBeVisible();
  });
});
