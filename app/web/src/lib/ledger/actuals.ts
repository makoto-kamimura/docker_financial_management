import type { Prisma } from "@prisma/client";

// 実績の読み出しの共通部分。
//
// 実績の表（financial_records）には、実績の行（仕訳・減価償却・棚卸・売掛買掛・過去の直接入力）と、
// 明細の行（現金・銀行・カード）が一緒に載る。科目（accountId）が付いた行が実績で、
// 科目が無い明細（未割り当て・振替・チャージ）は amount = 0 のまま実績に入らない。
// 実績を読む所は ACTUAL_WHERE で科目のある行に絞り、actualRows で科目を空でない型に直す。

/** 実績として数える行（科目が付いた行） */
export const ACTUAL_WHERE = {
  accountId: { not: null },
} as const satisfies Prisma.FinancialRecordWhereInput;

type Actual<T> = T &
  (T extends { accountId: unknown } ? { accountId: number } : unknown) &
  (T extends { account: infer A } ? { account: NonNullable<A> } : unknown);

/** 科目のある行だけを残し、accountId・account を空でない型にする（ACTUAL_WHERE で絞った結果に使う） */
export function actualRows<T extends object>(rows: T[]): Actual<T>[] {
  return rows.filter(
    (r) =>
      (!("accountId" in r) || r.accountId !== null) && (!("account" in r) || r.account !== null),
  ) as Actual<T>[];
}
