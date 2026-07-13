import { z } from "zod";
import { parseYearMonth } from "@/lib/year-month";

// "YYYY-MM" 文字列を検証して Date（月初）へ変換する共通スキーマ。
// personal-assets の debtStartOn / debtPayoffDue などで使用する。
export const zYearMonth = z.string().transform((v, ctx) => {
  const d = parseYearMonth(v);
  if (!d) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid: ${v} (expected YYYY-MM)` });
    return z.NEVER;
  }
  return d;
});

// ISO 日付文字列（YYYY-MM-DD 等）を Date に変換する共通スキーマ。
export const zDate = z.string().transform((v, ctx) => {
  const d = new Date(v);
  if (isNaN(d.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid date: ${v}` });
    return z.NEVER;
  }
  return d;
});
