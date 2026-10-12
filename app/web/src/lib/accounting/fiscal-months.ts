// 期（会計期間）の開始月と決算月。開始月は決算月の翌月で、tenants の CHECK 制約でも保証している。

/** 決算月（1〜12）から開始月を求める。決算 3 月 → 4 月、決算 12 月 → 1 月 */
export function startMonthFor(closingMonth: number): number {
  return (closingMonth % 12) + 1;
}

/** 開始月が決算月の翌月になっているか */
export function isValidFiscalMonths(startMonth: number, closingMonth: number): boolean {
  return startMonth === startMonthFor(closingMonth);
}

/** 対応していないときの理由（画面と API で同じ文言を使う） */
export function fiscalMonthsError(closingMonth: number): string {
  return `開始月は決算月（${closingMonth}月）の翌月の${startMonthFor(closingMonth)}月にしてください`;
}
