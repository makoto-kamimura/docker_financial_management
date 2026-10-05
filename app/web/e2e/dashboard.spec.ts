import { expect, test } from "@playwright/test";

// ログイン後のフローの E2E（DB の migrate + seed が前提）。
// ログインは e2e/auth.setup.ts で 1 回だけ行い、保存したセッションを使う（playwright.config.ts）。
test.describe("ダッシュボードと主要フロー", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("ダッシュボードに KPI が表示される", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "ダッシュボード" })).toBeVisible();
    // KPI カード（F-11: 初期 viewMode は household）。
    // 「収入」は KPI カード・予算と実績のグラフにも出るため first() で先頭を見る。
    await expect(page.getByText("収入", { exact: true }).first()).toBeVisible();
    // 説明文にも「貯蓄額」が出るので、KPI カード（role=group）で見る
    await expect(page.getByRole("group", { name: "貯蓄額", exact: true })).toBeVisible();
    // 構成比のグラフは置かない
    await expect(page.getByText("カテゴリ構成比")).toHaveCount(0);
  });

  test("KPI の下に確定の状況と予算と実績のグラフが表示される", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "予算と実績の確定" })).toBeVisible();
    // 状況は KPI の対象月の ①②③。各段は予算管理・実績管理の確定タブへのリンク
    await expect(page.getByRole("link", { name: /② \d+月の実績/ })).toHaveAttribute(
      "href",
      /\/entry\?tab=confirm&month=/,
    );
    await expect(page.getByRole("heading", { name: /^予算と実績（/ })).toBeVisible();
  });

  test("実績管理画面へ遷移できる", async ({ page }) => {
    await page.getByRole("link", { name: "実績管理" }).click();
    await expect(page).toHaveURL(/\/entry/);
    await expect(page.getByRole("heading", { name: "実績管理" })).toBeVisible();
  });
});
