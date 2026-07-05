import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const status = req.nextUrl.searchParams.get("status");
  const loans = await prisma.loan.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    include: { repayments: { orderBy: { repaidOn: "desc" } } },
    orderBy: { borrowedOn: "desc" },
  });
  return NextResponse.json({ data: loans });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const body = (await req.json()) as {
    lenderName: string;
    amount: number;
    interestRate: number;
    borrowedOn: string;
    repaymentDate: string;
    note?: string;
  };
  if (!body.lenderName || !body.amount || !body.borrowedOn || !body.repaymentDate) {
    return NextResponse.json(
      { error: "lenderName, amount, borrowedOn, repaymentDate are required" },
      { status: 400 },
    );
  }
  const loan = await prisma.loan.create({
    data: {
      tenantId,
      lenderName: body.lenderName,
      amount: body.amount,
      interestRate: body.interestRate ?? 0,
      borrowedOn: new Date(body.borrowedOn),
      repaymentDate: new Date(body.repaymentDate),
      remainingAmount: body.amount,
      note: body.note ?? null,
    },
  });
  return NextResponse.json({ data: loan }, { status: 201 });
}
