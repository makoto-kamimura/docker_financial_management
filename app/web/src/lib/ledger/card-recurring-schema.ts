import { z } from "zod";

// カードの固定決済（CardRecurringPayment）の入力スキーマ。
//
// Transfer（資金移動ルール）と違い銀行口座を持たない。カード払いのサブスクは利用時点で
// 現金が動かず、実際の出金はカード全体の引き落とし 1 本にまとまるため、口座を紐付けると
// 資金繰りに同じ支出が二重で乗ってしまう。ここで持つのは「どのカードで・毎月何日に・いくら」だけ。
//
// note / categoryAccountId はフォームの任意項目で、未入力時に null が送られてくるため
// undefined だけでなく null も受け付ける（transfer-schema.ts と同じ理由）。
export const CardRecurringCreateSchema = z.object({
  accountId: z.number().int().positive(),
  label: z.string().trim().min(1),
  amount: z.number().positive(),
  day: z.number().int().min(1).max(31),
  categoryAccountId: z.number().int().positive().nullish(),
  note: z.string().nullish(),
});

export const CardRecurringPatchSchema = z.object({
  label: z.string().trim().min(1).optional(),
  amount: z.number().positive().optional(),
  day: z.number().int().min(1).max(31).optional(),
  categoryAccountId: z.number().int().positive().nullish(),
  note: z.string().nullish(),
});
