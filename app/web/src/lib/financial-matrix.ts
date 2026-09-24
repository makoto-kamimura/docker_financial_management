// 実績（FinancialRecord）を「勘定科目 × 月」のテーブル表示に組み替える。
// 予算（Budget）は科目・期間ごとに 1 行しか持てないが、実績は同じ科目・同じ月に
// 複数行（銀行明細からの転記・手入力など）が並ぶ。そのためセルは合計値を持ち、
// 元の行も保持して「1 行だけのセルはその場で編集できる」ようにする。

export type MatrixAccount = { id: number; code: string; name: string; category: string };

export type MatrixRecord = {
  id: number;
  amount: number;
  account: MatrixAccount;
  period: { fiscalYear: number; month: number };
};

// 呼び出し側が実績に追加の項目（journalEntryId など）を持たせていても失わないよう総称型にする
export type MatrixCell<T extends MatrixRecord = MatrixRecord> = {
  /** そのセルに属する実績（登録順） */
  records: T[];
  /** セルの合計金額 */
  total: number;
};

export type MatrixRow<T extends MatrixRecord = MatrixRecord> = {
  account: MatrixAccount;
  byMonth: Map<number, MatrixCell<T>>;
  /** 1〜12 月の合計 */
  annual: number;
};

export const MATRIX_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// 科目コードごとに 1 行へまとめる。行は科目コードの昇順で返す（呼び出し側でカテゴリ順に並べ替える）。
export function buildFinancialMatrix<T extends MatrixRecord>(records: T[]): MatrixRow<T>[] {
  const rows = new Map<string, MatrixRow<T>>();

  for (const r of records) {
    const key = r.account.code;
    const row: MatrixRow<T> = rows.get(key) ?? {
      account: r.account,
      byMonth: new Map(),
      annual: 0,
    };
    const cell: MatrixCell<T> = row.byMonth.get(r.period.month) ?? { records: [], total: 0 };
    cell.records.push(r);
    cell.total += Number(r.amount);
    row.byMonth.set(r.period.month, cell);
    row.annual += Number(r.amount);
    rows.set(key, row);
  }

  return [...rows.values()].sort((a, b) => a.account.code.localeCompare(b.account.code));
}

// セルが「その場で編集できる」のは実績が 1 行だけのとき。
// 複数行あるセルはどの行を更新すべきか決められないため、履歴（一覧モード）へ誘導する。
export function editableRecord<T extends MatrixRecord>(cell: MatrixCell<T> | undefined): T | null {
  if (!cell || cell.records.length !== 1) return null;
  return cell.records[0];
}
