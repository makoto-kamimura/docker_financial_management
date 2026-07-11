import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/loans/:id … 借入条件の編集（支払い完了年月・月々の返済額・連携科目 等）
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const existing = await db.loan.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as Partial<{
    lenderName: string;
    interestRate: number;
    repaymentDate: string; // 支払い完了年月
    note: string | null;
    loanType: string;
    linkedAccountCode: string | null;
    monthlyPayment: number | null;
  }>;

  let linkedAccountId: number | null | undefined = undefined;
  if (body.linkedAccountCode !== undefined) {
    if (body.linkedAccountCode === null) {
      linkedAccountId = null;
    } else {
      const account = await db.account.findUnique({
        where: { tenantId_code: { tenantId, code: body.linkedAccountCode } },
      });
      if (!account) {
        return NextResponse.json(
          { error: `unknown linkedAccountCode: ${body.linkedAccountCode}` },
          { status: 400 },
        );
      }
      linkedAccountId = account.id;
    }
  }

  const loan = await db.loan.update({
    where: { id: Number(id) },
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
}
