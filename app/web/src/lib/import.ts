import Papa from "papaparse";
import * as XLSX from "xlsx";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// 取り込み行スキーマ。ヘッダ: accountCode,fiscalYear,month,amount
const RowSchema = z.object({
  accountCode: z.coerce.string().min(1),
  fiscalYear: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  amount: z.coerce.number(),
});

export type ImportResult = { inserted: number; errors: { row: number; message: string }[] };

// CSV テキストを行配列に変換する
export function parseCsv(csv: string): Record<string, unknown>[] {
  return Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true }).data;
}

// xlsx バイナリを行配列に変換する（先頭シート）
export function parseXlsx(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
}

// 行配列をバリデーションして実績データとして登録する（CSV/Excel 共通）
export async function importRows(rows: Record<string, unknown>[]): Promise<ImportResult> {
  const errors: ImportResult["errors"] = [];
  let inserted = 0;

  for (let i = 0; i < rows.length; i++) {
    const result = RowSchema.safeParse(rows[i]);
    if (!result.success) {
      errors.push({ row: i + 2, message: "validation error" });
      continue;
    }
    const { accountCode, fiscalYear, month, amount } = result.data;

    const account = await prisma.account.findUnique({ where: { code: accountCode } });
    if (!account) {
      errors.push({ row: i + 2, message: `unknown account code: ${accountCode}` });
      continue;
    }

    const period = await prisma.period.upsert({
      where: { fiscalYear_month: { fiscalYear, month } },
      update: {},
      create: { fiscalYear, month, quarter: Math.ceil(month / 3) },
    });

    await prisma.financialRecord.create({
      data: { accountId: account.id, periodId: period.id, amount },
    });
    inserted++;
  }

  return { inserted, errors };
}
