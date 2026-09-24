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
  mom: number | null; // 前月比（売上）
  yoy: number | null; // 前年同月比（売上）
  ytd: number; // 当年累計（売上）
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
export function computeKpiAt(monthly: MonthlyByCategory[], targetKey?: string): Kpi | null {
  if (monthly.length === 0) return null;

  const target = targetKey
    ? (monthly.find((x) => x.key === targetKey) ?? null)
    : monthly[monthly.length - 1];
  if (!target) return null;

  const grossProfit = target.revenue - target.cogs;
  const operatingProfit = grossProfit - target.expense;

  // 前月・前年同月は暦上のキーで引く（データが欠けている月は null＝「—」表示）
  const prevMonthKey = shiftMonthKey(target.key, -1);
  const prevMonth = monthly.find((x) => x.key === prevMonthKey) ?? null;
  const prevYearKey = shiftMonthKey(target.key, -12);
  const prevYear = monthly.find((x) => x.key === prevYearKey) ?? null;

  // 当年累計（同一年で対象月までの売上合計）
  const year = target.key.slice(0, 4);
  const ytd = monthly
    .filter((x) => x.key.startsWith(`${year}-`) && x.key <= target.key)
    .reduce((s, x) => s + x.revenue, 0);

  return {
    period: target.key,
    revenue: target.revenue,
    grossProfit,
    grossMargin: ratio(grossProfit, target.revenue),
    operatingProfit,
    operatingMargin: ratio(operatingProfit, target.revenue),
    mom: prevMonth ? ratio(target.revenue - prevMonth.revenue, prevMonth.revenue) : null,
    yoy: prevYear ? ratio(target.revenue - prevYear.revenue, prevYear.revenue) : null,
    ytd,
  };
}

// 月次系列から最新月の主要 KPI を算出する。
export function computeLatestKpi(monthly: MonthlyByCategory[]): Kpi | null {
  return computeKpiAt(monthly);
}

// 当年の着地見込み（実績の当年累計 + 残り月の予測）と、その時点での達成率。
export type AnnualOutlook = {
  year: number;
  /** 当年累計（実績）＝ Kpi.ytd と同じ */
  ytd: number;
  /** 対象月より後の残り月数（12 - 対象月） */
  remainingMonths: number;
  /** 残り月の予測合計 */
  forecastRemaining: number;
  /** 年間累計の想定額 = ytd + forecastRemaining */
  projected: number;
  /** 現時点の達成率 = ytd ÷ 想定額。想定額が 0 なら null（「—」表示） */
  progressRate: number | null;
};

// 対象月までの売上実績から、残り月を予測して年間の着地見込みを出す。
// forecastFn は lib/forecast.ts の forecast()（履歴, 月数）を想定する。
export function computeAnnualOutlook(
  monthly: MonthlyByCategory[],
  targetKey: string,
  forecastFn: (history: number[], months: number) => number[],
): AnnualOutlook | null {
  if (!targetKey) return null;
  const year = Number(targetKey.slice(0, 4));
  const month = Number(targetKey.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;

  const ytd = monthly
    .filter((x) => x.key.startsWith(`${year}-`) && x.key <= targetKey)
    .reduce((s, x) => s + x.revenue, 0);

  const remainingMonths = 12 - month;
  // 予測の学習には対象月以前の全実績を使う（前年以前も含める）
  const history = monthly.filter((x) => x.key <= targetKey).map((x) => x.revenue);
  const forecast =
    remainingMonths > 0 && history.length > 0 ? forecastFn(history, remainingMonths) : [];
  const forecastRemaining = forecast.reduce((s, v) => s + v, 0);
  const projected = ytd + forecastRemaining;

  return {
    year,
    ytd,
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
