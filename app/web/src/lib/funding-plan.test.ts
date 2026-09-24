import { describe, expect, it } from "vitest";
import { computeFundingPlans, type FundingAccount, type FundingTransfer } from "@/lib/funding-plan";

const accounts: FundingAccount[] = [{ id: 1, name: "生活費口座", opening: 100_000 }];

describe("computeFundingPlans", () => {
  it("毎月の入出金をイベントとして時系列に並べる", () => {
    const transfers: FundingTransfer[] = [
      { fromId: null, toId: 1, amount: 200_000, day: 25, label: "給与振込" },
      { fromId: 1, toId: null, amount: 90_000, day: 27, label: "家賃" },
    ];
    const [plan] = computeFundingPlans(accounts, transfers, {
      startYear: 2026,
      startMonth: 1,
      months: 2,
    });
    expect(plan.events.map((e) => e.date)).toEqual([
      "2026-01-25",
      "2026-01-27",
      "2026-02-25",
      "2026-02-27",
    ]);
    expect(plan.events[0].amount).toBe(200_000);
    expect(plan.events[1].amount).toBe(-90_000);
    expect(plan.closing).toBe(100_000 + (200_000 - 90_000) * 2);
    expect(plan.requiredDeposit).toBe(0);
    expect(plan.deadline).toBeNull();
  });

  it("残高が足りなくなる引き落とし日を入金期限とし、必要額を算出する", () => {
    const transfers: FundingTransfer[] = [
      { fromId: 1, toId: null, amount: 150_000, day: 10, label: "カード引き落とし" },
    ];
    const [plan] = computeFundingPlans(accounts, transfers, {
      startYear: 2026,
      startMonth: 3,
      months: 3,
    });
    expect(plan.deadline).toBe("2026-03-10");
    expect(plan.trigger?.label).toBe("カード引き落とし");
    // 3 か月で 45 万円の引き落とし。期首 10 万円なので最終的に 35 万円不足する
    expect(plan.minBalance).toBe(-350_000);
    expect(plan.minBalanceDate).toBe("2026-05-10");
    expect(plan.requiredDeposit).toBe(350_000);
  });

  it("同じ日に入金と出金がある場合は出金を先に適用する（不足を見逃さない）", () => {
    const transfers: FundingTransfer[] = [
      { fromId: null, toId: 1, amount: 300_000, day: 25, label: "給与振込" },
      { fromId: 1, toId: null, amount: 250_000, day: 25, label: "住宅ローン" },
    ];
    const [plan] = computeFundingPlans(
      [{ id: 1, name: "生活費口座", opening: 100_000 }],
      transfers,
      {
        startYear: 2026,
        startMonth: 1,
        months: 1,
      },
    );
    expect(plan.events[0].label).toBe("住宅ローン");
    expect(plan.events[0].balanceAfter).toBe(-150_000);
    expect(plan.deadline).toBe("2026-01-25");
    expect(plan.closing).toBe(150_000);
  });

  it("実行日が月末を超える場合は月末日に丸める", () => {
    const transfers: FundingTransfer[] = [
      { fromId: 1, toId: null, amount: 10_000, day: 31, label: null },
    ];
    const [plan] = computeFundingPlans(accounts, transfers, {
      startYear: 2026,
      startMonth: 2,
      months: 1,
    });
    expect(plan.events[0].date).toBe("2026-02-28");
    expect(plan.events[0].label).toBe("出金");
  });

  it("他口座の資金移動は対象口座のイベントに含めない", () => {
    const transfers: FundingTransfer[] = [
      { fromId: 2, toId: 3, amount: 50_000, day: 5, label: "別口座間の振替" },
    ];
    const [plan] = computeFundingPlans(accounts, transfers, {
      startYear: 2026,
      startMonth: 1,
      months: 1,
    });
    expect(plan.events).toEqual([]);
    expect(plan.closing).toBe(100_000);
  });
});
