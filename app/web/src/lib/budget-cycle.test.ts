import { describe, expect, it } from "vitest";
import {
  computeVariance,
  defaultTreatment,
  isTreatmentAllowed,
  nextYearMonth,
  planNextBudget,
  summarizeVariance,
  type VarianceInput,
  type VarianceTreatment,
} from "@/lib/budget-cycle";

const row = (over: Partial<VarianceInput> & Pick<VarianceInput, "accountId">): VarianceInput => ({
  accountCode: `A-${over.accountId}`,
  name: `科目${over.accountId}`,
  category: "EXPENSE",
  budget: null,
  overlay: 0,
  actual: 0,
  nextBudget: null,
  ...over,
});

describe("computeVariance", () => {
  it("費用は実績が予算より少なければ有利（余り）", () => {
    const v = computeVariance(row({ accountId: 1, budget: 50_000, actual: 42_000 }));
    expect(v.plan).toBe(50_000);
    expect(v.difference).toBe(-8_000);
    expect(v.favorable).toBe(true);
    expect(v.surplus).toBe(true);
  });

  it("費用は実績が予算を超えれば不利", () => {
    const v = computeVariance(row({ accountId: 1, budget: 50_000, actual: 58_000 }));
    expect(v.difference).toBe(8_000);
    expect(v.favorable).toBe(false);
    expect(v.surplus).toBe(false);
  });

  it("収入は実績が予算より多ければ有利で、余りにはならない", () => {
    const v = computeVariance(
      row({ accountId: 1, category: "REVENUE", budget: 300_000, actual: 320_000 }),
    );
    expect(v.favorable).toBe(true);
    expect(v.surplus).toBe(false);
  });

  it("自動反映（ローン返済）を予算に含めて比べる", () => {
    const v = computeVariance(row({ accountId: 1, budget: null, overlay: 80_000, actual: 80_000 }));
    expect(v.plan).toBe(80_000);
    expect(v.difference).toBe(0);
    expect(v.favorable).toBeNull();
  });
});

describe("summarizeVariance", () => {
  it("収入と費用を分け、余りと超過を別々に合計する", () => {
    const rows = [
      row({ accountId: 1, category: "REVENUE", budget: 300_000, actual: 310_000 }),
      row({ accountId: 2, budget: 50_000, actual: 40_000 }),
      row({ accountId: 3, budget: 20_000, actual: 25_000 }),
    ].map(computeVariance);
    expect(summarizeVariance(rows)).toEqual({
      revenue: { plan: 300_000, actual: 310_000 },
      expense: { plan: 70_000, actual: 65_000 },
      surplusTotal: 10_000,
      overrunTotal: 5_000,
    });
  });
});

describe("defaultTreatment", () => {
  const surplus = computeVariance(row({ accountId: 1, budget: 50_000, actual: 40_000 }));
  const overrun = computeVariance(row({ accountId: 1, budget: 50_000, actual: 60_000 }));

  it("家計で回し先があれば、余りは回し先へ", () => {
    expect(defaultTreatment(surplus, { household: true, hasTransferTarget: true })).toBe(
      "transfer",
    );
    expect(defaultTreatment(overrun, { household: true, hasTransferTarget: true })).toBe("none");
  });

  it("事業・法人は繰り越さない", () => {
    expect(defaultTreatment(surplus, { household: false, hasTransferTarget: true })).toBe("none");
  });

  it("回し先が無ければ何もしない", () => {
    expect(defaultTreatment(surplus, { household: true, hasTransferTarget: false })).toBe("none");
  });
});

describe("isTreatmentAllowed", () => {
  const surplus = computeVariance(row({ accountId: 1, budget: 50_000, actual: 40_000 }));
  const overrun = computeVariance(row({ accountId: 1, budget: 50_000, actual: 60_000 }));

  it("回し先へ移せるのは余ったときだけで、自分自身は回し先にできない", () => {
    expect(isTreatmentAllowed(surplus, "transfer", 9)).toBe(true);
    expect(isTreatmentAllowed(overrun, "transfer", 9)).toBe(false);
    expect(isTreatmentAllowed(surplus, "transfer", 1)).toBe(false);
    expect(isTreatmentAllowed(surplus, "transfer", null)).toBe(false);
    expect(isTreatmentAllowed(overrun, "timing", null)).toBe(true);
  });
});

describe("planNextBudget", () => {
  const treat = (entries: [number, VarianceTreatment][]) => new Map(entries);

  it("何もしなければ、翌月に予算が無い科目は当月の予算を引き継ぐ", () => {
    const rows = [row({ accountId: 1, budget: 50_000, actual: 40_000 })].map(computeVariance);
    const items = planNextBudget({ rows, treatments: treat([]), transferTargetId: null });
    expect(items).toEqual([
      { accountId: 1, base: 50_000, adjustment: 0, amount: 50_000, notes: [], clamped: false },
    ]);
  });

  it("翌月に予算があればそれを基準にする", () => {
    const rows = [row({ accountId: 1, budget: 50_000, actual: 40_000, nextBudget: 45_000 })].map(
      computeVariance,
    );
    const [item] = planNextBudget({ rows, treatments: treat([]), transferTargetId: null });
    expect(item.amount).toBe(45_000);
  });

  it("期ズレ: 使わなかった分を翌月に足し、先に使った分は翌月から引く", () => {
    const rows = [
      row({ accountId: 1, budget: 50_000, actual: 40_000 }),
      row({ accountId: 2, budget: 30_000, actual: 36_000 }),
    ].map(computeVariance);
    const items = planNextBudget({
      rows,
      treatments: treat([
        [1, "timing"],
        [2, "timing"],
      ]),
      transferTargetId: null,
    });
    expect(items.find((i) => i.accountId === 1)?.amount).toBe(60_000);
    expect(items.find((i) => i.accountId === 2)?.amount).toBe(24_000);
    expect(items.find((i) => i.accountId === 1)?.notes).toEqual([
      { kind: "timing", amount: 10_000 },
    ]);
  });

  it("期ズレ: 収入が予算に届かなかった分は翌月に足す", () => {
    const rows = [row({ accountId: 1, category: "REVENUE", budget: 300_000, actual: 250_000 })].map(
      computeVariance,
    );
    const [item] = planNextBudget({
      rows,
      treatments: treat([[1, "timing"]]),
      transferTargetId: null,
    });
    expect(item.amount).toBe(350_000);
  });

  it("期ズレで 0 未満になるときは 0 にして印を付ける", () => {
    const rows = [row({ accountId: 1, budget: 10_000, actual: 30_000 })].map(computeVariance);
    const [item] = planNextBudget({
      rows,
      treatments: treat([[1, "timing"]]),
      transferTargetId: null,
    });
    expect(item.amount).toBe(0);
    expect(item.clamped).toBe(true);
  });

  it("回し先へ: 余りを回し先に足し、元の科目は基準額のまま", () => {
    const rows = [
      row({ accountId: 1, budget: 50_000, actual: 40_000 }),
      row({ accountId: 2, budget: 20_000, actual: 15_000 }),
      row({ accountId: 9, budget: 30_000, actual: 30_000 }),
    ].map(computeVariance);
    const items = planNextBudget({
      rows,
      treatments: treat([
        [1, "transfer"],
        [2, "transfer"],
      ]),
      transferTargetId: 9,
    });
    expect(items.find((i) => i.accountId === 1)?.amount).toBe(50_000);
    expect(items.find((i) => i.accountId === 2)?.amount).toBe(20_000);
    const target = items.find((i) => i.accountId === 9)!;
    expect(target.amount).toBe(45_000);
    expect(target.notes).toEqual([
      { kind: "transfer", fromAccountId: 1, amount: 10_000 },
      { kind: "transfer", fromAccountId: 2, amount: 5_000 },
    ]);
  });

  it("回し先が当月の表に無いときは transferTargetBase を基準にする", () => {
    const rows = [row({ accountId: 1, budget: 50_000, actual: 40_000 })].map(computeVariance);
    const items = planNextBudget({
      rows,
      treatments: treat([[1, "transfer"]]),
      transferTargetId: 9,
      transferTargetBase: 5_000,
    });
    expect(items.find((i) => i.accountId === 9)?.amount).toBe(15_000);
  });

  it("超過した科目に回し先へを指定しても無視する", () => {
    const rows = [
      row({ accountId: 1, budget: 50_000, actual: 60_000 }),
      row({ accountId: 9, budget: 30_000, actual: 30_000 }),
    ].map(computeVariance);
    const items = planNextBudget({
      rows,
      treatments: treat([[1, "transfer"]]),
      transferTargetId: 9,
    });
    expect(items.find((i) => i.accountId === 9)?.amount).toBe(30_000);
  });

  it("予算の無い科目は、調整が無ければ案に含めない", () => {
    const rows = [row({ accountId: 1, budget: null, actual: 3_000 })].map(computeVariance);
    expect(planNextBudget({ rows, treatments: treat([]), transferTargetId: null })).toEqual([]);
  });
});

describe("nextYearMonth", () => {
  it("12 月の次は翌年 1 月", () => {
    expect(nextYearMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
    expect(nextYearMonth(2026, 4)).toEqual({ year: 2026, month: 5 });
  });
});
