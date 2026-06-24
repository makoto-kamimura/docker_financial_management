import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { getBankSyncProvider } from "@/lib/banksync";

// POST /api/bank-accounts/:id/sync … アグリゲーションプロバイダから入出金を自動取得する（editor 以上）。
// NOTE: 既定はモックプロバイダ。実銀行接続は lib/banksync.ts のプロバイダを差し替える。
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const accountId = Number((await params).id);
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });

  const provider = getBankSyncProvider();
  const fetched = await provider.fetchTransactions({ id: account.id, bankName: account.bankName });

  let inserted = 0;
  for (const t of fetched) {
    await prisma.bankTransaction.upsert({
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
  await writeAudit(auth.user.id, "sync_txn", `bank_account:${accountId}:${provider.name}:${inserted}`);
  return NextResponse.json({ provider: provider.name, fetched: fetched.length });
}
