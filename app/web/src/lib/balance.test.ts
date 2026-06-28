import { describe, expect, it } from "vitest";
import { simulateBalances, type SimAccount, type SimTransfer } from "@/lib/balance";

const accounts: SimAccount[] = [
  { id: 1, name: "給与口座", opening: 300_000 },
  { id: 2, name: "引き落とし口座", opening: 0 },
];

describe("simulateBalances", () => {
  it("振替日に出金元から入金先へ資金が移動する", () => {
    const transfers: SimTransfer[] = [{ fromId: 1, toId: 2, amount: 100_000, day: 27 }];
    const { timeline } = simulateBalances(accounts, transfers, {
      startYear: 2025,
      startMonth: 1,
      months: 1,
    });
    // 1/1 時点
    expect(timeline[0].balances[1]).toBe(300_000);
    expect(timeline[0].balances[2]).toBe(0);
    // 1/31 時点（27日の振替後）
    const last = timeline[timeline.length - 1];
    expect(last.date).toBe("2025-01-31");
    expect(last.balances[1]).toBe(200_000);
    expect(last.balances[2]).toBe(100_000);
  });

  it("残高不足（マイナス）を検出する", () => {
    const poor: SimAccount[] = [
      { id: 1, name: "給与口座", opening: 50_000 },
      { id: 2, name: "引き落とし口座", opening: 0 },
    ];
    const transfers: SimTransfer[] = [{ fromId: 1, toId: 2, amount: 100_000, day: 10 }];
    const { shortfalls } = simulateBalances(poor, transfers, {
      startYear: 2025,
      startMonth: 1,
      months: 1,
    });
    expect(shortfalls.length).toBeGreaterThan(0);
    expect(shortfalls[0].accountId).toBe(1);
    expect(shortfalls[0].balance).toBe(-50_000);
  });

  it("月末を超える指定日は月末に実行される（2月の31日指定）", () => {
    const transfers: SimTransfer[] = [{ fromId: 1, toId: 2, amount: 10_000, day: 31 }];
    const { timeline } = simulateBalances(accounts, transfers, {
      startYear: 2025,
      startMonth: 2,
      months: 1,
    });
    // 2025-02 は 28 日まで。28日に実行され、末日残高に反映
    const last = timeline[timeline.length - 1];
    expect(last.date).toBe("2025-02-28");
    expect(last.balances[2]).toBe(10_000);
  });

  it("入金(外部→口座)・支出(口座→外部)を残高に反映する", () => {
    const accts: SimAccount[] = [{ id: 1, name: "給与口座", opening: 0 }];
    const transfers: SimTransfer[] = [
      { fromId: null, toId: 1, amount: 450_000, day: 25 }, // 入金
      { fromId: 1, toId: null, amount: 120_000, day: 27 }, // カード/支出
    ];
    const { timeline } = simulateBalances(accts, transfers, {
      startYear: 2025,
      startMonth: 1,
      months: 1,
    });
    const last = timeline[timeline.length - 1];
    expect(last.balances[1]).toBe(330_000); // 0 + 450,000 - 120,000
  });

  it("複数月にわたり毎月実行される", () => {
    const transfers: SimTransfer[] = [{ fromId: 1, toId: 2, amount: 50_000, day: 15 }];
    const { timeline } = simulateBalances(accounts, transfers, {
      startYear: 2025,
      startMonth: 1,
      months: 3,
    });
    const last = timeline[timeline.length - 1];
    // 3回実行 → 給与口座 300,000 - 150,000 = 150,000
    expect(last.balances[1]).toBe(150_000);
    expect(last.balances[2]).toBe(150_000);
  });
});
