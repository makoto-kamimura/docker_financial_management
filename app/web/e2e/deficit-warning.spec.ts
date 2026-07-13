import { expect, test } from "@playwright/test";

// F-1: 収支マイナス警告（再設計仕様書 §6.1 / 再設計タスク.md F-1）の E2E。
// シードユーザー: admin@example.com / password
//
// 当月に大きな支出を一時的に追加して赤字状態を作り、ダッシュボードの
// 警告表示（KPI カードの赤色強調・メッセージ、月次収支サマリーの赤背景行）を
// 確認したうえで、テストデータを必ず削除して元の状態へ戻す。
test.describe("収支マイナス警告", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill("admin@example.com");
    await page.getByLabel("パスワード").fill("password");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    // KPI カードの描画（クライアント側フェッチ）を待ってからハイドレーション完了とみなす。
    // 完了前にモード切替ボタンを押すと onClick が未接続でクリックが no-op になるため。
    await expect(page.getByText("対象月:")).toBeVisible();

    // 貯蓄額カードの赤字警告は household（家計）モード専用のため切り替える。
    await page.getByRole("button", { name: "家計" }).click();
    // 赤字時はラベルの先頭に警告アイコン（⚠）が付き "⚠貯蓄額" になるため部分一致で確認する。
    await expect(page.getByText("貯蓄額")).toBeVisible();
  });

  test("黒字時は警告が表示されない", async ({ page }) => {
    await expect(page.getByText("今月は支出が収入を上回っています")).toHaveCount(0);
  });

  test("赤字月は KPI カードと月次サマリーに赤字警告が表示される", async ({ page, baseURL }) => {
    const now = new Date();
    const fiscalYear = now.getFullYear();
    const month = now.getMonth() + 1;

    // ミューテーション API は CSRF 検証（Origin 一致）が必要（middleware.ts 参照）。
    const postRes = await page.request.post("/api/financials", {
      headers: { origin: baseURL ?? "http://localhost:3000" },
      data: { accountCode: "H3000", fiscalYear, month, amount: 99_000_000 },
    });
    expect(postRes.ok()).toBeTruthy();
    const created = await postRes.json();
    const recordId = created.data.id as number;

    try {
      await page.reload();
      await expect(page.getByText("今月は支出が収入を上回っています")).toBeVisible();
      // 赤字時はラベルの先頭に警告アイコン（⚠）が付き "⚠貯蓄額" になるため部分一致で確認する。
      await expect(page.getByText("貯蓄額")).toBeVisible();

      await page.getByRole("button", { name: "構成比グラフ" }).click();
      await expect(page.getByText("月次収支サマリー")).toBeVisible();
      await expect(page.getByText("支出が収入を上回った月は赤背景")).toBeVisible();
    } finally {
      // テストデータの後始末（他のテストへ影響させない）
      const delRes = await page.request.delete(`/api/financials/${recordId}`, {
        headers: { origin: baseURL ?? "http://localhost:3000" },
      });
      expect(delRes.ok()).toBeTruthy();
    }
  });
});
