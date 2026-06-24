import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { withCache } from "@/lib/redis";

// GET /api/closing/statements?year=2026&departmentId=1
// 試算表・損益計算書・貸借対照表・月別収支を返す
// departmentId を指定すると部門別に絞り込む
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const fiscalYear   = Number(sp.get("year")         ?? new Date().getFullYear());
  const departmentId = sp.get("departmentId") ? Number(sp.get("departmentId")) : undefined;
  const cacheKey     = departmentId
    ? `closing:statements:${fiscalYear}:dept:${departmentId}`
    : `closing:statements:${fiscalYear}`;

  const payload = await withCache(cacheKey, 3600, async () => {

  // 1. 年間合計（勘定科目別）
  const records = await prisma.financialRecord.findMany({
    where: {
      period: { fiscalYear },
      ...(departmentId ? { departmentId } : {}),
    },
    include: { account: true, period: true },
  });

  // 2. 家事按分設定
  const apportionments = await prisma.apportionment.findMany({
    include: { account: true },
  });
  const apportionMap = new Map(apportionments.map(a => [a.accountId, Number(a.businessRate)]));

  // 3. 勘定科目別集計
  type AccountSummary = {
    accountId: number; code: string; name: string; category: string;
    total: number; parentId: number | null;
  };

  const summaryMap = new Map<number, AccountSummary>();
  for (const r of records) {
    const key = r.accountId;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        accountId: key,
        code:      r.account.code,
        name:      r.account.name,
        category:  r.account.category,
        parentId:  r.account.parentId,
        total:     0,
      });
    }
    summaryMap.get(key)!.total += Number(r.amount);
  }

  const all = [...summaryMap.values()];

  // 4. 月別収支（月→{revenue, cogs, expense}）
  type MonthData = { revenue: number; cogs: number; expense: number };
  const monthly: Record<number, MonthData> = {};
  for (let m = 1; m <= 12; m++) monthly[m] = { revenue: 0, cogs: 0, expense: 0 };

  for (const r of records) {
    const m = r.period.month;
    const cat = r.account.category;
    if (cat === "REVENUE") monthly[m].revenue += Number(r.amount);
    if (cat === "COGS")    monthly[m].cogs    += Number(r.amount);
    if (cat === "EXPENSE") monthly[m].expense += Number(r.amount);
  }

  // 5. P&L 構築
  const revenue  = all.filter(a => a.category === "REVENUE").sort((a, b) => a.code.localeCompare(b.code));
  const cogs     = all.filter(a => a.category === "COGS").sort((a, b) => a.code.localeCompare(b.code));
  const expenses = all.filter(a => a.category === "EXPENSE").sort((a, b) => a.code.localeCompare(b.code));

  const revenueTotal  = revenue.reduce((s, a) => s + a.total, 0);
  const cogsTotal     = cogs.reduce((s, a) => s + a.total, 0);
  const grossProfit   = revenueTotal - cogsTotal;

  // 家事按分適用後の費用
  const expensesWithApportionment = expenses.map(e => ({
    ...e,
    businessRate: apportionMap.get(e.accountId) ?? 100,
    deductible:   Math.floor(e.total * (apportionMap.get(e.accountId) ?? 100) / 100),
  }));

  const expenseTotal      = expenses.reduce((s, a) => s + a.total, 0);
  const expenseDeductible = expensesWithApportionment.reduce((s, a) => s + a.deductible, 0);
  const netIncome         = grossProfit - expenseDeductible;

  // 6. B/S 構築
  const assets      = all.filter(a => a.category === "ASSET").sort((a, b) => a.code.localeCompare(b.code));
  const liabilities = all.filter(a => a.category === "LIABILITY").sort((a, b) => a.code.localeCompare(b.code));
  const assetTotal      = assets.reduce((s, a) => s + a.total, 0);
  const liabilityTotal  = liabilities.reduce((s, a) => s + a.total, 0);

  // 7. 試算表（全科目）
  const trialBalance = all.sort((a, b) => a.code.localeCompare(b.code));

  // 8. 決算ステータス
  const closeStatus = await prisma.fiscalYearClose.findUnique({ where: { fiscalYear } });

  // 9. 事業者情報
  const businessProfile = await prisma.businessProfile.findFirst({ orderBy: { id: "asc" } });

  // 10. 財務分析指標（法人向け）
  const currentAssets      = assets.filter(a => a.code < "1500").reduce((s, a) => s + a.total, 0);
  const currentLiabilities = liabilities.filter(a => a.code < "3400").reduce((s, a) => s + a.total, 0);
  const equity             = assetTotal - liabilityTotal;

  const ratios = {
    currentRatio:     currentLiabilities > 0 ? Math.round((currentAssets  / currentLiabilities) * 100) / 100 : null,
    equityRatio:      assetTotal > 0          ? Math.round((equity         / assetTotal)          * 1000) / 10 : null,
    roa:              assetTotal > 0          ? Math.round((netIncome      / assetTotal)           * 1000) / 10 : null,
    roe:              equity     > 0          ? Math.round((netIncome      / equity)               * 1000) / 10 : null,
    grossProfitRate:  revenueTotal > 0        ? Math.round((grossProfit    / revenueTotal)         * 1000) / 10 : null,
    operatingMargin:  revenueTotal > 0        ? Math.round((netIncome      / revenueTotal)         * 1000) / 10 : null,
  };

  return {
    fiscalYear,
    departmentId: departmentId ?? null,
    pnl: {
      revenue,
      revenueTotal,
      cogs,
      cogsTotal,
      grossProfit,
      expenses: expensesWithApportionment,
      expenseTotal,
      expenseDeductible,
      netIncome,
    },
    bs: {
      assets,
      assetTotal,
      liabilities,
      liabilityTotal,
      equity,
    },
    ratios,
    trialBalance,
    monthly,
    businessProfile,
    closeStatus,
  };
  }); // end withCache

  return NextResponse.json(payload);
}
