import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { zDate } from "@/lib/zod-helpers";
import { AR_ACCOUNT_CODE, createSettlementJournal } from "@/lib/settlement";

const PaySchema = z.object({
  paidOn: zDate,
  paidAmount: z.number().positive(),
  paymentAccountCode: z.string().optional(),
});

// POST /api/receivables/[id]/pay … 売掛金の入金消込（自動仕訳、editor 以上）
// D-3: 請求書から自動生成された売掛金（invoiceId あり）の場合、リンク先の Invoice も paid に揃える
export const POST = withApi({
  role: "editor",
  schema: PaySchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;

    const receivable = await db.receivable.findUnique({ where: { id, tenantId } });
    if (!receivable) throw notFound();
    if (receivable.status === "paid") throw badRequest("already paid");

    await createSettlementJournal(db, tenantId, {
      paidOn: body.paidOn,
      amount: body.paidAmount,
      paymentAccountCode: body.paymentAccountCode,
      counterAccountCode: AR_ACCOUNT_CODE,
      description: `${receivable.customerName} 売掛金入金`,
      direction: "receipt",
      missingAccountsMessage: "勘定科目が見つかりません（1300/入金科目）",
    });

    const updated = await db.$transaction(async (tx) => {
      const r = await tx.receivable.update({
        where: { id },
        data: { status: "paid", paidOn: body.paidOn, paidAmount: body.paidAmount },
      });
      if (receivable.invoiceId) {
        await tx.invoice.update({ where: { id: receivable.invoiceId }, data: { status: "paid" } });
      }
      return r;
    });

    return NextResponse.json({ data: updated });
  },
});
