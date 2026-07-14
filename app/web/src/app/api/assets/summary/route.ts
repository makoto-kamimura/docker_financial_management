import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { withCache } from "@/lib/redis";
import { summarizeNetWorth, type NetWorthAccountBalance } from "@/lib/asset-summary";
import { computeDebtSchedule } from "@/lib/debt-schedule";

// GET /api/assets/summary?year=&month= … 総資産（純資産）サマリ（Redis キャッシュ 1 時間）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const now = new Date();
    const year = query.year ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;
    const cacheKey = `assets:summary:${tenantId}:${year}-${month}`;

    const payload = await withCache(cacheKey, 3600, async () => {
      const [personalAssets, bankSums, records, loans, linkedAccounts] = await Promise.all([
        db.personalAsset.findMany({ where: { tenantId } }),
        db.bankTransaction.groupBy({
          by: ["accountId"],
          _sum: { amount: true },
          where: { account: { tenantId } },
        }),
        db.financialRecord.findMany({
          where: {
            tenantId,
            account: { category: { in: ["ASSET", "LIABILITY"] } },
            period: { fiscalYear: year },
          },
          include: {
            account: { select: { id: true, category: true } },
            period: { select: { month: true } },
          },
        }),
        db.loan.findMany({
          where: { tenantId, status: "active" },
          select: { remainingAmount: true },
        }),
        db.linkedAccount.findMany({
          where: { tenantId, accountId: { not: null } },
          select: { accountId: true },
        }),
      ]);

      // 科目ごとに「year 内で最も新しい月」のスナップショットを現在残高として採用する
      const latestByAccount = new Map<
        number,
        { category: "ASSET" | "LIABILITY"; month: number; amount: number }
      >();
      for (const r of records) {
        const category = r.account.category as "ASSET" | "LIABILITY";
        const existing = latestByAccount.get(r.accountId);
        if (!existing || r.period.month > existing.month) {
          latestByAccount.set(r.accountId, {
            category,
            month: r.period.month,
            amount: Number(r.amount),
          });
        }
      }
      const accountBalances: NetWorthAccountBalance[] = [...latestByAccount.entries()].map(
        ([accountId, v]) => ({ accountId, category: v.category, balance: v.amount }),
      );

      const personalAssetDebts = personalAssets
        .filter((a) => a.debtInitialAmount !== null && a.debtStartOn && a.debtPayoffDue)
        .map((a) =>
          computeDebtSchedule(Number(a.debtInitialAmount), a.debtStartOn!, a.debtPayoffDue!),
        )
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => ({ remaining: s.remaining }));

      const result = summarizeNetWorth({
        personalAssets: personalAssets.map((a) => ({
          category: a.category,
          currentValue: Number(a.currentValue),
          linkedAccountId: a.linkedAccountId,
        })),
        bankBalances: bankSums.map((b) => ({
          accountId: b.accountId,
          balance: b._sum.amount?.toNumber() ?? 0,
        })),
        accountBalances,
        loans: loans.map((l) => ({ remainingAmount: Number(l.remainingAmount) })),
        linkedAccountMappings: linkedAccounts.map((l) => ({ accountId: l.accountId! })),
        personalAssetDebts,
      });

      return { year, month, ...result };
    });

    return NextResponse.json(payload);
  },
});
