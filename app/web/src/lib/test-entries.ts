import { prisma } from "@/lib/prisma";
import { entryCreateData, type EntryTarget, type NewEntry } from "@/lib/ledger-entries";

// 結合テスト用: 明細（実績の表 financial_records の kind を持つ行）を 1 行入れる。
// 取引日の年月の期間を用意し、科目があれば実績の金額もそろえる（lib/ledger-entries.ts の entryCreateData）。
// 実績の確定は見ない（確定済みの月のデータを用意したいテストもあるため）。

export type TestEntry = Omit<NewEntry, "source"> & {
  source?: NewEntry["source"];
  chargeGroupId?: string | null;
};

export async function createTestEntry(tenantId: number, target: EntryTarget, e: TestEntry) {
  const year = e.date.getFullYear();
  const month = e.date.getMonth() + 1;
  const period = await prisma.period.upsert({
    where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
    update: {},
    create: { tenantId, fiscalYear: year, month, quarter: Math.ceil(month / 3) },
  });
  return prisma.financialRecord.create({
    data: {
      ...entryCreateData(tenantId, target, period.id, { ...e, source: e.source ?? "MANUAL" }),
      chargeGroupId: e.chargeGroupId ?? null,
    },
  });
}
