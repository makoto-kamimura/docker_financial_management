import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { suggestAllocation } from "@/lib/budget/allocation";
import { splitByRatio } from "@/lib/shared/allocation-assign";
import { loadActualWeights, loadAllocationContext } from "@/lib/budget/allocation-data";
import { computeLoanOverlay, computePersonalAssetDebtOverlay } from "@/lib/budget/budget-overlay";

// GET /api/budgets/allocation-suggest?year=&month=&basis=budget|actual|manual&amount= … 配分提案（読み取り専用）
//   basis=manual … 実績・予算を一切見ず、amount（画面で入力した収入金額）だけを基準額にする。
//     ローン返済・実物資産の負債分（オーバーレイ）も控除せず、入力値をそのまま割合で振り分ける
//     （「この収入ならどう配分するか」を素の数字で確かめるための計算）。
//   basis=budget / actual … その月の収入（予算 or 実績）からローン等の固定支出を差し引いた
//     「配分可能額」をもとに算出する。
//   各ルールには、メンバー科目（自動の振り分け＋手動の割り当て）と、按分の重み（前の 3 か月の実績）、
//   その月にすでに入っている予算を付けて返す。「予算へ反映」は、予算が未設定の科目だけに
//   残りを按分する（画面で lib/shared/allocation-assign.ts の planAllocationApply を使う）。
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

    const { ruleInputs, members, accounts, assignments } = await loadAllocationContext(
      db,
      tenantId,
    );
    const result = suggestAllocation({ basisAmount, overlays, rules: ruleInputs });

    const allIds = accounts.map((a) => a.id);
    const [weightsFor, period] = await Promise.all([
      loadActualWeights(db, tenantId, allIds, { year, month }, { year, month }),
      db.period.findUnique({
        where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: year, month } },
        select: { id: true },
      }),
    ]);
    const weights = weightsFor(year, month);
    const budgets = period
      ? await db.budget.findMany({
          where: { tenantId, periodId: period.id, accountId: { in: allIds } },
          select: { accountId: true, amount: true },
        })
      : [];
    const budgetById = new Map(budgets.map((b) => [b.accountId, Number(b.amount)]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const sourceById = new Map(assignments.map((a) => [a.accountId, a.source]));

    const items = result.items.map((item) => {
      const ids = members.get(item.rule.id) ?? [];
      const split = splitByRatio(item.recommended, ids, weights);
      return {
        ...item,
        accounts: ids.map((id) => ({
          ...accountById.get(id)!,
          source: sourceById.get(id) ?? "none",
          /** 按分の重み（前の 3 か月の実績の合計） */
          weight: weights.get(id) ?? 0,
          /** 推奨額をこの科目に按分した額 */
          recommended: split.get(id) ?? 0,
          /** その月にすでに入っている予算（null = 未設定） */
          budget: budgetById.has(id) ? budgetById.get(id)! : null,
        })),
      };
    });

    return NextResponse.json({ data: { year, month, basis, ...result, items } });
  },
});
