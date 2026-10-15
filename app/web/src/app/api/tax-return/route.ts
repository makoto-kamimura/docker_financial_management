import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withApi } from "@/lib/server/api-handler";
import { ScopeQuery } from "@/lib/ledger/scope";
import { TaxInputsSchema } from "@/lib/tax/inputs";
import { loadTaxReturn } from "@/lib/tax/load";

const Year = z.coerce.number().int().min(2000).max(2100);

// GET /api/tax-return?year=&scope= … 控除・確定申告のページ（帳簿の年合計・入力・制度の値・見込み）
//   scope=business（個人事業主モード）は事業所得を決算の数字から下書きする
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery.extend({ year: Year.optional() }),
  handler: async ({ user, db, query }) => {
    const year = query.year ?? new Date().getFullYear();
    return NextResponse.json({
      data: await loadTaxReturn(db, user.tenantId, year, { sole: query.scope === "business" }),
    });
  },
});

// PUT /api/tax-return … その年の入力を保存する（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: z.object({ year: Year, inputs: TaxInputsSchema }),
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const inputs = body.inputs as unknown as Prisma.InputJsonValue;
    const row = await db.taxReturnInput.upsert({
      where: { tenantId_taxYear: { tenantId, taxYear: body.year } },
      update: { inputs },
      create: { tenantId, taxYear: body.year, inputs },
    });
    await audit("update", `tax_return_input:${body.year}`);
    return NextResponse.json({ data: { year: row.taxYear, inputs: body.inputs } });
  },
});
