// 予算管理の一覧のセルの内訳（web とモバイルで共有する。shared-with-mobile.ts）。
//
// 予算は科目×月で 1 行（budgets.amount）だが、その中身は次の出どころに分けて見せる:
//   - カレンダーで登録した 1 件ずつ（budget_items）
//   - 一覧・CSV・予算配分などで入れた額（budgets.amount からカレンダーの合計を引いた残り）
//   - 借入の返済の自動加算（借入金管理で予算の連携先を入れた借入）
//   - 資産の借入の自動加算（実物資産に紐付く借入）
// 自動加算の 2 つは budgets を書き換えず、表示のときに足している（lib/budget/budget-overlay.ts）。

export type BudgetCellItem = {
  id: number;
  /** "YYYY-MM-DD" */
  date: string;
  description: string;
  amount: number;
  createdAt: string;
};

export type BudgetCellRow =
  | ({ kind: "calendar" } & BudgetCellItem)
  | { kind: "direct"; amount: number }
  | { kind: "loan"; amount: number }
  | { kind: "assetDebt"; amount: number; assetNames: string[] };

export const BUDGET_SOURCE_LABEL: Record<BudgetCellRow["kind"], string> = {
  calendar: "カレンダーで登録",
  direct: "一覧・CSV・予算配分など",
  loan: "借入の返済（自動加算）",
  assetDebt: "資産の借入（自動加算）",
};

export function buildBudgetCellDetail(input: {
  /** budgets.amount（行が無ければ 0） */
  budgetAmount: number;
  items: BudgetCellItem[];
  loanOverlay: number;
  assetDebtOverlay: number;
  assetNames?: string[];
}): { rows: BudgetCellRow[]; total: number } {
  const { budgetAmount, items, loanOverlay, assetDebtOverlay } = input;
  const itemsTotal = items.reduce((s, i) => s + i.amount, 0);
  const direct = budgetAmount - itemsTotal;
  const rows: BudgetCellRow[] = [
    ...items.map((i) => ({ kind: "calendar" as const, ...i })),
    ...(Math.abs(direct) >= 0.5 ? [{ kind: "direct" as const, amount: direct }] : []),
    ...(loanOverlay !== 0 ? [{ kind: "loan" as const, amount: loanOverlay }] : []),
    ...(assetDebtOverlay !== 0
      ? [
          {
            kind: "assetDebt" as const,
            amount: assetDebtOverlay,
            assetNames: input.assetNames ?? [],
          },
        ]
      : []),
  ];
  return { rows, total: budgetAmount + loanOverlay + assetDebtOverlay };
}
