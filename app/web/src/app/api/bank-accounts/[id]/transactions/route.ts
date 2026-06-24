import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { parseBankCsv } from "@/lib/banktxn-import";

// GET /api/bank-accounts/:id/transactions … 入出金明細（新しい順）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const accountId = Number((await params).id);
  const txns = await prisma.bankTransaction.findMany({
    where: { accountId },
    orderBy: { date: "desc" },
    take: 200,
  });
  return NextResponse.json({
    data: txns.map((t) => ({ ...t, amount: Number(t.amount), balance: t.balance ? Number(t.balance) : null })),
  });
}

// POST /api/bank-accounts/:id/transactions … CSV(text/csv) で入出金明細を取込（editor 以上）
// ヘッダ: date,description,amount[,balance]
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const accountId = Number((await params).id);
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });

  const csv = await req.text();
  if (!csv.trim()) return NextResponse.json({ error: "empty body" }, { status: 400 });

  const { rows, errors } = parseBankCsv(csv, accountId);
  let inserted = 0;
  for (const r of rows) {
    // externalId の重複はスキップ（再取込での二重登録防止）
    const created = await prisma.bankTransaction.upsert({
      where: { accountId_externalId: { accountId, externalId: r.externalId } },
      update: {},
      create: {
        accountId,
        date: new Date(r.date),
        description: r.description,
        amount: r.amount,
        balance: r.balance,
        source: "CSV",
        externalId: r.externalId,
      },
    });
    if (created) inserted++;
  }
  await writeAudit(auth.user.id, "import_txn", `bank_account:${accountId}:${inserted}`);
  return NextResponse.json({ inserted, errors }, { status: errors.length ? 207 : 201 });
}
