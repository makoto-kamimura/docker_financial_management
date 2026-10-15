import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { ScopeQuery } from "@/lib/ledger/scope";
import { buildForms } from "@/lib/tax/forms/build";
import { loadFormContext } from "@/lib/tax/forms/context";

// GET /api/tax-return/forms?year=&scope= … 申告書の転記用 PDF の一覧（保存した入力で、要るかを判定する）
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery.extend({ year: z.coerce.number().int().min(2000).max(2100) }),
  handler: async ({ user, db, query }) => {
    const ctx = await loadFormContext(db, user.tenantId, query.year, {
      sole: query.scope === "business",
    });
    return NextResponse.json({
      data: buildForms(ctx).map(({ key, title, group, needed, why, pages }) => ({
        key,
        title,
        group,
        needed,
        why,
        pageCount: pages.length,
      })),
    });
  },
});
