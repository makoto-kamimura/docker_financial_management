import { describe, expect, it } from "vitest";
import { getBankSyncProvider, MockBankSyncProvider } from "@/lib/banksync";
import { parseBankCsv } from "@/lib/banktxn-import";

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

describe("parseBankCsv", () => {
  it("CSV を入出金明細に変換し、決定的な externalId を付与する", () => {
    const csv =
      "date,description,amount,balance\n2025-01-25,給与振込,450000,520000\n2025-01-27,カード引落,-120000,400000";
    const { rows, errors } = parseBankCsv(csv, 1);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].amount).toBe(450000);
    expect(rows[1].amount).toBe(-120000);
    expect(rows[0].externalId).toContain("csv-1-2025-01-25");
  });

  it("不正な行はエラーとして報告する", () => {
    const csv = "date,description,amount\n,,abc";
    const { rows, errors } = parseBankCsv(csv, 1);
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});
