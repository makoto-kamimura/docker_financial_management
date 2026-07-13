import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { findAccountByCode } from "@/lib/period";

const UpdateSchema = z.object({
  lenderName: z.string().min(1).optional(),
  interestRate: z.number().min(0).optional(),
  repaymentDate: z.string().min(1).optional(), // 支払い完了年月
  note: z.string().nullable().optional(),
  loanType: z.string().optional(),
  linkedAccountCode: z.string().nullable().optional(),
  monthlyPayment: z.number().nullable().optional(),
});

// PATCH /api/loans/[id] … 借入条件の編集（支払い完了年月・月々の返済額・連携科目 等）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;
    const existing = await db.loan.findUnique({ where: { id, tenantId } });
    if (!existing) throw notFound();

    let linkedAccountId: number | null | undefined = undefined;
    if (body.linkedAccountCode !== undefined) {
      if (body.linkedAccountCode === null) {
        linkedAccountId = null;
      } else {
        const account = await findAccountByCode(db, tenantId, body.linkedAccountCode);
        if (!account) throw badRequest(`unknown linkedAccountCode: ${body.linkedAccountCode}`);
        linkedAccountId = account.id;
      }
    }

    const loan = await db.loan.update({
      where: { id },
      data: {
        ...(body.lenderName !== undefined && { lenderName: body.lenderName }),
        ...(body.interestRate !== undefined && { interestRate: body.interestRate }),
        ...(body.repaymentDate !== undefined && { repaymentDate: new Date(body.repaymentDate) }),
        ...(body.note !== undefined && { note: body.note }),
        ...(body.loanType !== undefined && { loanType: body.loanType }),
        ...(linkedAccountId !== undefined && { linkedAccountId }),
        ...(body.monthlyPayment !== undefined && { monthlyPayment: body.monthlyPayment }),
      },
      include: {
        repayments: { orderBy: { repaidOn: "desc" } },
        linkedAccount: { select: { id: true, code: true, name: true } },
      },
    });
    return NextResponse.json({ data: loan });
  },
});
