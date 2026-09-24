import { NextResponse } from "next/server";
import { ratePercentOf, manualMonthlyPaymentOf } from "@/lib/personal-asset-debt";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { withCache } from "@/lib/redis";
import { summarizeNetWorth, type NetWorthAccountBalance } from "@/lib/asset-summary";
import { computeDebtSchedule } from "@/lib/debt-schedule";
import { buildBankBalanceMap } from "@/lib/bank-balance";

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
      const [
        personalAssets,
        bankSums,
        records,
        loans,
        linkedAccounts,
        bankAccountMappings,
        bankAccounts,
      ] = await Promise.all([
        db.personalAsset.findMany({ where: { tenantId }, include: { loan: true } }),
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
        // D-4: 実物資産の紐付け負債（personalAsset あり）は personalAssetDebts 側で
        // スケジュール計算した残高を計上するため、ここでは除外して二重計上を防ぐ
        db.loan.findMany({
          where: { tenantId, status: "active", personalAsset: { is: null } },
          select: { remainingAmount: true },
        }),
        db.linkedAccount.findMany({
          where: { tenantId, accountId: { not: null } },
          select: { accountId: true },
        }),
        // D-1: 銀行口座の勘定科目紐付けは bank_accounts.accountId に統合された
        db.bankAccount.findMany({
          where: { tenantId, accountId: { not: null } },
          select: { accountId: true },
        }),
        // 残高の差額（期首残高相当）を含めるため口座も引く（lib/bank-balance.ts）
        db.bankAccount.findMany({
          where: { tenantId },
          select: { id: true, balanceAdjustment: true },
        }),
      ]);

      // 口座残高は口座サマリと同じ定義（明細合計 + 差額）で算出する
      const bankBalanceMap = buildBankBalanceMap(
        bankAccounts,
        bankSums.map((b) => ({ accountId: b.accountId, sum: b._sum.amount?.toNumber() ?? 0 })),
      );

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

      // D-4: 実物資産の紐付け負債は Loan（personal_assets.loanId）から均等割りスケジュールで算出
      const personalAssetDebts = personalAssets
        .filter((a) => a.loan !== null)
        .map((a) =>
          computeDebtSchedule(
            Number(a.loan!.amount),
            a.loan!.borrowedOn,
            a.loan!.repaymentDate,
            new Date(),
            ratePercentOf(Number(a.loan!.interestRate)),
            manualMonthlyPaymentOf(a.loan),
            Number(a.loan!.residualValue ?? 0),
          ),
        )
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => ({ remaining: s.remaining }));

      const result = summarizeNetWorth({
        personalAssets: personalAssets.map((a) => ({
          currentValue: Number(a.currentValue),
          countAsAsset: a.countAsAsset,
          linkedAccountId: a.linkedAccountId,
        })),
        bankBalances: [...bankBalanceMap.entries()].map(([accountId, balance]) => ({
          accountId,
          balance,
        })),
        accountBalances,
        loans: loans.map((l) => ({ remainingAmount: Number(l.remainingAmount) })),
        linkedAccountMappings: [...bankAccountMappings, ...linkedAccounts].map((l) => ({
          accountId: l.accountId!,
        })),
        personalAssetDebts,
      });

      return { year, month, ...result };
    });

    return NextResponse.json(payload);
  },
});
