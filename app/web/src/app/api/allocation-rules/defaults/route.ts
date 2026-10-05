import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { seedDefaultAllocationRulesForTenant } from "@/lib/default-allocation-rules";
import { loadAllocationRulesView } from "@/lib/allocation-data";

// POST /api/allocation-rules/defaults
//   … ファイナンシャルプランナー推奨の既定配分ルールを投入する（editor 以上）。
//     既に同じ key のルールがあるテナントでは何もしないため、ユーザーの編集は上書きされない。
//     テナント作成前から使っている環境でも「既定ルールを読み込む」で追従できるようにするための入口。
export const POST = withApi({
  role: "editor",
  handler: async ({ user, db, audit }) => {
    const { tenantId } = user;
    const created = await prisma.$transaction((tx) =>
      seedDefaultAllocationRulesForTenant(tx, tenantId),
    );
    await audit("create", `allocation-rules:defaults:${created}`);

    const view = await loadAllocationRulesView(db, tenantId);
    return NextResponse.json({ data: view.rules, unassigned: view.unassigned, created });
  },
});
