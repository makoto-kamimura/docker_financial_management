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

// 学習ルールのキーワード正規化（前後空白除去・連続空白の圧縮・大文字化）。
// マッチング側（classifyByRules）も同じ大文字化で比較するため、保存形式を揃えておく。
export function normalizeKeyword(text: string): string {
  return text.trim().replace(/\s+/g, " ").toUpperCase();
}

export type TxnCategoryRuleInput = { keyword: string; categoryAccountId: number; priority: number };

// 摘要にマッチする科目 ID をルールから決定する（取込時の自動分類。転記は行わない）。
// 優先度（priority）降順 → キーワード長い順で評価し、最初に一致したものを採用する。
export function classifyByRules(description: string, rules: TxnCategoryRuleInput[]): number | null {
  const normalizedDesc = normalizeKeyword(description);
  const sorted = [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.keyword.length - a.keyword.length;
  });
  for (const rule of sorted) {
    if (normalizedDesc.includes(normalizeKeyword(rule.keyword))) {
      return rule.categoryAccountId;
    }
  }
  return null;
}
