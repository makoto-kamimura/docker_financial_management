// 口座残高の定義を 1 か所に集約する。
//
// 残高 = 明細の増減合計（SUM(bank_transactions.amount)）+ 差額（BankAccount.balanceAdjustment）。
// 差額は CSV の取込開始前から口座にあった残高（期首残高）など、明細に現れない分を吸収するための
// 手入力値。以前は明細合計だけを残高としていたため、口座サマリ・総資産サマリ・資金繰り・
// 残高推移グラフのすべてが同じ額だけ実残高とずれていた。
//
// この関数を全ての残高算出の入口にすることで、定義が分岐しないようにする。

export type BankAccountBalanceInput = {
  id: number;
  /** Prisma の Decimal / string / number いずれでも受け取れるようにする */
  balanceAdjustment?: unknown;
};

export type TransactionSumInput = {
  accountId: number;
  sum: unknown;
};

/** Decimal | string | number | null | undefined を number へ（未設定は 0） */
export function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 1 口座分の残高 */
export function bankBalanceOf(transactionSum: unknown, balanceAdjustment: unknown): number {
  return toNumber(transactionSum) + toNumber(balanceAdjustment);
}

/**
 * 口座 id -> 残高 のマップを作る。明細が 1 件も無い口座も差額だけの残高として含める。
 */
export function buildBankBalanceMap(
  accounts: BankAccountBalanceInput[],
  sums: TransactionSumInput[],
): Map<number, number> {
  const sumMap = new Map(sums.map((s) => [s.accountId, toNumber(s.sum)]));
  return new Map(
    accounts.map((a) => [a.id, bankBalanceOf(sumMap.get(a.id) ?? 0, a.balanceAdjustment)]),
  );
}
