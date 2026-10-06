import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { computeDebtSchedule } from "@/lib/debt-schedule";
import { loanBalanceAt } from "@/lib/loan-balance";
import { manualMonthlyPaymentOf, ratePercentOf } from "@/lib/personal-asset-debt";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// GET /api/loans/summary?year=&month= … 総借入サマリ（ダッシュボードの KPI の対象月の時点。読み取り専用）
//   時点は総資産サマリと同じ（月末、今月なら今日）。その時点で残高のある借入（資産のローンも含む）の、
//   残高（lib/loan-balance.ts）・月々の返済額・金利・完済予定と、その合計を返す。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ user, db, query }) => {
    const now = new Date();
    const year = query.year ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const asOf = isCurrentMonth ? now : new Date(year, month, 0);

    const loans = await db.loan.findMany({
      where: { tenantId: user.tenantId, borrowedOn: { lt: new Date(year, month, 1) } },
      include: {
        repayments: { select: { repaidOn: true, principal: true } },
        personalAsset: { select: { name: true } },
      },
      orderBy: { borrowedOn: "asc" },
    });

    const rows = loans
      .map((l) => {
        const balance = loanBalanceAt(l, asOf);
        // 月々の返済額: 入力した額があればその額、無ければ返済予定から計算した額
        const monthly =
          l.monthlyPayment !== null
            ? Number(l.monthlyPayment)
            : (computeDebtSchedule(
                Number(l.amount),
                l.borrowedOn,
                l.repaymentDate,
                asOf,
                ratePercentOf(Number(l.interestRate)),
                manualMonthlyPaymentOf(l),
                Number(l.residualValue ?? 0),
              )?.monthly ?? 0);
        return {
          id: l.id,
          lenderName: l.lenderName,
          loanType: l.loanType,
          assetName: l.personalAsset?.name ?? null,
          amount: Number(l.amount),
          balance,
          monthlyPayment: balance > 0 ? Math.round(monthly) : 0,
          interestRate: Number(l.interestRate),
          repaymentDate: ymd(l.repaymentDate),
        };
      })
      // その時点で返し終えた借入は出さない
      .filter((r) => r.balance > 0);

    return NextResponse.json({
      data: {
        year,
        month,
        asOf: ymd(asOf),
        isCurrentMonth,
        totalBalance: rows.reduce((s, r) => s + r.balance, 0),
        totalMonthlyPayment: rows.reduce((s, r) => s + r.monthlyPayment, 0),
        totalBorrowed: rows.reduce((s, r) => s + r.amount, 0),
        loans: rows,
      },
    });
  },
});
