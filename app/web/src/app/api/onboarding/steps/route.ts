import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";

// GET /api/onboarding/steps … F-10 ステップ進捗チェックリスト用データ。
// モード切替経験（ステップ6）は client 側の localStorage 由来のため含まない。
export const GET = withApi({
  role: "viewer",
  handler: async ({ db }) => {
    const [incomeBudget, expenseBudget, bankAccountCount, personalAssetCount, loanCount] =
      await Promise.all([
        db.budget.findFirst({ where: { account: { category: "REVENUE" } }, select: { id: true } }),
        db.budget.findFirst({
          where: { account: { category: { in: ["EXPENSE", "COGS"] } } },
          select: { id: true },
        }),
        db.bankAccount.count(),
        db.personalAsset.count(),
        db.loan.count(),
      ]);

    return NextResponse.json({
      data: {
        hasIncomeBudget: incomeBudget !== null,
        hasExpenseBudget: expenseBudget !== null,
        hasBankAccount: bankAccountCount > 0,
        hasPersonalAsset: personalAssetCount > 0,
        hasLoan: loanCount > 0,
      },
    });
  },
});
