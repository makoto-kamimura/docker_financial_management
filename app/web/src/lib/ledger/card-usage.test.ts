import { describe, expect, it } from "vitest";
import { buildCardUsageTrend, countsAsUsage, type UsageTxn } from "./card-usage";

const t = (
  accountId: number,
  month: string,
  amount: number,
  extra: Partial<UsageTxn> = {},
): UsageTxn => ({
  accountId,
  month,
  amount,
  transferToAccountId: null,
  chargeGroupId: null,
  ...extra,
});

describe("countsAsUsage", () => {
  it("チャージとチャージ先に入った側は数えない", () => {
    expect(countsAsUsage(t(1, "2026-09", 100))).toBe(true);
    expect(countsAsUsage(t(1, "2026-09", 100, { transferToAccountId: 2 }))).toBe(false);
    expect(countsAsUsage(t(2, "2026-09", -100, { chargeGroupId: "g1" }))).toBe(false);
  });
});

describe("buildCardUsageTrend", () => {
  it("今月までは利用 − 返金、先は固定決済の合計で見込む", () => {
    const r = buildCardUsageTrend({
      cardIds: [1, 2],
      txns: [
        t(1, "2026-09", 5_000),
        t(1, "2026-09", -1_000), // 返金
        t(1, "2026-09", 30_000, { transferToAccountId: 2 }), // チャージ
        t(2, "2026-09", -30_000, { chargeGroupId: "g1" }), // チャージ先に入った側
        t(2, "2026-10", 2_000),
      ],
      recurringMonthly: new Map([[1, 1_500]]),
      months: ["2026-09", "2026-10", "2026-11"],
      currentKey: "2026-10",
    });
    expect(r.cards.get(1)).toEqual([4_000, 0, 1_500]);
    expect(r.cards.get(2)).toEqual([0, 2_000, 0]);
    expect(r.total).toEqual([4_000, 2_000, 1_500]);
  });
});
