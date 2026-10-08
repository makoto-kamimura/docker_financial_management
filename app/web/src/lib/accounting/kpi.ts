import type { AccountCategory } from "@prisma/client";

// 月次の科目別金額（カテゴリ単位で集約済み）
export type MonthlyByCategory = {
  key: string; // "YYYY-MM"
  revenue: number;
  cogs: number;
  expense: number;
};

export type Kpi = {
  period: string;
  revenue: number;
  grossProfit: number; // 売上総利益 = 売上 - 売上原価
  grossMargin: number; // 売上総利益率
  operatingProfit: number; // 営業利益 = 売上総利益 - 販管費
  operatingMargin: number; // 営業利益率
  ytd: number; // 期首（12 月決算なら 1 月）から対象月までの累計（売上）
};

// 対象月の予算（KPI カードに実績と並べて表示する）
export type KpiBudget = {
  revenue: number; // 収入/売上の予算
  cogs: number;
  expense: number;
  grossProfit: number; // 予算上の売上総利益
  operatingProfit: number; // 予算上の営業利益（家計では貯蓄額）
  /** 実績 ÷ 予算。予算が 0 の項目は null（「—」表示） */
  revenueRate: number | null;
  expenseRate: number | null;
  operatingProfitRate: number | null;
};

const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);

// "YYYY-MM" を delta か月ずらす
export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// 対象月を含む期（決算月で締める 1 年）の範囲。closingMonth は決算月（1〜12、既定 12 ＝ 1〜12 月）。
// 月キーは暦の "YYYY-MM"（Period.fiscalYear は暦年）なので、期首キー〜期末キーの範囲で扱う。
export function fiscalPeriodOf(
  targetKey: string,
  closingMonth = 12,
): { startKey: string; endKey: string; elapsedMonths: number } {
  const [y, m] = targetKey.split("-").map(Number);
  const startMonth = (closingMonth % 12) + 1;
  const startYear = m >= startMonth ? y : y - 1;
  const startKey = `${startYear}-${String(startMonth).padStart(2, "0")}`;
  return {
    startKey,
    endKey: shiftMonthKey(startKey, 11),
    elapsedMonths: y * 12 + m - (startYear * 12 + startMonth) + 1,
  };
}

// カテゴリを売上/原価/費用にマップする
export function categoryBucket(
  category: AccountCategory,
): keyof Omit<MonthlyByCategory, "key"> | null {
  switch (category) {
    case "REVENUE":
      return "revenue";
    case "COGS":
      return "cogs";
    case "EXPENSE":
      return "expense";
    default:
      return null;
  }
}

// 月次系列から指定月の主要 KPI を算出する。targetKey 省略時は最新月。
// monthly は key 昇順（古い→新しい）で渡すこと。
// 系列に存在しない月を指定した場合は null（対象月セレクタは実データのある月だけを提示する）。
// closingMonth は決算月（累計の区切り。既定 12 ＝ 1 月から）。
export function computeKpiAt(
  monthly: MonthlyByCategory[],
  targetKey?: string,
  closingMonth = 12,
): Kpi | null {
  if (monthly.length === 0) return null;

  const target = targetKey
    ? (monthly.find((x) => x.key === targetKey) ?? null)
    : monthly[monthly.length - 1];
  if (!target) return null;

  const grossProfit = target.revenue - target.cogs;
  const operatingProfit = grossProfit - target.expense;

  // 期首から対象月までの売上合計
  const { startKey } = fiscalPeriodOf(target.key, closingMonth);
  const ytd = monthly
    .filter((x) => x.key >= startKey && x.key <= target.key)
    .reduce((s, x) => s + x.revenue, 0);

  return {
    period: target.key,
    revenue: target.revenue,
    grossProfit,
    grossMargin: ratio(grossProfit, target.revenue),
    operatingProfit,
    operatingMargin: ratio(operatingProfit, target.revenue),
    ytd,
  };
}

// 月次系列から最新月の主要 KPI を算出する。
export function computeLatestKpi(monthly: MonthlyByCategory[]): Kpi | null {
  return computeKpiAt(monthly);
}

// 期（決算月で締める 1 年）の着地見込みと、その時点での達成率。
export type AnnualOutlook = {
  /** 決算月（1〜12） */
  closingMonth: number;
  /** 期首・期末の月キー（"YYYY-MM"） */
  startKey: string;
  endKey: string;
  /** 実績として扱う最後の月（"YYYY-MM"）。これより後は入力があっても予測で見積もる */
  actualThroughKey: string;
  /** 期首から actualThroughKey までの累計（入力のある月の合計） */
  ytd: number;
  /** 期首から actualThroughKey までの月数（0〜12。前の期で区切ると 0） */
  elapsedMonths: number;
  /** そのうち入力のある月数 */
  enteredMonths: number;
  /** そのうち入力の無い月数（入力済み月の平均で埋める） */
  missingMonths: number;
  /** 入力の無い月の見積もり合計 = 入力済み月の平均 × missingMonths */
  estimatedMissing: number;
  /** actualThroughKey より後の残り月数（12 - elapsedMonths） */
  remainingMonths: number;
  /** 残り月の予測合計 */
  forecastRemaining: number;
  /** 年間の見込み = ytd + estimatedMissing + forecastRemaining */
  projected: number;
  /** 現時点の達成率 = ytd ÷ 見込み。見込みが 0 なら null（「—」表示） */
  progressRate: number | null;
};

// 対象月までの実績から、期の着地見込みを出す。
//   - 期首から対象月までで入力の無い月は、入力のある月の平均で埋める（按分）。
//     入力が対象月だけなら、その月 × 経過月数になる（1 か月の入力だけで年間の目安が出る）
//   - 残りの月は forecastFn（lib/budget/forecast.ts の forecast()（履歴, 月数）を想定）で予測する。
//     予測の学習には対象月以前の全実績を使う（前の期も含める）
//   - actualThroughKey（実績を確定した最後の月など）が対象月より前なら、そこまでを実績とし、
//     その後の月は入力があっても予測で埋める（明細が途中までしか無い月で見込みがぶれないように）
// value は月から取り出す値（既定は売上・収入。利益の見込みにも同じ計算を使う）。
export function computeAnnualOutlook(
  monthly: MonthlyByCategory[],
  targetKey: string,
  forecastFn: (history: number[], months: number) => number[],
  opts: {
    closingMonth?: number;
    value?: (m: MonthlyByCategory) => number;
    actualThroughKey?: string;
  } = {},
): AnnualOutlook | null {
  if (!/^\d{4}-\d{2}$/.test(targetKey ?? "")) return null;
  const closingMonth = opts.closingMonth ?? 12;
  const value = opts.value ?? ((m: MonthlyByCategory) => m.revenue);
  const { startKey, endKey } = fiscalPeriodOf(targetKey, closingMonth);
  const through =
    opts.actualThroughKey && opts.actualThroughKey < targetKey ? opts.actualThroughKey : targetKey;
  const [ty, tm] = through.split("-").map(Number);
  const [sy, sm] = startKey.split("-").map(Number);
  const elapsedMonths = Math.max(ty * 12 + tm - (sy * 12 + sm) + 1, 0);

  const entered = monthly.filter((x) => x.key >= startKey && x.key <= through);
  const ytd = entered.reduce((s, x) => s + value(x), 0);
  const enteredMonths = entered.length;
  const missingMonths = Math.max(elapsedMonths - enteredMonths, 0);
  const estimatedMissing = enteredMonths === 0 ? 0 : (ytd / enteredMonths) * missingMonths;

  const remainingMonths = 12 - elapsedMonths;
  const history = monthly.filter((x) => x.key <= through).map(value);
  const forecast =
    remainingMonths > 0 && history.length > 0 ? forecastFn(history, remainingMonths) : [];
  const forecastRemaining = forecast.reduce((s, v) => s + v, 0);
  const projected = ytd + estimatedMissing + forecastRemaining;

  return {
    closingMonth,
    startKey,
    endKey,
    actualThroughKey: through,
    ytd,
    elapsedMonths,
    enteredMonths,
    missingMonths,
    estimatedMissing,
    remainingMonths,
    forecastRemaining,
    projected,
    progressRate: projected === 0 ? null : ytd / projected,
  };
}

// 対象月の予算を集計し、実績との対比率を添えて返す。
// budgetMonthly は実績と同じ形の予算系列。対象月の予算が無ければ null。
export function computeKpiBudgetAt(
  budgetMonthly: MonthlyByCategory[],
  targetKey: string,
  actual: Kpi | null,
): KpiBudget | null {
  const b = budgetMonthly.find((x) => x.key === targetKey);
  if (!b) return null;

  const grossProfit = b.revenue - b.cogs;
  const operatingProfit = grossProfit - b.expense;
  // 予算 0 での除算は「—」に落とす（達成率として意味を持たないため）
  const rate = (a: number, den: number) => (den === 0 ? null : a / den);

  return {
    revenue: b.revenue,
    cogs: b.cogs,
    expense: b.expense,
    grossProfit,
    operatingProfit,
    revenueRate: actual ? rate(actual.revenue, b.revenue) : null,
    expenseRate: actual ? rate(actual.revenue - actual.operatingProfit, b.cogs + b.expense) : null,
    operatingProfitRate: actual ? rate(actual.operatingProfit, operatingProfit) : null,
  };
}
