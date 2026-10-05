// 予算の月次サイクル（予実対比 → 翌月の予算案 → 確定）の計算。I/O を持たない純関数。
//
// 考え方（会社の予算管理に合わせる）:
// - 確定した予算は比べる基準として固定し、あとから書き換えない。
// - 予算の余りは、原則として翌月に繰り越さない（使い切る動機を生まないため）。
// - 差額の扱いは科目ごとに選ぶ。
//     none     … 何もしない（既定）。翌月の予算は基準額のまま。
//     timing   … 時期のずれ（期ズレ）。差額を翌月の同じ科目に移す。
//                 予算より少なかった分は翌月に足し、多かった分は翌月から引く。
//     transfer … 余った分を回し先の科目へ移す（家計なら貯蓄、事業なら流用）。
//                 費用の科目で予算より少なかった（余った）ときだけ選べる。
// - 翌月の基準額は、翌月にすでに予算があればその額、無ければ当月の予算（引き継ぎ）。

export type BudgetCycleCategory = "REVENUE" | "COGS" | "EXPENSE";

export const BUDGET_CYCLE_CATEGORIES: readonly BudgetCycleCategory[] = [
  "REVENUE",
  "COGS",
  "EXPENSE",
];

export type VarianceTreatment = "none" | "timing" | "transfer";

export type VarianceInput = {
  accountId: number;
  accountCode: string;
  name: string;
  category: BudgetCycleCategory;
  /** 当月に登録した予算（null = 未登録） */
  budget: number | null;
  /** 当月の自動反映（ローン返済などの上乗せ）。予算のデータには含まれない */
  overlay: number;
  /** 当月の実績 */
  actual: number;
  /** 翌月に登録済みの予算（null = 未登録） */
  nextBudget: number | null;
};

export type VarianceRow = VarianceInput & {
  /** 比べる基準の予算（登録した予算 + 自動反映） */
  plan: number;
  /** 実績 − 予算 */
  difference: number;
  /**
   * 有利な差か。収入は実績が多いほど、費用は実績が少ないほど有利。
   * 差が 0 のときは null。
   */
  favorable: boolean | null;
  /** 余った（費用の科目で実績が予算を下回った）か。transfer を選べるのはこのときだけ */
  surplus: boolean;
};

export function isExpenseCategory(category: BudgetCycleCategory): boolean {
  return category !== "REVENUE";
}

export function computeVariance(input: VarianceInput): VarianceRow {
  const plan = (input.budget ?? 0) + input.overlay;
  const difference = input.actual - plan;
  const expense = isExpenseCategory(input.category);
  const favorable = difference === 0 ? null : expense ? difference < 0 : difference > 0;
  return { ...input, plan, difference, favorable, surplus: expense && difference < 0 };
}

export type VarianceSummary = {
  revenue: { plan: number; actual: number };
  expense: { plan: number; actual: number };
  /** 費用の科目で余った額の合計 */
  surplusTotal: number;
  /** 費用の科目で超えた額の合計 */
  overrunTotal: number;
};

export function summarizeVariance(rows: VarianceRow[]): VarianceSummary {
  const summary: VarianceSummary = {
    revenue: { plan: 0, actual: 0 },
    expense: { plan: 0, actual: 0 },
    surplusTotal: 0,
    overrunTotal: 0,
  };
  for (const r of rows) {
    if (isExpenseCategory(r.category)) {
      summary.expense.plan += r.plan;
      summary.expense.actual += r.actual;
      if (r.difference < 0) summary.surplusTotal += -r.difference;
      if (r.difference > 0) summary.overrunTotal += r.difference;
    } else {
      summary.revenue.plan += r.plan;
      summary.revenue.actual += r.actual;
    }
  }
  return summary;
}

/**
 * 差額の扱いの既定値。
 * 家計は余った分を回し先（貯蓄）へ移し、それ以外は何もしない。
 * 個人事業・法人は、会社の予算管理にならってすべて「何もしない」（繰り越さない）。
 */
export function defaultTreatment(
  row: VarianceRow,
  opts: { household: boolean; hasTransferTarget: boolean },
): VarianceTreatment {
  if (opts.household && opts.hasTransferTarget && row.surplus) return "transfer";
  return "none";
}

/** その行で選べる扱いか（transfer は余ったときだけ、かつ回し先が自分以外のとき） */
export function isTreatmentAllowed(
  row: VarianceRow,
  treatment: VarianceTreatment,
  transferTargetId: number | null,
): boolean {
  if (treatment === "transfer") {
    return row.surplus && transferTargetId !== null && transferTargetId !== row.accountId;
  }
  return true;
}

/** 翌月の予算案の増減の内訳（画面で科目名を付けて説明する） */
export type NextBudgetNote =
  | { kind: "timing"; amount: number }
  | { kind: "transfer"; fromAccountId: number; amount: number };

export type NextBudgetItem = {
  accountId: number;
  /** 翌月の基準額（翌月の登録済み予算、無ければ当月の予算） */
  base: number;
  /** 差額の扱いによる増減 */
  adjustment: number;
  /** 翌月の予算案（0 未満にはしない） */
  amount: number;
  /** 増減の内訳 */
  notes: NextBudgetNote[];
  /** 調整後が 0 未満になり 0 に切り上げたか */
  clamped: boolean;
};

/**
 * 当月の予実と差額の扱いから、翌月の予算案を作る。
 * 返すのは、基準額があるか調整がある科目だけ（予算も実績も無い科目は含めない）。
 */
export function planNextBudget(input: {
  rows: VarianceRow[];
  treatments: ReadonlyMap<number, VarianceTreatment>;
  /** transfer の回し先の科目（null = 回し先なし） */
  transferTargetId: number | null;
  /** 回し先が rows に無いときの翌月の基準額（既定 0） */
  transferTargetBase?: number;
}): NextBudgetItem[] {
  const items = new Map<number, NextBudgetItem>();
  const ensure = (accountId: number, base: number) => {
    let item = items.get(accountId);
    if (!item) {
      item = { accountId, base, adjustment: 0, amount: 0, notes: [], clamped: false };
      items.set(accountId, item);
    }
    return item;
  };

  for (const row of input.rows) {
    const base = row.nextBudget ?? row.budget ?? 0;
    const hasBase = row.nextBudget !== null || row.budget !== null;
    const requested = input.treatments.get(row.accountId) ?? "none";
    const treatment = isTreatmentAllowed(row, requested, input.transferTargetId)
      ? requested
      : "none";

    if (treatment === "timing" && row.difference !== 0) {
      const item = ensure(row.accountId, base);
      // 予算 − 実績 を翌月へ（足りなかった収入・使わなかった費用は翌月に足し、
      // 先に入った収入・先に使った費用は翌月から引く）
      const delta = -row.difference;
      item.adjustment += delta;
      item.notes.push({ kind: "timing", amount: delta });
    } else if (treatment === "transfer" && input.transferTargetId !== null) {
      ensure(row.accountId, base);
      const targetRow = input.rows.find((r) => r.accountId === input.transferTargetId);
      const targetBase = targetRow
        ? (targetRow.nextBudget ?? targetRow.budget ?? 0)
        : (input.transferTargetBase ?? 0);
      const target = ensure(input.transferTargetId, targetBase);
      const surplus = -row.difference;
      target.adjustment += surplus;
      target.notes.push({ kind: "transfer", fromAccountId: row.accountId, amount: surplus });
    } else if (hasBase) {
      ensure(row.accountId, base);
    }
  }

  for (const item of items.values()) {
    const raw = item.base + item.adjustment;
    item.clamped = raw < 0;
    item.amount = Math.max(0, Math.round(raw));
  }
  return [...items.values()];
}

/** 翌月（12 月の次は翌年 1 月） */
export function nextYearMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** 前月（1 月の前は前年 12 月） */
export function prevYearMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
