import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { ApiError, badRequest, notFound } from "@/lib/api-error";
import { zDate } from "@/lib/zod-helpers";

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

    const paymentCode = body.paymentAccountCode ?? "1100";
    const [paymentAccount, apAccount] = await Promise.all([
      db.account.findFirst({ where: { tenantId, code: paymentCode } }),
      db.account.findFirst({ where: { tenantId, code: "3000" } }),
    ]);

    if (!paymentAccount || !apAccount) {
      throw new ApiError(500, "勘定科目が見つかりません（3000/支払科目）");
    }

    await db.journalEntry.create({
      data: {
        tenantId,
        transactionDate: body.paidOn,
        description: `${payable.supplierName} 買掛金支払`,
        paymentMethod: paymentCode === "1100" ? "bank" : "cash",
        taxCategory: "non_taxable",
        details: {
          create: [
            { side: "debit", accountId: apAccount.id, amount: body.paidAmount },
            { side: "credit", accountId: paymentAccount.id, amount: body.paidAmount },
          ],
        },
      },
    });

    const updated = await db.payable.update({
      where: { id },
      data: { status: "paid", paidOn: body.paidOn, paidAmount: body.paidAmount },
    });

    return NextResponse.json({ data: updated });
  },
});
