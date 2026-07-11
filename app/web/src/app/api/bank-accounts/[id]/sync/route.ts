import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { getBankSyncProvider } from "@/lib/banksync";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const accountId = Number((await params).id);
  const account = await db.bankAccount.findUnique({ where: { id: accountId, tenantId } });
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });

  const provider = getBankSyncProvider();
  const fetched = await provider.fetchTransactions({ id: account.id, bankName: account.bankName });

  let inserted = 0;
  for (const t of fetched) {
    await db.bankTransaction.upsert({
      where: { accountId_externalId: { accountId, externalId: t.externalId } },
      update: {},
      create: {
        accountId,
        date: new Date(t.date),
        description: t.description,
        amount: t.amount,
        balance: t.balance,
        source: "SYNC",
        externalId: t.externalId,
      },
    });
    inserted++;
  }
  await writeAudit(
    auth.user.id,
    "sync_txn",
    `bank_account:${accountId}:${provider.name}:${inserted}`,
  );
  return NextResponse.json({ provider: provider.name, fetched: fetched.length });
}
