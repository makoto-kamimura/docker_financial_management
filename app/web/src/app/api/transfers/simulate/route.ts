import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { simulateBalances, type SimAccount, type SimTransfer } from "@/lib/balance";

const Schema = z.object({
  openings: z.record(z.string(), z.number()).optional(),
  months: z.number().int().min(1).max(24).default(3),
  startYear: z.number().int(),
  startMonth: z.number().int().min(1).max(12),
});

export async function POST(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { openings = {}, months, startYear, startMonth } = parsed.data;

  const bankAccounts = await db.bankAccount.findMany({ where: { tenantId }, orderBy: { id: "asc" } });
  const transfers = await db.transfer.findMany({ where: { tenantId } });

  const accounts: SimAccount[] = bankAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    opening: openings[String(a.id)] ?? 0,
  }));
  const simTransfers: SimTransfer[] = transfers.map((t) => ({
    fromId: t.fromAccountId,
    toId: t.toAccountId,
    amount: Number(t.amount),
    day: t.day,
  }));

  const result = simulateBalances(accounts, simTransfers, { startYear, startMonth, months });

  return NextResponse.json({
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    ...result,
  });
}
