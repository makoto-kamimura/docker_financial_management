import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { parseBankCsv } from "@/lib/banktxn-import";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const accountId = Number((await params).id);
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId, tenantId } });
  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });

  const txns = await prisma.bankTransaction.findMany({
    where: { accountId },
    orderBy: { date: "desc" },
    take: 200,
  });
  return NextResponse.json({
    data: txns.map((t) => ({ ...t, amount: Number(t.amount), balance: t.balance ? Number(t.balance) : null })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const accountId = Number((await params).id);
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId, tenantId } });
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });

  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("application/json")) {
    const body = (await req.json()) as { date: string; description: string; amount: number; balance?: number | null };
    if (!body.date || !body.description || body.amount == null) {
      return NextResponse.json({ error: "date, description, amount は必須です" }, { status: 400 });
    }
    const txn = await prisma.bankTransaction.create({
      data: { accountId, date: new Date(body.date), description: body.description, amount: body.amount, balance: body.balance ?? null, source: "MANUAL" },
    });
    await writeAudit(auth.user.id, "create_txn", `bank_account:${accountId}:${txn.id}`);
    return NextResponse.json({ data: { ...txn, amount: Number(txn.amount), balance: txn.balance ? Number(txn.balance) : null } }, { status: 201 });
  }

  const csv = await req.text();
  if (!csv.trim()) return NextResponse.json({ error: "empty body" }, { status: 400 });

  const { rows, errors } = parseBankCsv(csv, accountId);
  let inserted = 0;
  for (const r of rows) {
    await prisma.bankTransaction.upsert({
      where: { accountId_externalId: { accountId, externalId: r.externalId } },
      update: {},
      create: { accountId, date: new Date(r.date), description: r.description, amount: r.amount, balance: r.balance, source: "CSV", externalId: r.externalId },
    });
    inserted++;
  }
  await writeAudit(auth.user.id, "import_txn", `bank_account:${accountId}:${inserted}`);
  return NextResponse.json({ inserted, errors }, { status: errors.length ? 207 : 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const accountId = Number((await params).id);
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId, tenantId } });
  if (!account) return NextResponse.json({ error: "not found" }, { status: 404 });

  const txnId = Number(req.nextUrl.searchParams.get("txnId"));
  if (!txnId) return NextResponse.json({ error: "txnId が必要です" }, { status: 400 });

  await prisma.bankTransaction.delete({ where: { id: txnId, accountId } });
  await writeAudit(auth.user.id, "delete_txn", `bank_account:${accountId}:${txnId}`);
  return NextResponse.json({ ok: true });
}
