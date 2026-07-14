import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { findAccountByCode } from "@/lib/period";
import { invalidateCache } from "@/lib/redis";

const LoanSchema = z.object({
  lenderName: z.string().min(1),
  amount: z.number().positive(),
  interestRate: z.number().min(0).default(0),
  borrowedOn: z.string().min(1),
  repaymentDate: z.string().min(1),
  note: z.string().optional(),
  loanType: z.string().optional(),
  linkedAccountCode: z.string().optional(),
  monthlyPayment: z.number().optional(),
});

// GET /api/loans?status=active … 借入金一覧
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ status: z.string().optional() }),
  handler: async ({ user, db, query }) => {
    const loans = await db.loan.findMany({
      where: { tenantId: user.tenantId, ...(query.status ? { status: query.status } : {}) },
      include: {
        repayments: { orderBy: { repaidOn: "desc" } },
        linkedAccount: { select: { id: true, code: true, name: true } },
      },
      orderBy: { borrowedOn: "desc" },
    });
    return NextResponse.json({ data: loans });
  },
});

// POST /api/loans … 借入金の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: LoanSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    let linkedAccountId: number | null = null;
    if (body.linkedAccountCode) {
      const account = await findAccountByCode(db, tenantId, body.linkedAccountCode);
      if (!account) throw badRequest(`unknown linkedAccountCode: ${body.linkedAccountCode}`);
      linkedAccountId = account.id;
    }

    const loan = await db.loan.create({
      data: {
        tenantId,
        lenderName: body.lenderName,
        amount: body.amount,
        interestRate: body.interestRate,
        borrowedOn: new Date(body.borrowedOn),
        repaymentDate: new Date(body.repaymentDate),
        remainingAmount: body.amount,
        note: body.note ?? null,
        loanType: body.loanType ?? "business",
        linkedAccountId,
        monthlyPayment: body.monthlyPayment ?? null,
      },
      include: { linkedAccount: { select: { id: true, code: true, name: true } } },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);
    return NextResponse.json({ data: loan }, { status: 201 });
  },
});
