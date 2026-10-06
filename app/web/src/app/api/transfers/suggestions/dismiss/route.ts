import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";

// POST /api/transfers/suggestions/dismiss … 「毎月の入出金」の候補を非表示にする（editor 以上）。
//   口座と候補の見分け（signature）を記録し、以後は候補に出さない（どの端末でも）。
export const POST = withApi({
  role: "editor",
  schema: z.object({
    bankAccountId: z.number().int(),
    signature: z.string().min(1).max(500),
  }),
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;
    const account = await db.bankAccount.findFirst({ where: { id: body.bankAccountId, tenantId } });
    if (!account) throw badRequest(`invalid bankAccountId: ${body.bankAccountId}`);
    await db.recurringSuggestionDismissal.upsert({
      where: {
        tenantId_bankAccountId_signature: {
          tenantId,
          bankAccountId: body.bankAccountId,
          signature: body.signature,
        },
      },
      create: { tenantId, bankAccountId: body.bankAccountId, signature: body.signature },
      update: {},
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  },
});
