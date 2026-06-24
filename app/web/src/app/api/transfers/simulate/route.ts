import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { simulateBalances, type SimAccount, type SimTransfer } from "@/lib/balance";

const Schema = z.object({
  // 口座ごとの期首残高（未指定の口座は 0）
  openings: z.record(z.string(), z.number()).optional(),
  months: z.number().int().min(1).max(24).default(3),
  startYear: z.number().int(),
  startMonth: z.number().int().min(1).max(12),
});

// POST /api/transfers/simulate … 期首残高と登録済みの資金移動から残高推移をシミュレートする。
export async function POST(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { openings = {}, months, startYear, startMonth } = parsed.data;

  const bankAccounts = await prisma.bankAccount.findMany({ orderBy: { id: "asc" } });
  const transfers = await prisma.transfer.findMany();

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
