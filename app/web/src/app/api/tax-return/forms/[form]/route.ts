import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { ScopeQuery } from "@/lib/ledger/scope";
import { buildForms, FORM_KEYS, type FormKey } from "@/lib/tax/forms/build";
import { loadFormContext } from "@/lib/tax/forms/context";
import { renderFormsPdf } from "@/lib/tax/forms/pdf";

// GET /api/tax-return/forms/[form]?year=&scope=&download= … 申告書の転記用 PDF
//   download が無ければ inline（ブラウザで確認）、download=1 なら保存用。保存した入力で作る
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery.extend({
    year: z.coerce.number().int().min(2000).max(2100),
    download: z.enum(["0", "1"]).optional(),
  }),
  handler: async ({ user, db, query, params, audit }) => {
    const key = params.form as FormKey;
    if (!(FORM_KEYS as readonly string[]).includes(key)) throw notFound();
    const ctx = await loadFormContext(db, user.tenantId, query.year, {
      sole: query.scope === "business",
    });
    const doc = buildForms(ctx).find((d) => d.key === key)!;
    const bytes = await renderFormsPdf([doc]);
    await audit("tax_form_pdf", `tax_form:${query.year}:${key}`);
    const fileName = `${query.year}_${doc.title}.pdf`;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  },
});
