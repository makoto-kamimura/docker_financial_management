// ダッシュボードの「予算と実績」グラフのデータ整形。I/O を持たない純関数（web・モバイル共用）。
//
// 予実対比の行（GET /api/budgets/variance）を、収入と支出の 2 つのグループに分け、
// それぞれ合計 1 本と科目別の横棒にする。科目は差（実績 − 予算）の大きい順に上位だけ出し、
// 残りは「その他」にまとめる（色の数・行の数を増やさないため）。
// 横棒の長さは、グループの中で予算と実績の大きいほうを 100% とした割合で返す。
import { isExpenseCategory, type VarianceRow } from "./budget-cycle";

export type BudgetActualBar = {
  /** 科目 ID。合計・その他は null */
  accountId: number | null;
  label: string;
  plan: number;
  actual: number;
  /** 実績 − 予算 */
  difference: number;
  /** 有利な差か（収入は多いほど、支出は少ないほど有利）。予算 0 や差 0 は null */
  favorable: boolean | null;
  /** 予算の長さ（0〜1、グループ内の最大に対する割合） */
  planRatio: number;
  /** 実績の長さ（0〜1） */
  actualRatio: number;
};

export type BudgetActualGroup = {
  kind: "revenue" | "expense";
  total: BudgetActualBar;
  items: BudgetActualBar[];
};

export const BUDGET_ACTUAL_TOP_N = 6;

function favorableOf(kind: BudgetActualGroup["kind"], plan: number, actual: number) {
  if (plan === 0 || actual === plan) return null;
  return kind === "expense" ? actual < plan : actual > plan;
}

function bar(
  kind: BudgetActualGroup["kind"],
  accountId: number | null,
  label: string,
  plan: number,
  actual: number,
): Omit<BudgetActualBar, "planRatio" | "actualRatio"> {
  return {
    accountId,
    label,
    plan,
    actual,
    difference: actual - plan,
    favorable: favorableOf(kind, plan, actual),
  };
}

function withRatios(
  bars: Omit<BudgetActualBar, "planRatio" | "actualRatio">[],
  scale: number,
): BudgetActualBar[] {
  const r = (v: number) => (scale <= 0 ? 0 : Math.max(0, v) / scale);
  return bars.map((b) => ({ ...b, planRatio: r(b.plan), actualRatio: r(b.actual) }));
}

/**
 * 収入・支出のグループを作る。予算も実績も無いグループは返さない。
 * nameOf は科目の表示名（表示モードに合わせた名前）を返す関数。
 */
export function buildBudgetActualGroups(
  rows: VarianceRow[],
  nameOf: (row: VarianceRow) => string,
  labels: { revenue: string; expense: string },
  topN = BUDGET_ACTUAL_TOP_N,
): BudgetActualGroup[] {
  const groups: BudgetActualGroup[] = [];
  for (const kind of ["revenue", "expense"] as const) {
    const members = rows.filter(
      (r) =>
        (kind === "expense") === isExpenseCategory(r.category) && (r.plan !== 0 || r.actual !== 0),
    );
    if (members.length === 0) continue;

    const sorted = [...members].sort(
      (a, b) => Math.abs(b.difference) - Math.abs(a.difference) || b.plan - a.plan,
    );
    // 「その他」が 1 科目だけなら、まとめずにそのまま出す
    const shown = sorted.length <= topN + 1 ? sorted : sorted.slice(0, topN);
    const rest = sorted.slice(shown.length);
    const items = shown.map((r) => bar(kind, r.accountId, nameOf(r), r.plan, r.actual));
    if (rest.length > 0) {
      const plan = rest.reduce((s, r) => s + r.plan, 0);
      const actual = rest.reduce((s, r) => s + r.actual, 0);
      items.push(bar(kind, null, `その他（${rest.length}科目）`, plan, actual));
    }

    const plan = members.reduce((s, r) => s + r.plan, 0);
    const actual = members.reduce((s, r) => s + r.actual, 0);
    const total = bar(kind, null, labels[kind], plan, actual);

    // 合計と科目は桁が違うので、合計は合計どうし、科目は科目どうしで長さをそろえる
    const itemScale = Math.max(0, ...items.flatMap((b) => [b.plan, b.actual]));
    const [totalWithRatio] = withRatios([total], Math.max(total.plan, total.actual));
    groups.push({ kind, total: totalWithRatio, items: withRatios(items, itemScale) });
  }
  return groups;
}
