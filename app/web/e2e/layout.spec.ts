import { expect, test } from "@playwright/test";

// 画面の共通の作り（対象年度・予算と実績のタブの並び・一覧）の E2E。
// DB の migrate + seed が前提。ログインは e2e/auth.setup.ts で 1 回だけ行い、保存したセッションを使う。
test.describe("共通の作り", () => {
  test("対象年度は左のメニューで選び、画面の見出しにも出る", async ({ page }) => {
    await page.goto("/budget");
    const switcher = page.getByRole("group", { name: "対象年度" }).first();
    const year = new Date().getFullYear();
    await expect(switcher.getByLabel("対象年度を選ぶ")).toHaveValue(String(year));
    await expect(
      page.locator("main").getByText(`${year}年`, { exact: true }).first(),
    ).toBeVisible();

    await switcher.getByRole("button", { name: "前の年度" }).click();
    await expect(switcher.getByLabel("対象年度を選ぶ")).toHaveValue(String(year - 1));
    // 別の画面へ移っても同じ年度
    await page.goto("/entry");
    await expect(
      page.getByRole("group", { name: "対象年度" }).first().getByLabel("対象年度を選ぶ"),
    ).toHaveValue(String(year - 1));
    // 元に戻す
    await page
      .getByRole("group", { name: "対象年度" })
      .first()
      .getByRole("button", { name: "次の年度" })
      .click();
  });

  test("予算管理のタブは 一覧 → 予算の確定 → CSV → 履歴 → 設定 の順", async ({ page }) => {
    await page.goto("/budget");
    await expect(page.getByRole("tab")).toHaveText([
      "一覧",
      "予算の確定",
      "CSV インポート",
      "履歴",
      "設定",
    ]);
  });

  test("実績管理のタブは 一覧 → 実績の確定 → カレンダー → CSV → 履歴 の順", async ({ page }) => {
    await page.goto("/entry");
    await expect(page.getByRole("tab")).toHaveText([
      "一覧",
      "実績の確定",
      "カレンダー",
      "CSV インポート",
      "履歴",
    ]);
    // 一覧は予算と同じ表（月ごとの合計の行がある）
    await expect(page.getByRole("cell", { name: "差引" })).toBeVisible();
  });
});
