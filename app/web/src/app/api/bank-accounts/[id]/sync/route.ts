import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { getBankSyncProvider } from "@/lib/banksync";
import { upsertExternalTransactions } from "@/lib/bank-transactions";

// POST /api/bank-accounts/[id]/sync … アグリゲーション自動同期（既定モック）
export const POST = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const account = await db.bankAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound("account not found");

    const provider = getBankSyncProvider();
    const fetched = await provider.fetchTransactions({
      id: account.id,
      bankName: account.bankName,
    });

    const inserted = await upsertExternalTransactions(db, id, fetched, "SYNC");
    await audit("sync_txn", `bank_account:${id}:${provider.name}:${inserted}`);
    return NextResponse.json({ provider: provider.name, fetched: fetched.length });
  },
});
