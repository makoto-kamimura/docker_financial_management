// カード・電子マネー管理のサマリ「利用額の推移」（純関数）。
//
// 月の利用額 = 利用 − 返金（ここで受け取る金額は +利用 / −返金。明細の表の +入金 / −出金を lib/ledger/ledger-entries.ts の cardSpend で直したもの）。次はお金の置き場所が変わっただけなので除く:
//   - チャージ（transferToAccountId あり。実際の支出はチャージ先の利用明細で数える）
//   - チャージ先に入った側（chargeGroupId だけを持つ行）
// 今月までは明細の実績、先の月はそのカードの固定決済（CardRecurringPayment）の合計で見込む。

export type UsageTxn = {
  accountId: number;
  /** "YYYY-MM" */
  month: string;
  amount: number;
  transferToAccountId: number | null;
  chargeGroupId: string | null;
};

/** 利用額に数える明細か（チャージとチャージ先に入った側を除く） */
export function countsAsUsage(t: Pick<UsageTxn, "transferToAccountId" | "chargeGroupId">) {
  return t.transferToAccountId === null && t.chargeGroupId === null;
}

export function buildCardUsageTrend(input: {
  cardIds: number[];
  txns: UsageTxn[];
  /** カード id -> 固定決済の月額の合計 */
  recurringMonthly: Map<number, number>;
  /** 表示する月（昇順） */
  months: string[];
  /** 今月（"YYYY-MM"）。ここまでを実績にする */
  currentKey: string;
}): { cards: Map<number, number[]>; total: number[] } {
  const { cardIds, txns, recurringMonthly, months, currentKey } = input;
  const usage = new Map<string, number>();
  for (const t of txns) {
    if (!countsAsUsage(t)) continue;
    const key = `${t.accountId}:${t.month}`;
    usage.set(key, (usage.get(key) ?? 0) + t.amount);
  }
  const cards = new Map<number, number[]>();
  for (const id of cardIds) {
    cards.set(
      id,
      months.map((m) =>
        m <= currentKey ? (usage.get(`${id}:${m}`) ?? 0) : (recurringMonthly.get(id) ?? 0),
      ),
    );
  }
  const total = months.map((_, i) => cardIds.reduce((s, id) => s + cards.get(id)![i], 0));
  return { cards, total };
}
