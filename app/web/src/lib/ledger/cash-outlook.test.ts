import { describe, expect, it } from "vitest";
import { buildCashOutlook, ruleNetOf, type OutlookRule } from "./cash-outlook";

const months = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];

// 口座 1（給与口座）・口座 2（引き落とし口座）。8〜10 月に明細がある
const monthlyNet = new Map([
  [
    1,
    new Map([
      ["2026-08", 100_000],
      ["2026-09", 50_000],
      ["2026-10", 20_000],
    ]),
  ],
  [2, new Map([["2026-09", -10_000]])],
]);
const adjustments = new Map([
  [1, 500_000],
  [2, 30_000],
]);
const rules: OutlookRule[] = [
  { fromId: null, toId: 1, amount: 300_000 }, // 給与
  { fromId: 1, toId: 2, amount: 80_000 }, // 振替
  { fromId: 2, toId: null, amount: 70_000, activeUntil: "2026-11" }, // 11 月で完済の返済
];

const base = {
  accountIds: [1, 2],
  monthlyNet,
  adjustments,
  rules,
  months,
  currentKey: "2026-10",
};

describe("ruleNetOf", () => {
  it("入金は足し、出金は引く。期限の外の月は数えない", () => {
    expect(ruleNetOf(rules, 1, "2026-11")).toBe(220_000);
    expect(ruleNetOf(rules, 2, "2026-11")).toBe(10_000);
    expect(ruleNetOf(rules, 2, "2026-12")).toBe(80_000);
  });
});

describe("buildCashOutlook", () => {
  it("口座ごと: 今月までは明細の月末残高、先はルールの収支を積み上げる", () => {
    const r = buildCashOutlook({ ...base, budgetNet: new Map(), actualNet: new Map() });
    expect(r.accounts.get(1)).toEqual([600_000, 650_000, 670_000, 890_000, 1_110_000]);
    expect(r.accounts.get(2)).toEqual([30_000, 20_000, 20_000, 30_000, 110_000]);
  });

  it("合計: 今月の残りは予算 − 実績、先は予算の収支で見込む", () => {
    const r = buildCashOutlook({
      ...base,
      budgetNet: new Map([
        ["2026-10", 100_000],
        ["2026-11", 120_000],
        ["2026-12", -50_000],
      ]),
      actualNet: new Map([["2026-10", 40_000]]),
    });
    // 今日の合計 690,000 + (100,000 − 40,000)
    expect(r.total).toEqual([630_000, 670_000, 750_000, 870_000, 820_000]);
    expect(r.totalBasis).toEqual(["actual", "actual", "budget", "budget", "budget"]);
  });

  it("予算の無い月は資金移動ルールの収支で代わりにする", () => {
    const r = buildCashOutlook({
      ...base,
      budgetNet: new Map([["2026-11", 100_000]]),
      actualNet: new Map(),
    });
    // 今月は予算が無いので今日の残高のまま。12 月はルールの収支（220,000 + 80,000）
    expect(r.total).toEqual([630_000, 670_000, 690_000, 790_000, 1_090_000]);
    expect(r.totalBasis).toEqual(["actual", "actual", "actual", "budget", "rule"]);
  });
});
