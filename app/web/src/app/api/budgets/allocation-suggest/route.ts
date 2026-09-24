import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { suggestAllocation, type AllocationRule } from "@/lib/allocation";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget-overlay";

// GET /api/budgets/allocation-suggest?year=&month=&basis=budget|actual|manual&amount= … 配分提案（読み取り専用）
//   basis=manual … 実績・予算を一切見ず、amount（画面で入力した収入金額）だけを基準額にする。
//     ローン返済・実物資産の負債分（オーバーレイ）も控除せず、入力値をそのまま割合で振り分ける
//     （「この収入ならどう配分するか」を素の数字で確かめるための計算）。
//   basis=budget / actual … その月の収入（予算 or 実績）からローン等の固定支出を差し引いた
//     「配分可能額」をもとに算出する。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
    basis: z.enum(["budget", "actual", "manual"]).default("manual"),
    amount: z.coerce.number().min(0).optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year, month, basis } = query;

    let basisAmount = 0;
    if (basis === "manual") {
      basisAmount = query.amount ?? 0;
    } else {
      const period = await db.period.findUnique({
        where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
      });
      if (period) {
        if (basis === "budget") {
          const rows = await db.budget.findMany({
            where: { tenantId, periodId: period.id, account: { category: "REVENUE" } },
            select: { amount: true },
          });
          basisAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
        } else {
          const rows = await db.financialRecord.findMany({
            where: { tenantId, periodId: period.id, account: { category: "REVENUE" } },
            select: { amount: true },
          });
          basisAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
        }
      }
    }

    // 手入力は純粋な振り分けなので控除しない（オーバーレイの計算自体を行わない）
    const overlays =
      basis === "manual"
        ? []
        : await (async () => {
            const [loanOverlay, debtOverlay] = await Promise.all([
              computeLoanOverlay(db, tenantId, year),
              computePersonalAssetDebtOverlay(db, tenantId, year),
            ]);
            return [...loanOverlay, ...debtOverlay]
              .filter((o) => o.month === month)
              .map((o) => ({ accountId: o.accountId, amount: o.amount }));
          })();

    const rules = await db.allocationRule.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });

    const ruleInputs: AllocationRule[] = rules.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      group: r.group,
      minPercent: Number(r.minPercent),
      maxPercent: r.maxPercent === null ? null : Number(r.maxPercent),
      accountId: r.accountId,
      sortOrder: r.sortOrder,
    }));

    const result = suggestAllocation({ basisAmount, overlays, rules: ruleInputs });

    return NextResponse.json({ data: { year, month, basis, ...result } });
  },
});
