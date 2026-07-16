import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { invalidateCache } from "@/lib/redis";

const RepaySchema = z.object({
  repaidOn: z.string().min(1),
  principal: z.number().min(0),
  interest: z.number().min(0).default(0),
});

// POST /api/loans/[id]/repay … 返済記録の登録と残高更新（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: RepaySchema,
  handler: async ({ user, db, id, body }) => {
    const loan = await db.loan.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!loan) throw notFound();
    if (loan.status === "repaid") throw badRequest("already repaid");

    const { principal, interest } = body;
    const newRemaining = Number(loan.remainingAmount) - principal;

    const repayment = await db.$transaction(async (tx) => {
      const r = await tx.loanRepayment.create({
        data: {
          loanId: id,
          repaidOn: new Date(body.repaidOn),
          principal,
          interest,
          totalAmount: principal + interest,
        },
      });
      await tx.loan.update({
        where: { id },
        data: {
          remainingAmount: newRemaining < 0 ? 0 : newRemaining,
          status: newRemaining <= 0 ? "repaid" : "active",
        },
      });
      return r;
    });

    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ data: repayment }, { status: 201 });
  },
});
