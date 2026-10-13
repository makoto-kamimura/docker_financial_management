import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { prisma } from "@/lib/server/prisma";
import { seedDefaultAllocationRulesForTenant } from "@/lib/budget/default-allocation-rules";
import { loadAllocationRulesView } from "@/lib/budget/allocation-data";
import { ScopeQuery } from "@/lib/ledger/scope";
import { budgetScopeOf } from "@/lib/budget/budget-scope";

// POST /api/allocation-rules/defaults
//   … ファイナンシャルプランナー推奨の既定配分ルールを投入する（editor 以上）。
//     既に同じ key のルールがあるテナントでは何もしないため、ユーザーの編集は上書きされない。
//     テナント作成前から使っている環境でも「既定ルールを読み込む」で追従できるようにするための入口。
//     ?scope=business は事業の予算の既定ルール。
export const POST = withApi({
  role: "editor",
  querySchema: ScopeQuery,
  handler: async ({ user, db, query, audit }) => {
    const { tenantId } = user;
    const scope = budgetScopeOf(query.scope);
    const created = await prisma.$transaction((tx) =>
      seedDefaultAllocationRulesForTenant(tx, tenantId, [scope]),
    );
    await audit("create", `allocation-rules:defaults:${created}`, { after: { scope } });

    const view = await loadAllocationRulesView(db, tenantId, scope);
    return NextResponse.json({ data: view.rules, unassigned: view.unassigned, created });
  },
});
