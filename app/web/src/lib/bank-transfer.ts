// 口座間振替（都度の資金移動）。1 回の振替を出金元・入金先それぞれの明細 2 行で表す。
//
// 自己口座間の移動は収入でも支出でもないため、作った 2 行は科目に紐付けない
// （transferGroupId を持つ行は科目紐付け・実績転記の対象外）。資金フロー図も実績転記も
// categoryAccountId を起点に集計するので、未紐付けのまま残せば二重計上されずに残高だけが動く。

import { z } from "zod";

export const BankTransferCreateSchema = z
  .object({
    date: z.string().min(1),
    fromAccountId: z.number().int().positive(),
    toAccountId: z.number().int().positive(),
    amount: z.number().positive(),
    // 摘要は任意。未入力なら相手口座名から自動で組み立てる
    description: z.string().nullish(),
  })
  .refine((d) => d.fromAccountId !== d.toAccountId, {
    message: "出金元と入金先が同じです",
  });

export type BankTransferInput = z.output<typeof BankTransferCreateSchema>;

export type BankTransferRow = {
  accountId: number;
  date: Date;
  description: string;
  amount: number;
  transferGroupId: string;
};

/** 摘要未入力時の既定文言（相手口座名が分からない場合のフォールバック） */
const OTHER_ACCOUNT = "他口座";

/**
 * 振替 1 件を明細 2 行に展開する。出金元は −amount、入金先は +amount。
 * 返り値は [出金元の行, 入金先の行]。
 */
export function buildTransferPair(
  input: BankTransferInput,
  transferGroupId: string,
  names: { fromName?: string | null; toName?: string | null } = {},
): [BankTransferRow, BankTransferRow] {
  const date = new Date(input.date);
  const amount = Math.abs(input.amount);
  const memo = input.description?.trim() ? input.description.trim() : null;

  return [
    {
      accountId: input.fromAccountId,
      date,
      description: memo ?? `${names.toName ?? OTHER_ACCOUNT} へ振替`,
      amount: -amount,
      transferGroupId,
    },
    {
      accountId: input.toAccountId,
      date,
      description: memo ?? `${names.fromName ?? OTHER_ACCOUNT} から振替`,
      amount,
      transferGroupId,
    },
  ];
}
