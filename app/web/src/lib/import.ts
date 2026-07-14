import Papa from "papaparse";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// S-11: 行数上限・ファイルサイズ上限。超過はルートハンドラ側で 400 として拒否する。
// banktxn-import.ts（銀行明細 CSV）にも同じ上限を適用する（詳細設計書 §7）。
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5MB
// Decimal(18,2) に安全に収まる範囲（整数部 16 桁未満）。DB エラーを事前に遮断する。
const MAX_AMOUNT_ABS = 10 ** 16;

const RowSchema = z.object({
  accountCode: z.coerce.string().min(1),
  fiscalYear: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce
    .number()
    .finite()
    .refine((v) => Math.abs(v) < MAX_AMOUNT_ABS, { message: "amount out of range" }),
});

export type ImportResult = { inserted: number; errors: { row: number; message: string }[] };

export function parseCsv(csv: string): Record<string, unknown>[] {
  return Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true }).data;
}

function periodKey(fiscalYear: number, month: number): string {
  return `${fiscalYear}-${month}`;
}

function parsePeriodKey(key: string): { fiscalYear: number; month: number } {
  const [fiscalYear, month] = key.split("-").map(Number);
  return { fiscalYear, month };
}

// S-11: バッチ化 + トランザクション原子化。
// ① 全行 Zod 検証 → ② accountCode / (fiscalYear, month) を一括解決 → ③ 不足 Period を作成 →
// ④ financial_records と履歴を一括作成、を prisma.$transaction で包む。
// エラー行が 1 行でもあれば全体を中止する（部分取込を残さない。従来の「エラー行スキップで
// 続行」から仕様変更 — 取込結果の予測可能性を優先し、エラー一覧を返してユーザーに修正させる）。
export async function importRows(
  rows: Record<string, unknown>[],
  tenantId: number,
): Promise<ImportResult> {
  const errors: ImportResult["errors"] = [];
  const parsedRows: {
    row: number;
    accountCode: string;
    fiscalYear: number;
    month: number;
    amount: number;
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const result = RowSchema.safeParse(rows[i]);
    if (!result.success) {
      errors.push({ row: i + 2, message: "validation error" });
      continue;
    }
    parsedRows.push({ row: i + 2, ...result.data });
  }

  if (errors.length > 0) return { inserted: 0, errors };
  if (parsedRows.length === 0) return { inserted: 0, errors: [] };

  const accountCodes = [...new Set(parsedRows.map((r) => r.accountCode))];
  const periodKeys = [...new Set(parsedRows.map((r) => periodKey(r.fiscalYear, r.month)))];

  const accounts = await prisma.account.findMany({
    where: { tenantId, code: { in: accountCodes } },
    select: { id: true, code: true },
  });
  const accountIdByCode = new Map(accounts.map((a) => [a.code, a.id]));

  for (const r of parsedRows) {
    if (!accountIdByCode.has(r.accountCode)) {
      errors.push({ row: r.row, message: `unknown account code: ${r.accountCode}` });
    }
  }
  if (errors.length > 0) return { inserted: 0, errors };

  const existingPeriods = await prisma.period.findMany({
    where: { tenantId, OR: periodKeys.map((k) => parsePeriodKey(k)) },
    select: { id: true, fiscalYear: true, month: true },
  });
  const periodIdByKey = new Map(
    existingPeriods.map((p) => [periodKey(p.fiscalYear, p.month), p.id]),
  );
  const missingPeriodKeys = periodKeys.filter((k) => !periodIdByKey.has(k));

  const inserted = await prisma.$transaction(async (tx) => {
    if (missingPeriodKeys.length > 0) {
      const createdPeriods = await tx.period.createManyAndReturn({
        data: missingPeriodKeys.map((k) => {
          const { fiscalYear, month } = parsePeriodKey(k);
          return { tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) };
        }),
        select: { id: true, fiscalYear: true, month: true },
      });
      for (const p of createdPeriods) {
        periodIdByKey.set(periodKey(p.fiscalYear, p.month), p.id);
      }
    }

    const createdRecords = await tx.financialRecord.createManyAndReturn({
      data: parsedRows.map((r) => ({
        tenantId,
        accountId: accountIdByCode.get(r.accountCode)!,
        periodId: periodIdByKey.get(periodKey(r.fiscalYear, r.month))!,
        amount: r.amount,
      })),
      select: { id: true, amount: true },
    });

    await tx.financialRecordHistory.createMany({
      data: createdRecords.map((rec) => ({
        recordId: rec.id,
        action: "create",
        amount: rec.amount,
      })),
    });

    return createdRecords.length;
  });

  return { inserted, errors: [] };
}
