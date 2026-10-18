import { describe, expect, it } from "vitest";
import { getBankSyncProvider, MockBankSyncProvider } from "@/lib/ledger/banksync";

describe("getBankSyncProvider", () => {
  it("既定はモックプロバイダ", () => {
    expect(getBankSyncProvider()).toBeInstanceOf(MockBankSyncProvider);
  });

  it("モックは入出金（+入金/-出金）と一意IDを返す", async () => {
    const txns = await new MockBankSyncProvider().fetchTransactions({
      id: 1,
      bankName: "テスト銀行",
    });
    expect(txns.length).toBeGreaterThan(0);
    expect(txns.some((t) => t.amount > 0)).toBe(true); // 入金
    expect(txns.some((t) => t.amount < 0)).toBe(true); // 出金
    const ids = txns.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(ids.length); // 一意
  });
});
