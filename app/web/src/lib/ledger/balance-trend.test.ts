import { describe, expect, it } from "vitest";
import {
  buildBalanceTrend,
  buildDailyBalanceTrend,
  shiftYm,
  trendDates,
  trendMonths,
  ym,
} from "./balance-trend";

describe("ym / shiftYm", () => {
  it("2 桁ゼロ埋めの YYYY-MM を返す", () => {
    expect(ym(2026, 3)).toBe("2026-03");
    expect(ym(2026, 12)).toBe("2026-12");
  });

  it("年をまたいでずらせる", () => {
    expect(shiftYm(2026, 1, -1)).toBe("2025-12");
    expect(shiftYm(2026, 12, 1)).toBe("2027-01");
    expect(shiftYm(2026, 8, -6)).toBe("2026-02");
  });
});

describe("trendMonths", () => {
  it("対象月を中心に前後の月を昇順で並べる", () => {
    const months = trendMonths(2026, 8, 6, 6);
    expect(months).toHaveLength(13);
    expect(months[0]).toBe("2026-02");
    expect(months[6]).toBe("2026-08");
    expect(months[12]).toBe("2027-02");
  });
});

describe("buildBalanceTrend", () => {
  const monthlyNet = new Map([
    [
      1,
      new Map([
        ["2026-05", 100],
        ["2026-06", 50],
        ["2026-07", -30],
      ]),
    ],
  ]);

  it("実績月は開始からの累積残高を返す", () => {
    const points = buildBalanceTrend({
      accountIds: [1],
      monthlyNet,
      recurringNet: new Map([[1, 0]]),
      months: ["2026-05", "2026-06", "2026-07"],
      actualThroughMonth: "2026-07",
    });
    expect(points.map((p) => p.balances[1])).toEqual([100, 150, 120]);
    expect(points.every((p) => !p.estimated)).toBe(true);
  });

  it("窓の開始より前の増減も残高に含める", () => {
    const points = buildBalanceTrend({
      accountIds: [1],
      monthlyNet,
      recurringNet: new Map([[1, 0]]),
      months: ["2026-07"],
      actualThroughMonth: "2026-07",
    });
    // 5月・6月分も累積されている
    expect(points[0].balances[1]).toBe(120);
  });

  it("実績最終月より後は月次の純増減で推測し、estimated を立てる", () => {
    const points = buildBalanceTrend({
      accountIds: [1],
      monthlyNet,
      recurringNet: new Map([[1, -20]]),
      months: ["2026-07", "2026-08", "2026-09"],
      actualThroughMonth: "2026-07",
    });
    expect(points[0]).toMatchObject({ month: "2026-07", estimated: false });
    expect(points[0].balances[1]).toBe(120);
    expect(points[1]).toMatchObject({ month: "2026-08", estimated: true });
    expect(points[1].balances[1]).toBe(100);
    expect(points[2].balances[1]).toBe(80);
  });

  it("実績がまだ無い月（過去側）は 0 になる", () => {
    const points = buildBalanceTrend({
      accountIds: [1],
      monthlyNet,
      recurringNet: new Map(),
      months: ["2026-01"],
      actualThroughMonth: "2026-07",
    });
    expect(points[0].balances[1]).toBe(0);
  });

  it("明細も資金移動も無い口座は 0 のまま推移する", () => {
    const points = buildBalanceTrend({
      accountIds: [9],
      monthlyNet,
      recurringNet: new Map(),
      months: ["2026-07", "2026-08"],
      actualThroughMonth: "2026-07",
    });
    expect(points.map((p) => p.balances[9])).toEqual([0, 0]);
  });

  it("年をまたぐ推測でも経過月数を正しく数える", () => {
    const points = buildBalanceTrend({
      accountIds: [1],
      monthlyNet: new Map([[1, new Map([["2026-12", 1000]])]]),
      recurringNet: new Map([[1, 100]]),
      months: ["2026-12", "2027-01", "2027-02"],
      actualThroughMonth: "2026-12",
    });
    expect(points.map((p) => p.balances[1])).toEqual([1000, 1100, 1200]);
  });
});

describe("trendDates", () => {
  it("前後の月を含む期間を 1 日刻みで並べる", () => {
    const dates = trendDates(2026, 8, 1, 1);
    expect(dates[0]).toBe("2026-07-01");
    expect(dates[dates.length - 1]).toBe("2026-09-30");
    expect(dates).toHaveLength(31 + 31 + 30);
  });

  it("うるう年の 2 月も日数どおりに並べる", () => {
    const dates = trendDates(2028, 2, 0, 0);
    expect(dates).toHaveLength(29);
    expect(dates[28]).toBe("2028-02-29");
  });
});

describe("buildDailyBalanceTrend", () => {
  const dailyNet = new Map([
    [
      1,
      new Map([
        ["2026-07-10", 300_000],
        ["2026-07-25", -50_000],
        ["2026-08-05", -20_000],
      ]),
    ],
  ]);

  it("実績日はその日までの累積残高を返す", () => {
    const points = buildDailyBalanceTrend({
      accountIds: [1],
      dailyNet,
      recurring: [],
      dates: ["2026-07-09", "2026-07-10", "2026-07-25", "2026-08-05"],
      actualThroughDate: "2026-08-31",
    });
    expect(points.map((p) => p.balances[1])).toEqual([0, 300_000, 250_000, 230_000]);
    expect(points.every((p) => !p.estimated)).toBe(true);
  });

  it("差額（期首残高）を全ての日に足す", () => {
    const points = buildDailyBalanceTrend({
      accountIds: [1],
      dailyNet,
      recurring: [],
      dates: ["2026-07-09", "2026-07-10"],
      actualThroughDate: "2026-08-31",
      adjustments: new Map([[1, 100_000]]),
    });
    expect(points.map((p) => p.balances[1])).toEqual([100_000, 400_000]);
  });

  it("実績最終日より後は資金移動ルールを予定日に適用して推測する", () => {
    const points = buildDailyBalanceTrend({
      accountIds: [1],
      dailyNet,
      recurring: [{ fromId: 1, toId: null, amount: 80_000, day: 27 }],
      dates: ["2026-08-26", "2026-08-27", "2026-08-28", "2026-09-27"],
      actualThroughDate: "2026-08-25",
    });
    // 8/25 時点の実績残高は 230,000
    expect(points[0]).toMatchObject({ date: "2026-08-26", estimated: true });
    expect(points[0].balances[1]).toBe(230_000);
    expect(points[1].balances[1]).toBe(150_000); // 8/27 に引き落とし
    expect(points[2].balances[1]).toBe(150_000);
    expect(points[3].balances[1]).toBe(70_000); // 9/27 にもう一度
  });

  it("窓が実績最終日より先から始まっても、間の予定を積み上げてから描き始める", () => {
    const points = buildDailyBalanceTrend({
      accountIds: [1],
      dailyNet,
      recurring: [{ fromId: 1, toId: null, amount: 80_000, day: 27 }],
      // 8/27 の引き落としは窓の外だが、9/1 の残高には反映されている必要がある
      dates: ["2026-09-01"],
      actualThroughDate: "2026-08-25",
    });
    expect(points[0].balances[1]).toBe(150_000);
  });

  it("指定日が月末を超えるルールは月末日に実行する", () => {
    const points = buildDailyBalanceTrend({
      accountIds: [1],
      dailyNet: new Map(),
      recurring: [{ fromId: null, toId: 1, amount: 10_000, day: 31 }],
      dates: ["2026-09-29", "2026-09-30"],
      actualThroughDate: "2026-09-28",
    });
    expect(points.map((p) => p.balances[1])).toEqual([0, 10_000]);
  });

  it("口座間の振替は出金元と入金先の両方に反映する", () => {
    const points = buildDailyBalanceTrend({
      accountIds: [1, 2],
      dailyNet: new Map([[1, new Map([["2026-08-01", 500_000]])]]),
      recurring: [{ fromId: 1, toId: 2, amount: 200_000, day: 10 }],
      dates: ["2026-09-10"],
      actualThroughDate: "2026-09-01",
    });
    expect(points[0].balances[1]).toBe(300_000);
    expect(points[0].balances[2]).toBe(200_000);
  });
});
