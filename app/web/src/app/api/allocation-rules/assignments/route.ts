import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { loadAllocationRulesView } from "@/lib/allocation-data";
import { isAllocationTarget } from "@/lib/allocation-assign";

const AssignSchema = z.object({
  accountId: z.number().int().positive(),
  // ルール ID = そのルールへ移す / null = 配分に入れない / "auto" = 自動の振り分けに戻す
  ruleId: z.union([z.number().int().positive(), z.null(), z.literal("auto")]),
});

// PUT /api/allocation-rules/assignments … 科目を手で別の配分ルールへ移す・配分から外す・自動に戻す（editor 以上）
//   手で決めた分だけを保存し、それ以外の科目はキーワードと受け皿の区分でその場で振り分ける。
export const PUT = withApi({
  role: "editor",
  schema: AssignSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const account = await db.account.findUnique({
      where: { id: body.accountId, tenantId },
      select: { id: true, code: true, category: true },
    });
    if (!account) throw notFound("科目が見つかりません");
    if (!isAllocationTarget(account.category)) {
      throw badRequest("変動費・固定費・貯蓄の科目だけを配分に入れられます");
    }

    if (body.ruleId === "auto") {
      await db.allocationAccountAssignment.deleteMany({ where: { accountId: account.id } });
    } else {
      if (body.ruleId !== null) {
        const rule = await db.allocationRule.findUnique({
          where: { id: body.ruleId, tenantId },
          select: { id: true },
        });
        if (!rule) throw notFound("配分ルールが見つかりません");
      }
      await db.allocationAccountAssignment.upsert({
        where: { accountId: account.id },
        update: { ruleId: body.ruleId },
        create: { tenantId, accountId: account.id, ruleId: body.ruleId },
      });
    }

    await audit("allocation_assign", `account:${account.code}`, {
      after: { ruleId: body.ruleId },
    });
    const view = await loadAllocationRulesView(db, tenantId);
    return NextResponse.json({ data: view.rules, unassigned: view.unassigned });
  },
});
