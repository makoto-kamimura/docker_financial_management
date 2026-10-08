import { describe, expect, it } from "vitest";
import { buildBudgetCellDetail } from "./budget-cell-detail";

const item = (id: number, amount: number) => ({
  id,
  date: "2026-10-05",
  description: `項目${id}`,
  amount,
  createdAt: "2026-10-01T00:00:00Z",
});

describe("buildBudgetCellDetail", () => {
  it("カレンダーの登録・残り（一覧などで入れた額）・自動加算に分ける", () => {
    const r = buildBudgetCellDetail({
      budgetAmount: 50_000,
      items: [item(1, 10_000), item(2, 15_000)],
      loanOverlay: 80_000,
      assetDebtOverlay: 0,
    });
    expect(r.rows.map((x) => [x.kind, x.amount])).toEqual([
      ["calendar", 10_000],
      ["calendar", 15_000],
      ["direct", 25_000],
      ["loan", 80_000],
    ]);
    expect(r.total).toBe(130_000);
  });

  it("残りが 0 のときは「一覧などで入れた額」を出さない", () => {
    const r = buildBudgetCellDetail({
      budgetAmount: 10_000,
      items: [item(1, 10_000)],
      loanOverlay: 0,
      assetDebtOverlay: 3_000,
      assetNames: ["自宅"],
    });
    expect(r.rows.map((x) => x.kind)).toEqual(["calendar", "assetDebt"]);
    expect(r.total).toBe(13_000);
  });
});
