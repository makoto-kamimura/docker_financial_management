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

const ratio = (num: number, den: number) => (den === 0 ? 0 : num / den);

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

// 月次系列から最新月の主要 KPI を算出する。
// monthly は key 昇順（古い→新しい）で渡すこと。
export function computeLatestKpi(monthly: MonthlyByCategory[]): Kpi | null {
  if (monthly.length === 0) return null;

  const latest = monthly[monthly.length - 1];
  const prevMonth = monthly[monthly.length - 2] ?? null;

  const grossProfit = latest.revenue - latest.cogs;
  const operatingProfit = grossProfit - latest.expense;

  // 前年同月（key の年だけ -1）
  const [y, m] = latest.key.split("-");
  const prevYearKey = `${Number(y) - 1}-${m}`;
  const prevYear = monthly.find((x) => x.key === prevYearKey) ?? null;

  // 当年累計（同一年の売上合計）
  const ytd = monthly.filter((x) => x.key.startsWith(`${y}-`)).reduce((s, x) => s + x.revenue, 0);

  return {
    period: latest.key,
    revenue: latest.revenue,
    grossProfit,
    grossMargin: ratio(grossProfit, latest.revenue),
    operatingProfit,
    operatingMargin: ratio(operatingProfit, latest.revenue),
    mom: prevMonth ? ratio(latest.revenue - prevMonth.revenue, prevMonth.revenue) : null,
    yoy: prevYear ? ratio(latest.revenue - prevYear.revenue, prevYear.revenue) : null,
    ytd,
  };
}
