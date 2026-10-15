// レシートの読み取り結果から、セルフメディケーション税制の対象の額と品目を出す。
// Web とモバイルで同じ内容を持つ（shared-with-mobile.ts）。

type DraftItem = { name: string; amount: number; selfMedication?: boolean };

/**
 * 印字された対象額があればそれを、無ければ対象の品目（selfMedication が true）の合計を使う。
 * 対象が見つからなければ null
 */
export function selfMedicationOf(draft: {
  items: DraftItem[];
  selfMedicationTotal?: number | null;
}): { amount: number; items: { name: string; amount: number }[] } | null {
  const items = draft.items
    .filter((i) => i.selfMedication === true)
    .map(({ name, amount }) => ({ name, amount }));
  const sum = items.reduce((s, i) => s + i.amount, 0);
  const amount = draft.selfMedicationTotal ?? (items.length > 0 ? Math.max(0, sum) : null);
  return amount === null ? null : { amount, items };
}
