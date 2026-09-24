import type { TenantDb } from "@/lib/tenant-db";

// 予算の変更履歴を 1 行積む。実績の FinancialRecordHistory と揃えて
// action は "create" | "update" | "delete"、amount は操作時点の金額を記録する。
//
// 予算は削除されても履歴を残したいので、勘定科目・期間は履歴側に持たせている
// （budgetId は削除時に SET NULL になる）。
export type BudgetHistoryAction = "create" | "update" | "delete";

export async function recordBudgetHistory(
  db: Pick<TenantDb, "budgetHistory">,
  params: {
    tenantId: number;
    budgetId: number | null;
    accountId: number;
    periodId: number;
    /** 操作ユーザー。CSV インポート等のシステム操作は null */
    userId: number | null;
    action: BudgetHistoryAction;
    amount: number;
  },
) {
  await db.budgetHistory.create({
    data: {
      tenantId: params.tenantId,
      budgetId: params.budgetId,
      accountId: params.accountId,
      periodId: params.periodId,
      userId: params.userId,
      action: params.action,
      amount: params.amount,
    },
  });
}
