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

// POST /api/receivables/[id]/pay … 売掛金の入金消込（自動仕訳、editor 以上）
export const POST = withApi({
  role: "editor",
  schema: PaySchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;

    const receivable = await db.receivable.findUnique({ where: { id, tenantId } });
    if (!receivable) throw notFound();
    if (receivable.status === "paid") throw badRequest("already paid");

    const paymentCode = body.paymentAccountCode ?? "1100";
    const [paymentAccount, arAccount] = await Promise.all([
      db.account.findFirst({ where: { tenantId, code: paymentCode } }),
      db.account.findFirst({ where: { tenantId, code: "1300" } }),
    ]);

    if (!paymentAccount || !arAccount) {
      throw new ApiError(500, "勘定科目が見つかりません（1300/入金科目）");
    }

    await db.journalEntry.create({
      data: {
        tenantId,
        transactionDate: body.paidOn,
        description: `${receivable.customerName} 売掛金入金`,
        paymentMethod: paymentCode === "1100" ? "bank" : "cash",
        taxCategory: "non_taxable",
        details: {
          create: [
            { side: "debit", accountId: paymentAccount.id, amount: body.paidAmount },
            { side: "credit", accountId: arAccount.id, amount: body.paidAmount },
          ],
        },
      },
    });

    const updated = await db.receivable.update({
      where: { id },
      data: { status: "paid", paidOn: body.paidOn, paidAmount: body.paidAmount },
    });

    return NextResponse.json({ data: updated });
  },
});
