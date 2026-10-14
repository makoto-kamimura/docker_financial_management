import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withApi } from "@/lib/server/api-handler";
import { badRequest } from "@/lib/server/api-error";
import { defaultRulesFor, diffRules, validateRuleValue } from "@/lib/shared/tax-rules";
import { rulesPayload } from "@/lib/tax/rules";

const Year = z.coerce.number().int().min(2000).max(2100);

// GET /api/tax-rules?year= … 所得税・住民税の控除額などの値（既定値・上書き・重ねた値）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: Year.optional() }),
  handler: async ({ user, db, query }) => {
    const year = query.year ?? new Date().getFullYear();
    return NextResponse.json({ data: await rulesPayload(db, user.tenantId, year) });
  },
});

// PUT /api/tax-rules … その年の上書きをまとめて置き換える（editor 以上）。
//   既定値と同じ項目は保存しない。既定値の無い年（前年からコピーした年）は全項目をそのまま持つ
export const PUT = withApi({
  role: "editor",
  schema: z.object({ year: Year, values: z.record(z.unknown()) }),
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    for (const [path, v] of Object.entries(body.values)) {
      const err = validateRuleValue(path, v);
      if (err) throw badRequest(`${path}: ${err}`);
    }
    const base = defaultRulesFor(body.year);
    const values = base.fallback ? body.values : diffRules(base.rules, body.values);
    const where = { tenantId_taxYear: { tenantId, taxYear: body.year } };
    if (Object.keys(values).length === 0) {
      await db.taxRuleOverride.deleteMany({ where: { taxYear: body.year } });
    } else {
      const json = values as Prisma.InputJsonValue;
      await db.taxRuleOverride.upsert({
        where,
        update: { values: json },
        create: { tenantId, taxYear: body.year, values: json },
      });
    }
    await audit("update", `tax_rule_override:${body.year}`, { after: values });
    return NextResponse.json({ data: await rulesPayload(db, tenantId, body.year) });
  },
});

// DELETE /api/tax-rules?year= … その年の上書きを消して既定値に戻す（editor 以上）
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ year: Year }),
  handler: async ({ user, db, query, audit }) => {
    await db.taxRuleOverride.deleteMany({ where: { taxYear: query.year } });
    await audit("delete", `tax_rule_override:${query.year}`);
    return NextResponse.json({ data: await rulesPayload(db, user.tenantId, query.year) });
  },
});
