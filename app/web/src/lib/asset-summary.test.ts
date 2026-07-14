import { describe, expect, it } from "vitest";
import { summarizeNetWorth } from "@/lib/asset-summary";

describe("summarizeNetWorth", () => {
  it("excludes ASSET account balances linked to a bank account (linked_accounts.accountId)", () => {
    const result = summarizeNetWorth({
      personalAssets: [],
      bankBalances: [{ accountId: 10, balance: 500_000 }],
      accountBalances: [{ accountId: 10, category: "ASSET", balance: 500_000 }], // 同じ口座を科目残高としても持っている（重複計上リスク）
      loans: [],
      linkedAccountMappings: [{ accountId: 10 }], // accountId=10 は銀行口座に紐付いている
      personalAssetDebts: [],
    });
    // ASSET 科目残高（500,000）は除外され、bankBalances の 500,000 のみ計上される
    expect(result.totalAssets).toBe(500_000);
  });

  it("includes ASSET account balances that are not linked to any bank account", () => {
    const result = summarizeNetWorth({
      personalAssets: [],
      bankBalances: [],
      accountBalances: [{ accountId: 20, category: "ASSET", balance: 300_000 }],
      loans: [],
      linkedAccountMappings: [], // 紐付けなし
      personalAssetDebts: [],
    });
    expect(result.totalAssets).toBe(300_000);
  });

  it("excludes LIABILITY account balances linked to a personal asset (personal_assets.linkedAccountId)", () => {
    const result = summarizeNetWorth({
      personalAssets: [{ category: "LAND", currentValue: 20_000_000, linkedAccountId: 30 }],
      bankBalances: [],
      accountBalances: [{ accountId: 30, category: "LIABILITY", balance: 15_000_000 }], // 同じ負債を科目残高としても持っている
      loans: [],
      linkedAccountMappings: [],
      personalAssetDebts: [{ remaining: 15_000_000 }], // debt-schedule.ts の月割り残高側で計上
    });
    // LIABILITY 科目残高（15,000,000）は除外され、personalAssetDebts の 15,000,000 のみ計上される
    expect(result.totalLiabilities).toBe(15_000_000);
  });

  it("includes LIABILITY account balances not linked to any personal asset", () => {
    const result = summarizeNetWorth({
      personalAssets: [],
      bankBalances: [],
      accountBalances: [{ accountId: 40, category: "LIABILITY", balance: 200_000 }],
      loans: [],
      linkedAccountMappings: [],
      personalAssetDebts: [],
    });
    expect(result.totalLiabilities).toBe(200_000);
  });

  it("uses isCountedAsAsset() to exclude non-LAND/BUILDING personal assets that are linked to a liability", () => {
    const result = summarizeNetWorth({
      personalAssets: [
        { category: "LAND", currentValue: 10_000_000, linkedAccountId: 1 }, // 計上される
        { category: "VEHICLE", currentValue: 2_000_000, linkedAccountId: 2 }, // ローン諸費用扱いで除外される
        { category: "GOLD", currentValue: 500_000, linkedAccountId: null }, // 紐付けなしはそのまま計上
      ],
      bankBalances: [],
      accountBalances: [],
      loans: [],
      linkedAccountMappings: [],
      personalAssetDebts: [],
    });
    expect(result.totalAssets).toBe(10_500_000);
  });

  it("sums loans.remainingAmount as a liability component independent of account balances", () => {
    const result = summarizeNetWorth({
      personalAssets: [],
      bankBalances: [],
      accountBalances: [],
      loans: [{ remainingAmount: 1_800_000 }, { remainingAmount: 3_500_000 }],
      linkedAccountMappings: [],
      personalAssetDebts: [],
    });
    expect(result.totalLiabilities).toBe(5_300_000);
  });

  it("computes netWorth = totalAssets - totalLiabilities and returns a full breakdown", () => {
    const result = summarizeNetWorth({
      personalAssets: [{ category: "LAND", currentValue: 20_000_000, linkedAccountId: 1 }],
      bankBalances: [{ accountId: 10, balance: 1_000_000 }],
      accountBalances: [
        { accountId: 10, category: "ASSET", balance: 1_000_000 }, // 銀行口座紐付けで除外
        { accountId: 99, category: "ASSET", balance: 500_000 }, // 紐付けなしなので計上
        { accountId: 1, category: "LIABILITY", balance: 15_000_000 }, // 実物資産紐付けで除外
      ],
      loans: [{ remainingAmount: 1_000_000 }],
      linkedAccountMappings: [{ accountId: 10 }],
      personalAssetDebts: [{ remaining: 15_000_000 }],
    });
    expect(result.totalAssets).toBe(20_000_000 + 1_000_000 + 500_000);
    expect(result.totalLiabilities).toBe(1_000_000 + 15_000_000);
    expect(result.netWorth).toBe(result.totalAssets - result.totalLiabilities);
    expect(result.breakdown).toHaveLength(6);
    expect(result.breakdown.map((b) => b.key)).toEqual([
      "personalAssets",
      "bankBalances",
      "assetAccounts",
      "liabilityAccounts",
      "loans",
      "personalAssetDebts",
    ]);
  });

  it("returns all zeros for empty input", () => {
    const result = summarizeNetWorth({
      personalAssets: [],
      bankBalances: [],
      accountBalances: [],
      loans: [],
      linkedAccountMappings: [],
      personalAssetDebts: [],
    });
    expect(result.totalAssets).toBe(0);
    expect(result.totalLiabilities).toBe(0);
    expect(result.netWorth).toBe(0);
  });
});
