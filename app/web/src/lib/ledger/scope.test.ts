import { describe, expect, it } from "vitest";
import { actualWhere, businessOwnedWhere, scopedAmount } from "./scope";

const row = (
  kind: string | null,
  businessUse: boolean,
  businessRatio: number | null,
  amount = 3000,
  splitOfId: number | null = null,
) => ({
  amount,
  kind,
  splitOfId,
  businessUse,
  businessRatio,
});

describe("scopedAmount", () => {
  it("household は全額", () => {
    expect(scopedAmount(row("BANK", false, null), "household")).toBe(3000);
    expect(scopedAmount(row("BANK", true, 50), "household")).toBe(3000);
  });

  it("business は、事業利用の明細を按分した額、事業利用でない明細は 0", () => {
    expect(scopedAmount(row("BANK", true, 50), "business")).toBe(1500);
    expect(scopedAmount(row("CARD", true, 33.33), "business")).toBe(999);
    expect(scopedAmount(row("CASH", false, null), "business")).toBe(0);
  });

  it("business でも、明細でない行（仕訳など）は全額", () => {
    expect(scopedAmount(row(null, false, null, 10000), "business")).toBe(10000);
  });

  it("明細分けの商品ごとの行（内訳）は、明細と同じく事業利用の分だけ", () => {
    expect(scopedAmount(row(null, true, 50, 2000, 7), "business")).toBe(1000);
    expect(scopedAmount(row(null, false, null, 2000, 7), "business")).toBe(0);
    expect(scopedAmount(row(null, false, null, 2000, 7), "household")).toBe(2000);
  });
});

describe("actualWhere・businessOwnedWhere", () => {
  it("business は事業利用の明細と明細でない行に絞る", () => {
    expect(actualWhere("household")).toEqual({ accountId: { not: null } });
    expect(actualWhere("business")).toEqual({
      accountId: { not: null },
      OR: [{ kind: null, splitOfId: null }, { businessUse: true }],
    });
    expect(businessOwnedWhere("business")).toEqual({ businessUse: true });
    expect(businessOwnedWhere("household")).toEqual({});
  });
});
