import { describe, expect, it } from "vitest";
import {
  asOfDateLabel,
  describeRule,
  estimateValue,
  monthKeysBetween,
  monthlyValues,
  resolveRule,
  trendOf,
  type ValuationInput,
} from "@/lib/shared/asset-valuation";

const d = (s: string) => {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
};

const base = (over: Partial<ValuationInput>): ValuationInput => ({
  category: "OTHER",
  method: "auto",
  ratePercent: null,
  usefulLifeYears: null,
  structure: null,
  acquiredOn: null,
  acquisitionCost: null,
  valuations: [],
  ...over,
});

describe("resolveRule（自動は種別から決める）", () => {
  it("建物は構造の年数で定額、車は年 20% の定率、土地は年率、現金は変わらない", () => {
    expect(resolveRule(base({ category: "BUILDING" }))).toEqual({
      kind: "straight_line",
      lifeYears: 22,
    });
    expect(resolveRule(base({ category: "BUILDING", structure: "rc" }))).toEqual({
      kind: "straight_line",
      lifeYears: 47,
    });
    expect(resolveRule(base({ category: "VEHICLE" }))).toEqual({
      kind: "declining",
      ratePercent: 20,
    });
    expect(resolveRule(base({ category: "LAND", ratePercent: 1.5 }))).toEqual({
      kind: "rate",
      ratePercent: 1.5,
    });
    expect(resolveRule(base({ category: "CASH" }))).toEqual({ kind: "fixed" });
  });

  it("向きと説明", () => {
    expect(trendOf(resolveRule(base({ category: "BUILDING" })))).toBe("down");
    expect(trendOf(resolveRule(base({ category: "LAND", ratePercent: 1 })))).toBe("up");
    expect(trendOf(resolveRule(base({ category: "LAND" })))).toBe("flat");
    const building = base({ category: "BUILDING", structure: "wood" });
    expect(describeRule(resolveRule(building), building)).toBe("木造 22 年で 0 円へ（定額）");
    expect(describeRule({ kind: "rate", ratePercent: -2 })).toBe("年 -2%");
  });
});

describe("estimateValue", () => {
  it("建物: 取得価格から年数で 0 円へ直線で減る（半分の年数で半額）", () => {
    const building = base({
      category: "BUILDING",
      method: "straight_line",
      usefulLifeYears: 20,
      acquiredOn: d("2020-01-01"),
      acquisitionCost: 20_000_000,
    });
    expect(estimateValue(building, d("2030-01-01"))).toBeCloseTo(10_000_000, -4);
    expect(estimateValue(building, d("2041-01-01"))).toBe(0);
    expect(estimateValue(building, d("2019-12-31"))).toBeNull(); // 取得前
  });

  it("手で評価額を直すと、その値から年数の終わりへ向けて見積もり直す", () => {
    const building = base({
      category: "BUILDING",
      method: "straight_line",
      usefulLifeYears: 20,
      acquiredOn: d("2020-01-01"),
      acquisitionCost: 20_000_000,
      valuations: [{ on: d("2030-01-01"), value: 14_000_000 }],
    });
    // 2030 → 2040 の 10 年で 1,400 万 → 0 円。5 年後は 700 万
    expect(estimateValue(building, d("2035-01-01"))).toBeCloseTo(7_000_000, -4);
    // 取得日と手で入れた日の間は直線でつなぐ（2025 年は 2,000 万と 1,400 万の中間）
    expect(estimateValue(building, d("2025-01-01"))).toBeCloseTo(17_000_000, -4);
  });

  it("年率: 最後の点から複利で増える。定率: 毎年同じ割合で減る", () => {
    const land = base({
      category: "LAND",
      ratePercent: 2,
      valuations: [{ on: d("2026-01-01"), value: 10_000_000 }],
    });
    expect(estimateValue(land, d("2028-01-01"))).toBeCloseTo(10_404_000, -3);
    const car = base({
      category: "VEHICLE",
      valuations: [{ on: d("2026-01-01"), value: 3_000_000 }],
    });
    expect(estimateValue(car, d("2027-01-01"))).toBeCloseTo(2_400_000, -3);
  });

  it("変わらない: 最後に入れた値のまま。点の前は最初の点の値", () => {
    const gold = base({
      category: "CASH",
      valuations: [
        { on: d("2025-01-01"), value: 100 },
        { on: d("2026-01-01"), value: 300 },
      ],
    });
    expect(estimateValue(gold, d("2024-06-01"))).toBe(100);
    expect(estimateValue(gold, d("2030-01-01"))).toBe(300);
  });
});

describe("評価額を入れ直しても、それより前の見積もりは変わらない", () => {
  const building = base({
    category: "BUILDING",
    method: "straight_line",
    usefulLifeYears: 20,
    acquiredOn: d("2020-01-01"),
    acquisitionCost: 20_000_000,
    valuations: [{ on: d("2026-01-01"), value: 12_000_000 }],
  });
  // 2026-01 から 2040-01 の 14 年で 1,200 万 → 0 円。2026-07 時点の見積もり
  const julyBefore = estimateValue(building, d("2026-07-01"))!;

  it("記録した点から次の点の前日までは、その点からの見積もりのまま。次の点の日に切り替わる", () => {
    const updated = {
      ...building,
      valuations: [...building.valuations, { on: d("2026-10-01"), value: 10_000_000 }],
    };
    expect(estimateValue(updated, d("2026-07-01"))).toBeCloseTo(julyBefore, 0);
    expect(estimateValue(updated, d("2026-09-30"))).toBeGreaterThan(10_500_000);
    expect(estimateValue(updated, d("2026-10-01"))).toBe(10_000_000);
  });

  it("記録ごとの価値の変わり方で見積もる（あとで設定を変えても、過ぎた区間は記録した時点の変わり方のまま）", () => {
    const car = base({
      category: "VEHICLE",
      method: "fixed", // 今の設定は「変わらない」
      valuations: [
        { on: d("2026-01-01"), value: 3_000_000, rule: { kind: "declining", ratePercent: 20 } },
        { on: d("2027-01-01"), value: 2_400_000, rule: { kind: "fixed" } },
      ],
    });
    // 2026 年中は記録した時点の「毎年 20%」で減る
    expect(estimateValue(car, d("2026-07-02"))).toBeCloseTo(3_000_000 * Math.sqrt(0.8), -4);
    // 2027 年からは「変わらない」
    expect(estimateValue(car, d("2030-01-01"))).toBe(2_400_000);
  });

  it("取得日から最初の記録までは直線（登録時の過去の推定）", () => {
    // 2020-01（2,000 万）と 2026-01（1,200 万）の中間の 2023-01 は約 1,600 万
    expect(estimateValue(building, d("2023-01-01"))).toBeCloseTo(16_000_000, -5);
  });
});

describe("asOfDateLabel", () => {
  it("年月日で時点を出す", () => {
    expect(asOfDateLabel(d("2026-10-06"))).toBe("2026年10月6日時点");
  });
});

describe("monthlyValues", () => {
  it("月末ごとに丸めた値を返し、取得前の月は null", () => {
    const keys = monthKeysBetween("2025-11", "2026-02");
    expect(keys).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    const item = base({
      category: "CASH",
      acquiredOn: d("2025-12-15"),
      acquisitionCost: 1000,
    });
    expect(monthlyValues(item, keys)).toEqual([null, 1000, 1000, 1000]);
  });
});
