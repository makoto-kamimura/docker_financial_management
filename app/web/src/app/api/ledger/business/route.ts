import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { badRequest } from "@/lib/server/api-error";
import { confirmedActualsPeriodIds } from "@/lib/budget/budget-lock";
import { UNPAIRED } from "@/lib/ledger/ledger-entries";
import { BusinessInput, loadApportionmentRates, resolveBusiness } from "@/lib/ledger/business-use";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";

// PATCH /api/ledger/business … 明細の事業利用・按分をまとめて変える（editor 以上）。
// 対象は、明細の id の一覧（ids）か、ある月のある科目の明細（year・month・categoryAccountId）。
// 振替・チャージの組と、実績を確定済みの月の明細は変えない（確定済みの月は件数だけ返す）。
// 按分を省略して事業利用にしたときは、明細ごとに科目の事業利用按分の割合（無ければ 100%）にする。
// 学習ルールは変えない（ルールを覚えるのは明細 1 件ずつの科目の割り当て）。
const Schema = BusinessInput.extend({
  businessUse: z.boolean(),
  ids: z.array(z.number().int().positive()).min(1).max(1000).optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
  categoryAccountId: z.number().int().positive().optional(),
});

export const PATCH = withApi({
  role: "editor",
  schema: Schema,
  handler: async ({ user, db, body, audit }) => {
    const byMonth =
      body.year !== undefined && body.month !== undefined && body.categoryAccountId !== undefined;
    if (!body.ids && !byMonth) {
      throw badRequest("ids か、year・month・categoryAccountId を指定してください");
    }
    const rows = await db.financialRecord.findMany({
      where: {
        kind: { not: null },
        ...UNPAIRED,
        ...(body.ids
          ? { id: { in: body.ids } }
          : {
              accountId: body.categoryAccountId,
              date: {
                gte: new Date(body.year!, body.month! - 1, 1),
                lt: new Date(body.year!, body.month!, 1),
              },
            }),
      },
      select: { id: true, accountId: true, periodId: true },
    });
    const locked = await confirmedActualsPeriodIds(
      db,
      rows.map((r) => r.periodId),
    );
    const open = rows.filter((r) => !locked.has(r.periodId));
    const rates =
      body.businessUse && body.businessRatio == null
        ? await loadApportionmentRates(db)
        : new Map<number, number>();

    // 同じ設定になる明細をまとめて更新する（按分の初期値は科目ごとに違う）
    const groups = new Map<string, { setting: object; ids: number[] }>();
    for (const r of open) {
      const setting = resolveBusiness(body, r.accountId, rates)!;
      const key = JSON.stringify(setting);
      const g = groups.get(key) ?? { setting, ids: [] };
      g.ids.push(r.id);
      groups.set(key, g);
    }
    await db.$transaction(async (tx) => {
      for (const { setting, ids } of groups.values()) {
        await tx.financialRecord.updateMany({ where: { id: { in: ids } }, data: setting });
      }
    });

    const result = { updated: open.length, locked: rows.length - open.length };
    await invalidateActualsCaches(user.tenantId);
    await audit("ledger_business_bulk", `financial_records:${open.length}`, {
      after: {
        businessUse: body.businessUse,
        businessRatio: body.businessRatio ?? null,
        ...(body.ids
          ? { ids: open.map((r) => r.id) }
          : { year: body.year, month: body.month, categoryAccountId: body.categoryAccountId }),
      },
    });
    return NextResponse.json({ data: result });
  },
});
