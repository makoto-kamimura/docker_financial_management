import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withApi } from "@/lib/server/api-handler";
import { copyRulesFromPreviousYear } from "@/lib/shared/tax-rules";
import { loadOverride, rulesPayload } from "@/lib/tax/rules";

// POST /api/tax-rules/copy … 前年の値（既定値＋上書き）をその年の上書きとして作る（editor 以上）。
//   既定値がまだ無い来年の分を、改正された箇所だけ直して使うための下書き
export const POST = withApi({
  role: "editor",
  schema: z.object({ year: z.number().int().min(2000).max(2100) }),
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const values = copyRulesFromPreviousYear(
      body.year,
      await loadOverride(db, tenantId, body.year - 1),
    ) as Prisma.InputJsonValue;
    await db.taxRuleOverride.upsert({
      where: { tenantId_taxYear: { tenantId, taxYear: body.year } },
      update: { values },
      create: { tenantId, taxYear: body.year, values },
    });
    await audit("create", `tax_rule_override:${body.year}`, {
      after: { copiedFrom: body.year - 1 },
    });
    return NextResponse.json({ data: await rulesPayload(db, tenantId, body.year) });
  },
});
