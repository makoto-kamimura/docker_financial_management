import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { shiftYm, trendMonths, ym } from "@/lib/balance-trend";
import { buildCashOutlook, type OutlookRule } from "@/lib/cash-outlook";
import { categoryBucket } from "@/lib/kpi";
import { loanFundingTransfers } from "@/lib/loan-funding";

// GET /api/bank-accounts/cash-outlook?before=12&after=12 … 銀行管理の残高の推移。
//   今月の前後の月末残高を、口座ごとと合計で返す（計算は lib/cash-outlook.ts）。
//   過去は明細のある月からにする（最大 before か月前）。口座ごとの先の見込みは資金繰りと同じく
//   資金移動ルール + 借入の返済の自動の引き落とし、合計の先の見込みは予算と実績の収支から出す。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    before: z.coerce.number().int().min(0).max(36).default(12),
    after: z.coerce.number().int().min(1).max(24).default(12),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const currentKey = ym(year, month);

    const [bankAccounts, txns, transfers, loans, records, budgets] = await Promise.all([
      db.bankAccount.findMany({
        where: { tenantId },
        orderBy: { id: "asc" },
        select: { id: true, name: true, balanceAdjustment: true },
      }),
      db.ledgerEntry.findMany({
        where: { kind: "BANK" },
        select: { bankAccountId: true, date: true, amount: true },
      }),
      db.transfer.findMany({ where: { tenantId } }),
      db.loan.findMany({ where: { tenantId, debitBankAccountId: { not: null } } }),
      db.financialRecord.findMany({
        where: { tenantId, period: { fiscalYear: year, month } },
        select: { amount: true, account: { select: { category: true } } },
      }),
      db.budget.findMany({
        where: { tenantId, period: { fiscalYear: { gte: year, lte: year + 3 } } },
        select: {
          amount: true,
          period: { select: { fiscalYear: true, month: true } },
          account: { select: { category: true } },
        },
      }),
    ]);

    // 口座 × 月ごとの明細の増減合計と、明細のある最初の月
    const monthlyNet = new Map<number, Map<string, number>>();
    let firstKey: string | null = null;
    for (const t of txns) {
      const key = ym(t.date.getUTCFullYear(), t.date.getUTCMonth() + 1);
      const perAccount = monthlyNet.get(t.bankAccountId!) ?? new Map<string, number>();
      perAccount.set(key, (perAccount.get(key) ?? 0) + Number(t.amount));
      monthlyNet.set(t.bankAccountId!, perAccount);
      if (!firstKey || key < firstKey) firstKey = key;
    }

    // 資金繰りと同じ毎月の入出金（資金移動ルール + 同じルールの無い借入の返済）
    const ruleList = transfers.map((t) => ({
      fromId: t.fromAccountId,
      toId: t.toAccountId,
      amount: Number(t.amount),
      day: t.day,
    }));
    const rules: OutlookRule[] = [...ruleList, ...loanFundingTransfers(loans, ruleList).transfers];

    // 予算・実績の収支（収入 − 原価 − 費用）を月ごとに
    const netOf = (category: Parameters<typeof categoryBucket>[0], amount: number) => {
      const bucket = categoryBucket(category);
      return bucket === "revenue" ? amount : bucket ? -amount : 0;
    };
    const budgetNet = new Map<string, number>();
    for (const b of budgets) {
      const key = ym(b.period.fiscalYear, b.period.month);
      if (key < currentKey) continue;
      budgetNet.set(key, (budgetNet.get(key) ?? 0) + netOf(b.account.category, Number(b.amount)));
    }
    const actualNet = new Map<string, number>();
    for (const r of records) {
      actualNet.set(
        currentKey,
        (actualNet.get(currentKey) ?? 0) + netOf(r.account.category, Number(r.amount)),
      );
    }

    // 過去は明細のある月から（最大 before か月前）
    const earliest = shiftYm(year, month, -query.before);
    const start = firstKey && firstKey > earliest ? firstKey : firstKey ? earliest : currentKey;
    const [sy, sm] = start.split("-").map(Number);
    const before = (year - sy) * 12 + (month - sm);
    const months = trendMonths(year, month, Math.max(before, 0), query.after);

    const outlook = buildCashOutlook({
      accountIds: bankAccounts.map((a) => a.id),
      monthlyNet,
      adjustments: new Map(bankAccounts.map((a) => [a.id, Number(a.balanceAdjustment)])),
      rules,
      months,
      currentKey,
      budgetNet,
      actualNet,
    });

    return NextResponse.json({
      months,
      currentKey,
      total: outlook.total,
      totalBasis: outlook.totalBasis,
      accounts: bankAccounts.map((a) => {
        const values = outlook.accounts.get(a.id) ?? [];
        return { id: a.id, name: a.name, balance: values[months.indexOf(currentKey)] ?? 0, values };
      }),
    });
  },
});
