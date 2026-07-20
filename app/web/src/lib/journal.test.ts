import { describe, expect, it, vi } from "vitest";
import {
  signedFinancialRecordAmount,
  syncJournalToFinancialRecords,
  type JournalDetailForSync,
} from "@/lib/journal";
import type { TenantDbClient } from "@/lib/tenant-db";

describe("signedFinancialRecordAmount (D-5b 符号規約)", () => {
  it("借方が自然側の科目（ASSET/EXPENSE/COGS）は借方で正、貸方で負", () => {
    expect(signedFinancialRecordAmount({ category: "ASSET", side: "debit", amount: 1000 })).toBe(
      1000,
    );
    expect(signedFinancialRecordAmount({ category: "ASSET", side: "credit", amount: 1000 })).toBe(
      -1000,
    );
    expect(signedFinancialRecordAmount({ category: "EXPENSE", side: "debit", amount: 500 })).toBe(
      500,
    );
    expect(signedFinancialRecordAmount({ category: "EXPENSE", side: "credit", amount: 500 })).toBe(
      -500,
    );
    expect(signedFinancialRecordAmount({ category: "COGS", side: "debit", amount: 300 })).toBe(300);
  });

  it("貸方が自然側の科目（LIABILITY/REVENUE/PROFIT/OTHER）は貸方で正、借方で負", () => {
    expect(
      signedFinancialRecordAmount({ category: "LIABILITY", side: "credit", amount: 1000 }),
    ).toBe(1000);
    expect(
      signedFinancialRecordAmount({ category: "LIABILITY", side: "debit", amount: 1000 }),
    ).toBe(-1000);
    expect(signedFinancialRecordAmount({ category: "REVENUE", side: "credit", amount: 2000 })).toBe(
      2000,
    );
    expect(signedFinancialRecordAmount({ category: "REVENUE", side: "debit", amount: 2000 })).toBe(
      -2000,
    );
    expect(signedFinancialRecordAmount({ category: "PROFIT", side: "credit", amount: 10 })).toBe(
      10,
    );
    expect(signedFinancialRecordAmount({ category: "OTHER", side: "credit", amount: 10 })).toBe(10);
  });
});

function fakeDb(periodId = 42) {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const upsert = vi.fn().mockResolvedValue({ id: periodId });
  const db = {
    period: { upsert },
    financialRecord: { createMany },
  } as unknown as TenantDbClient;
  return { db, createMany, upsert };
}

describe("syncJournalToFinancialRecords (D-5c)", () => {
  it("P/L 科目の明細は符号規約どおりの符号付き金額で journalEntryId 付きの行を作る", async () => {
    const { db, createMany } = fakeDb();
    const details: JournalDetailForSync[] = [
      { accountId: 1, category: "EXPENSE", side: "debit", amount: 3000 },
      { accountId: 2, category: "ASSET", side: "credit", amount: 3000 },
    ];

    await syncJournalToFinancialRecords(db, 7, 99, new Date("2026-07-01"), details);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].data).toEqual([
      {
        tenantId: 7,
        accountId: 1,
        periodId: 42,
        amount: 3000,
        journalEntryId: 99,
      },
    ]);
  });

  it("B/S 科目（ASSET/LIABILITY）の明細は同期対象から除外する", async () => {
    const { db, createMany } = fakeDb();
    const details: JournalDetailForSync[] = [
      { accountId: 1, category: "ASSET", side: "debit", amount: 1000 },
      { accountId: 2, category: "LIABILITY", side: "credit", amount: 1000 },
    ];

    await syncJournalToFinancialRecords(db, 7, 99, new Date("2026-07-01"), details);

    expect(createMany).not.toHaveBeenCalled();
  });

  it("全明細が B/S 科目の場合は会計期間の解決すら行わない（no-op）", async () => {
    const { db, upsert, createMany } = fakeDb();
    const details: JournalDetailForSync[] = [
      { accountId: 1, category: "ASSET", side: "debit", amount: 1000 },
      { accountId: 2, category: "LIABILITY", side: "credit", amount: 1000 },
    ];

    await syncJournalToFinancialRecords(db, 7, 99, new Date("2026-07-01"), details);

    expect(upsert).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
