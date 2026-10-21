import { describe, expect, it } from "vitest";
import { descriptionVariants, historyFilterWhere, invalidHistoryFilter } from "./history-filter";

describe("descriptionVariants", () => {
  it("入力そのまま・半角・全角の 3 通りで探す（重複は除く）", () => {
    expect(descriptionVariants(" JAL Pay ")).toEqual(["JAL Pay", "ＪＡＬ　Ｐａｙ"]);
    expect(descriptionVariants("ＪＡＬ")).toEqual(["ＪＡＬ", "JAL"]);
    expect(descriptionVariants("住信SBI")).toEqual(["住信SBI", "住信ＳＢＩ"]);
    expect(descriptionVariants("  ")).toEqual([]);
  });
});

describe("invalidHistoryFilter", () => {
  it("範囲が逆なら理由を返す", () => {
    expect(invalidHistoryFilter({ dateFrom: "2026-03-02", dateTo: "2026-03-01" })).not.toBeNull();
    expect(invalidHistoryFilter({ amountMin: 10, amountMax: 5 })).not.toBeNull();
    expect(invalidHistoryFilter({ dateFrom: "2026-03-01", dateTo: "2026-03-01" })).toBeNull();
    expect(invalidHistoryFilter({ amountMin: 5_000, amountMax: 5_000 })).toBeNull();
  });
});

describe("historyFilterWhere", () => {
  it("指定が無ければ条件を作らない", () => {
    expect(historyFilterWhere({})).toEqual([]);
  });

  it("期間は from の 0 時から to の翌日 0 時の手前まで", () => {
    expect(historyFilterWhere({ dateFrom: "2026-03-01", dateTo: "2026-03-31" })).toEqual([
      { date: { gte: new Date(2026, 2, 1), lt: new Date(2026, 3, 1) } },
    ]);
  });

  it("金額は入金・出金を問わず絶対値で比べる", () => {
    expect(historyFilterWhere({ amountMin: 1_000, amountMax: 5_000 })).toEqual([
      { OR: [{ flow: { gte: 1_000, lte: 5_000 } }, { flow: { lte: -1_000, gte: -5_000 } }] },
    ]);
    expect(historyFilterWhere({ amountMax: 500 })).toEqual([
      { OR: [{ flow: { gte: 0, lte: 500 } }, { flow: { lte: 0, gte: -500 } }] },
    ]);
  });
});
