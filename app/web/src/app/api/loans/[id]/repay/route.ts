import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const body = (await req.json()) as { repaidOn: string; principal: number; interest: number };
  if (!body.repaidOn || body.principal === undefined) {
    return NextResponse.json({ error: "repaidOn and principal are required" }, { status: 400 });
  }

  const loan = await prisma.loan.findUnique({ where: { id: Number(id), tenantId } });
  if (!loan) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (loan.status === "repaid") return NextResponse.json({ error: "already repaid" }, { status: 400 });

  const principal = body.principal;
  const interest = body.interest ?? 0;
  const newRemaining = Number(loan.remainingAmount) - principal;

  const repayment = await prisma.$transaction(async (tx) => {
    const r = await tx.loanRepayment.create({
      data: { loanId: Number(id), repaidOn: new Date(body.repaidOn), principal, interest, totalAmount: principal + interest },
    });
    await tx.loan.update({
      where: { id: Number(id) },
      data: { remainingAmount: newRemaining < 0 ? 0 : newRemaining, status: newRemaining <= 0 ? "repaid" : "active" },
    });
    return r;
  });

  return NextResponse.json({ data: repayment }, { status: 201 });
}
