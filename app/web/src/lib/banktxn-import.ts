import Papa from "papaparse";
import { z } from "zod";

// 銀行入出金 CSV の 1 行スキーマ。
// ヘッダ: date,description,amount[,balance]
// amount は +入金 / -出金
const RowSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.coerce.number(),
  balance: z.coerce.number().optional(),
});

export type ParsedTxn = {
  date: string;
  description: string;
  amount: number;
  balance?: number;
  externalId: string;
};

export type ParseResult = { rows: ParsedTxn[]; errors: { row: number; message: string }[] };

// CSV テキストを入出金明細に変換する。externalId は内容から決定的に生成し重複取込を防ぐ。
export function parseBankCsv(csv: string, accountId: number): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const rows: ParsedTxn[] = [];
  const errors: ParseResult["errors"] = [];

  parsed.data.forEach((raw, i) => {
    const r = RowSchema.safeParse(raw);
    if (!r.success) {
      errors.push({ row: i + 2, message: "validation error" });
      return;
    }
    const { date, description, amount, balance } = r.data;
    rows.push({
      date,
      description,
      amount,
      balance,
      externalId: `csv-${accountId}-${date}-${amount}-${description}`,
    });
  });

  return { rows, errors };
}
