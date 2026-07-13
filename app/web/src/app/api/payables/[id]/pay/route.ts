import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { zDate } from "@/lib/zod-helpers";
import { AP_ACCOUNT_CODE, createSettlementJournal } from "@/lib/settlement";

const PaySchema = z.object({
  paidOn: zDate,
  paidAmount: z.number().positive(),
  paymentAccountCode: z.string().optional(),
});

// POST /api/payables/[id]/pay … 買掛金の支払消込（自動仕訳、editor 以上）
export const POST = withApi({
  role: "editor",
  schema: PaySchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;

    const payable = await db.payable.findUnique({ where: { id, tenantId } });
    if (!payable) throw notFound();
    if (payable.status === "paid") throw badRequest("already paid");

    await createSettlementJournal(db, tenantId, {
      paidOn: body.paidOn,
      amount: body.paidAmount,
      paymentAccountCode: body.paymentAccountCode,
      counterAccountCode: AP_ACCOUNT_CODE,
      description: `${payable.supplierName} 買掛金支払`,
      direction: "payment",
      missingAccountsMessage: "勘定科目が見つかりません（3000/支払科目）",
    });

    const updated = await db.payable.update({
      where: { id },
      data: { status: "paid", paidOn: body.paidOn, paidAmount: body.paidAmount },
    });

    return NextResponse.json({ data: updated });
  },
});
