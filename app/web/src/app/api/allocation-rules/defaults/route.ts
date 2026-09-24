import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { seedDefaultAllocationRulesForTenant } from "@/lib/default-allocation-rules";

const RULE_INCLUDE = { account: { select: { id: true, code: true, name: true } } };

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

    const rules = await db.allocationRule.findMany({
      where: { tenantId },
      include: RULE_INCLUDE,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });

    return NextResponse.json({
      data: rules.map((r) => ({
        id: r.id,
        key: r.key,
        label: r.label,
        group: r.group,
        minPercent: Number(r.minPercent),
        maxPercent: r.maxPercent === null ? null : Number(r.maxPercent),
        note: r.note,
        sortOrder: r.sortOrder,
        account: r.account,
      })),
      created,
    });
  },
});
