import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as { paidOn: string; paidAmount: number; paymentAccountCode?: string };

  if (!body.paidOn || !body.paidAmount) {
    return NextResponse.json({ error: "paidOn and paidAmount are required" }, { status: 400 });
  }

  const payable = await db.payable.findUnique({ where: { id: Number(id), tenantId } });
  if (!payable) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (payable.status === "paid") return NextResponse.json({ error: "already paid" }, { status: 400 });

  const paymentCode = body.paymentAccountCode ?? "1100";
  const [paymentAccount, apAccount] = await Promise.all([
    db.account.findFirst({ where: { tenantId, code: paymentCode } }),
    db.account.findFirst({ where: { tenantId, code: "3000" } }),
  ]);

  if (!paymentAccount || !apAccount) {
    return NextResponse.json({ error: "勘定科目が見つかりません（3000/支払科目）" }, { status: 500 });
  }

  const paidDate = new Date(body.paidOn);

  await db.journalEntry.create({
    data: {
      tenantId,
      transactionDate: paidDate,
      description: `${payable.supplierName} 買掛金支払`,
      paymentMethod: paymentCode === "1100" ? "bank" : "cash",
      taxCategory: "non_taxable",
      details: {
        create: [
          { side: "debit", accountId: apAccount.id, amount: body.paidAmount },
          { side: "credit", accountId: paymentAccount.id, amount: body.paidAmount },
        ],
      },
    },
  });

  const updated = await db.payable.update({
    where: { id: Number(id) },
    data: { status: "paid", paidOn: paidDate, paidAmount: body.paidAmount },
  });

  return NextResponse.json({ data: updated });
}
