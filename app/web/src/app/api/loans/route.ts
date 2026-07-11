import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const status = req.nextUrl.searchParams.get("status");
  const loans = await db.loan.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    include: {
      repayments: { orderBy: { repaidOn: "desc" } },
      linkedAccount: { select: { id: true, code: true, name: true } },
    },
    orderBy: { borrowedOn: "desc" },
  });
  return NextResponse.json({ data: loans });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    lenderName: string;
    amount: number;
    interestRate: number;
    borrowedOn: string;
    repaymentDate: string;
    note?: string;
    loanType?: string;
    linkedAccountCode?: string;
    monthlyPayment?: number;
  };
  if (!body.lenderName || !body.amount || !body.borrowedOn || !body.repaymentDate) {
    return NextResponse.json(
      { error: "lenderName, amount, borrowedOn, repaymentDate are required" },
      { status: 400 },
    );
  }

  let linkedAccountId: number | null = null;
  if (body.linkedAccountCode) {
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

  const loan = await db.loan.create({
    data: {
      tenantId,
      lenderName: body.lenderName,
      amount: body.amount,
      interestRate: body.interestRate ?? 0,
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
  return NextResponse.json({ data: loan }, { status: 201 });
}
