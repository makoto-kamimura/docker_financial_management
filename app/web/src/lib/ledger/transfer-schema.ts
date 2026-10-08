import { z } from "zod";

// 資金移動ルール（Transfer）の入力スキーマ。
// label / note は DB でも nullable（schema.prisma の String?）。フォームの任意項目は
// 未入力時に null として送られてくるため、undefined だけでなく null も受け付ける
// （nullish）。ここを optional にすると「ラベル・メモ未入力の追加」が 400 で弾かれる。
const channel = z.enum(["BANK_TRANSFER", "AUTO_DEBIT", "CARD_PAYMENT", "INCOME", "EXPENSE"]);

export const TransferCreateSchema = z
  .object({
    fromAccountId: z.number().int().nullable().optional(),
    toAccountId: z.number().int().nullable().optional(),
    amount: z.number().positive(),
    kind: z.enum(["MANUAL", "AUTO"]).default("AUTO"),
    channel: channel.default("BANK_TRANSFER"),
    label: z.string().nullish(),
    day: z.number().int().min(1).max(31),
    note: z.string().nullish(),
    // カード引き落としで紐付ける登録済みカード・電子マネー（LinkedAccount）
    linkedAccountId: z.number().int().nullable().optional(),
  })
  .refine((d) => d.fromAccountId != null || d.toAccountId != null, {
    message: "出金元または入金先のいずれかは口座を指定してください",
  })
  .refine((d) => !(d.fromAccountId != null && d.fromAccountId === d.toAccountId), {
    message: "出金元と入金先が同じです",
  });

export const TransferPatchSchema = z.object({
  fromAccountId: z.number().int().nullable().optional(),
  toAccountId: z.number().int().nullable().optional(),
  amount: z.number().positive().optional(),
  kind: z.enum(["MANUAL", "AUTO"]).optional(),
  channel: channel.optional(),
  label: z.string().nullish(),
  day: z.number().int().min(1).max(31).optional(),
  note: z.string().nullish(),
  linkedAccountId: z.number().int().nullable().optional(),
});
