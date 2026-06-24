import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

// POST /api/payables/[id]/pay — 支払処理
// body: { paidOn, paidAmount, paymentAccountCode? }
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = await req.json() as {
    paidOn: string;
    paidAmount: number;
    paymentAccountCode?: string; // "1100" 普通預金 or "1000" 現金
  };

  if (!body.paidOn || !body.paidAmount) {
    return NextResponse.json({ error: "paidOn and paidAmount are required" }, { status: 400 });
  }

  const payable = await prisma.payable.findUnique({ where: { id: Number(id) } });
  if (!payable) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (payable.status === "paid") {
    return NextResponse.json({ error: "already paid" }, { status: 400 });
  }

  const paymentCode = body.paymentAccountCode ?? "1100";
  const [paymentAccount, apAccount] = await Promise.all([
    prisma.account.findFirst({ where: { code: paymentCode } }),
    prisma.account.findFirst({ where: { code: "3000" } }),
  ]);

  if (!paymentAccount || !apAccount) {
    return NextResponse.json({ error: "勘定科目が見つかりません（3000/支払科目）" }, { status: 500 });
  }

  const paidDate = new Date(body.paidOn);

  // 仕訳自動作成: DR 買掛金 / CR 普通預金/現金
  await prisma.journalEntry.create({
    data: {
      transactionDate: paidDate,
      description:     `${payable.supplierName} 買掛金支払`,
      paymentMethod:   paymentCode === "1100" ? "bank" : "cash",
      taxCategory:     "non_taxable",
      details: {
        create: [
          { side: "debit",  accountId: apAccount.id,      amount: body.paidAmount },
          { side: "credit", accountId: paymentAccount.id, amount: body.paidAmount },
        ],
      },
    },
  });

  const updated = await prisma.payable.update({
    where: { id: Number(id) },
    data: {
      status:    "paid",
      paidOn:    paidDate,
      paidAmount: body.paidAmount,
    },
  });

  return NextResponse.json({ data: updated });
}
