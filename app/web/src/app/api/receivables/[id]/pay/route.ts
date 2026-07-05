import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const body = (await req.json()) as { paidOn: string; paidAmount: number; paymentAccountCode?: string };

  if (!body.paidOn || !body.paidAmount) {
    return NextResponse.json({ error: "paidOn and paidAmount are required" }, { status: 400 });
  }

  const receivable = await prisma.receivable.findUnique({ where: { id: Number(id), tenantId } });
  if (!receivable) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (receivable.status === "paid") return NextResponse.json({ error: "already paid" }, { status: 400 });

  const paymentCode = body.paymentAccountCode ?? "1100";
  const [paymentAccount, arAccount] = await Promise.all([
    prisma.account.findFirst({ where: { tenantId, code: paymentCode } }),
    prisma.account.findFirst({ where: { tenantId, code: "1300" } }),
  ]);

  if (!paymentAccount || !arAccount) {
    return NextResponse.json({ error: "勘定科目が見つかりません（1300/入金科目）" }, { status: 500 });
  }

  const paidDate = new Date(body.paidOn);

  await prisma.journalEntry.create({
    data: {
      tenantId,
      transactionDate: paidDate,
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

  const updated = await prisma.receivable.update({
    where: { id: Number(id) },
    data: { status: "paid", paidOn: paidDate, paidAmount: body.paidAmount },
  });

  return NextResponse.json({ data: updated });
}
