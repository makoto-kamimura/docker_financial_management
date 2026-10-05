import { expect, test } from "@playwright/test";

// F-1: 収支マイナス警告（再設計仕様書 §6.1 / 再設計タスク.md F-1）の E2E。
// ログインは e2e/auth.setup.ts で 1 回だけ行い、保存したセッションを使う（playwright.config.ts）。
//
// 当月に大きな支出を一時的に追加して赤字状態を作り、ダッシュボードの
// 警告表示（KPI カードの赤色強調・メッセージ）を
// 確認したうえで、テストデータを必ず削除して元の状態へ戻す。
test.describe("収支マイナス警告", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    // KPI カードの描画（クライアント側フェッチ）を待ってからハイドレーション完了とみなす。
    // 完了前にモード切替ボタンを押すと onClick が未接続でクリックが no-op になるため。
    await expect(page.getByText("対象月:")).toBeVisible();

    // 貯蓄額カードの赤字警告は household（家計）モード専用のため切り替える。
    await page.getByRole("button", { name: "家計" }).click();
    // 説明文にも「貯蓄額」が出るので、KPI カード（role=group）で見る。
    // 赤字時の ⚠ は aria-hidden なので、カードの名前は「貯蓄額」のまま
    await expect(page.getByRole("group", { name: "貯蓄額", exact: true })).toBeVisible();
  });

  test("黒字時は警告が表示されない", async ({ page }) => {
    await expect(page.getByText("は支出が収入を上回っています")).toHaveCount(0);
  });

  test("赤字月は KPI カードに赤字警告が表示される", async ({ page, baseURL }) => {
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
      await expect(page.getByText("は支出が収入を上回っています")).toBeVisible();
      await expect(page.getByRole("group", { name: "貯蓄額", exact: true })).toBeVisible();
    } finally {
      // テストデータの後始末（他のテストへ影響させない）
      const delRes = await page.request.delete(`/api/financials/${recordId}`, {
        headers: { origin: baseURL ?? "http://localhost:3000" },
      });
      expect(delRes.ok()).toBeTruthy();
    }
  });
});
