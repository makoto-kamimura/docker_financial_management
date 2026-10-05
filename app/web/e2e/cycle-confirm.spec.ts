import { test, expect } from "@playwright/test";

// 予実差確認・予算の確定（予算管理）と実績の確定（実績管理）のタブ。
// DB の migrate + seed が前提。ログインは e2e/auth.setup.ts で 1 回だけ行い、保存したセッションを使う。
// 年は左のメニュー、月は月ボタンで選ぶ。?month= で開くと、その年月が選ばれる。
test.describe("予算と実績の確定", () => {
  test("予算管理の「予実差確認」タブを ?tab=variance で開ける", async ({ page }) => {
    await page.goto("/budget?tab=variance&month=2026-05");
    await expect(page.getByRole("tab", { name: "予実差確認" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const months = page.getByRole("group", { name: "比べる月" });
    await expect(months.getByRole("button", { name: "5月" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("予算管理の「予算の確定」タブを ?tab=confirm で開くと、その月の予算案が出る", async ({
    page,
  }) => {
    await page.goto("/budget?tab=confirm&month=2026-05");
    await expect(page.getByRole("tab", { name: "予算の確定" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const months = page.getByRole("group", { name: "予算の月" });
    await expect(months.getByRole("button", { name: "5月" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("heading", { name: "2026年5月の予算案" })).toBeVisible();
  });

  test("実績管理の「実績の確定」タブで明細の最終日と確定ボタンが出る", async ({ page }) => {
    await page.goto("/entry?tab=confirm&month=2026-05");
    const months = page.getByRole("group", { name: "対象月" });
    await expect(months.getByRole("button", { name: "5月" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("heading", { name: /5月の実績/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^5月の実績(を確定|の確定を解除)$/ }),
    ).toBeVisible();
  });
});
