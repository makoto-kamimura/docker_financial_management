import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { withCache } from "@/lib/server/redis";
import { actualRows } from "@/lib/ledger/actuals";
import { actualWhere, scopedAmount, ScopeQuery } from "@/lib/ledger/scope";

// GET /api/closing/statements?year=&departmentId=&scope= … P/L・B/S・財務指標（Redis キャッシュ）
//   scope=business（個人事業主モード）は、事業利用の明細と明細でない行（仕訳・減価償却など）を数える。
//   費用は、明細の全額を total、按分した事業の分を deductible（経費にできる額）、その比を businessRate とする
//   （按分は明細ごと。lib/ledger/scope.ts）。収入・原価は事業の分を total にする。
//   household（家庭・法人モード）は按分しない（deductible = total）。
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery.extend({
    year: z.coerce.number().int().optional(),
    departmentId: z.coerce.number().int().positive().optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const fiscalYear = query.year ?? new Date().getFullYear();
    const { departmentId } = query;
    const { scope } = query;
    const cacheKey = departmentId
      ? `closing:statements:${tenantId}:${fiscalYear}:${scope}:dept:${departmentId}`
      : `closing:statements:${tenantId}:${fiscalYear}:${scope}`;

    const payload = await withCache(cacheKey, 3600, async () => {
      const records = actualRows(
        await db.financialRecord.findMany({
          where: {
            tenantId,
            ...actualWhere(scope),
            period: { fiscalYear },
            ...(departmentId ? { departmentId } : {}),
          },
          include: { account: true, period: true },
        }),
      );

      type AccountSummary = {
        accountId: number;
        code: string;
        name: string;
        soleName: string | null;
        corporateName: string | null;
        category: string;
        total: number;
        /** 事業の分（費用の経費にできる額）。household では total と同じ */
        deductible: number;
        parentId: number | null;
      };

      // D-5c/再設計詳細設計書.md §12.4: B/S 科目（ASSET/LIABILITY）は assets/summary と同じ
      // 「年内最も新しい月」のスナップショットを残高として採用する（全行の単純合計は二重計上になる）。
      // P/L 科目（REVENUE/COGS/EXPENSE 等）は従来どおり年内全行を単純合計する。
      const summaryMap = new Map<number, AccountSummary>();
      const latestBsMonthByAccount = new Map<number, number>();
      for (const r of records) {
        const key = r.accountId;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            accountId: key,
            code: r.account.code,
            name: r.account.name,
            soleName: r.account.soleName,
            corporateName: r.account.corporateName,
            category: r.account.category,
            parentId: r.account.parentId,
            total: 0,
            deductible: 0,
          });
        }
        const entry = summaryMap.get(key)!;
        const isBalanceSheet = r.account.category === "ASSET" || r.account.category === "LIABILITY";
        if (isBalanceSheet) {
          const latestMonth = latestBsMonthByAccount.get(key);
          if (latestMonth === undefined || r.period.month > latestMonth) {
            latestBsMonthByAccount.set(key, r.period.month);
            entry.total = Number(r.amount);
            entry.deductible = entry.total;
          }
        } else {
          const portion = scopedAmount(r, scope);
          // 費用は明細の全額と事業の分を分けて出す。収入・原価は事業の分を合計にする
          entry.total += r.account.category === "EXPENSE" ? Number(r.amount) : portion;
          entry.deductible += portion;
        }
      }

      const all = [...summaryMap.values()];

      type MonthData = { revenue: number; cogs: number; expense: number };
      const monthly: Record<number, MonthData> = {};
      for (let m = 1; m <= 12; m++) monthly[m] = { revenue: 0, cogs: 0, expense: 0 };

      for (const r of records) {
        const m = r.period.month;
        const cat = r.account.category;
        const amount = scopedAmount(r, scope);
        if (cat === "REVENUE") monthly[m].revenue += amount;
        if (cat === "COGS") monthly[m].cogs += amount;
        if (cat === "EXPENSE") monthly[m].expense += amount;
      }

      const revenue = all
        .filter((a) => a.category === "REVENUE")
        .sort((a, b) => a.code.localeCompare(b.code));
      const cogs = all
        .filter((a) => a.category === "COGS")
        .sort((a, b) => a.code.localeCompare(b.code));
      const expenses = all
        .filter((a) => a.category === "EXPENSE")
        .sort((a, b) => a.code.localeCompare(b.code));

      const revenueTotal = revenue.reduce((s, a) => s + a.total, 0);
      const cogsTotal = cogs.reduce((s, a) => s + a.total, 0);
      const grossProfit = revenueTotal - cogsTotal;

      // 按分率は科目の全額に対する事業の分の割合（0.1% 単位）。明細ごとに按分しているので目安の値
      const expensesWithApportionment = expenses.map((e) => ({
        ...e,
        businessRate: e.total === 0 ? 100 : Math.round((e.deductible / e.total) * 1000) / 10,
      }));

      const expenseTotal = expenses.reduce((s, a) => s + a.total, 0);
      const expenseDeductible = expensesWithApportionment.reduce((s, a) => s + a.deductible, 0);
      const netIncome = grossProfit - expenseDeductible;

      const assets = all
        .filter((a) => a.category === "ASSET")
        .sort((a, b) => a.code.localeCompare(b.code));
      const liabilities = all
        .filter((a) => a.category === "LIABILITY")
        .sort((a, b) => a.code.localeCompare(b.code));
      const assetTotal = assets.reduce((s, a) => s + a.total, 0);
      const liabilityTotal = liabilities.reduce((s, a) => s + a.total, 0);

      const trialBalance = all.sort((a, b) => a.code.localeCompare(b.code));

      // D-2: 締め状態は FiscalYear（旧 FiscalYearClose を統合）で管理する
      const closeStatus = await db.fiscalYear.findUnique({
        where: { tenantId_year: { tenantId, year: fiscalYear } },
      });

      const businessProfile = await db.businessProfile.findUnique({ where: { tenantId } });

      const currentAssets = assets.filter((a) => a.code < "1500").reduce((s, a) => s + a.total, 0);
      const currentLiabilities = liabilities
        .filter((a) => a.code < "3400")
        .reduce((s, a) => s + a.total, 0);
      const equity = assetTotal - liabilityTotal;

      const ratios = {
        currentRatio:
          currentLiabilities > 0
            ? Math.round((currentAssets / currentLiabilities) * 100) / 100
            : null,
        equityRatio: assetTotal > 0 ? Math.round((equity / assetTotal) * 1000) / 10 : null,
        roa: assetTotal > 0 ? Math.round((netIncome / assetTotal) * 1000) / 10 : null,
        roe: equity > 0 ? Math.round((netIncome / equity) * 1000) / 10 : null,
        grossProfitRate:
          revenueTotal > 0 ? Math.round((grossProfit / revenueTotal) * 1000) / 10 : null,
        operatingMargin:
          revenueTotal > 0 ? Math.round((netIncome / revenueTotal) * 1000) / 10 : null,
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
        bs: { assets, assetTotal, liabilities, liabilityTotal, equity },
        ratios,
        trialBalance,
        monthly,
        businessProfile,
        closeStatus,
      };
    });

    return NextResponse.json(payload);
  },
});
