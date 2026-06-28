import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const BankAccountSchema = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  branchName: z.string().optional(),
  accountType: z.string().default("普通"),
  role: z.enum(["SALARY", "WITHDRAWAL", "SAVINGS", "OTHER"]).default("OTHER"),
});

// GET /api/bank-accounts … 銀行口座一覧（残高はトランザクション合計から算出）
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const [accounts, balances] = await Promise.all([
    prisma.bankAccount.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { transactions: true } } },
    }),
    prisma.bankTransaction.groupBy({
      by: ["accountId"],
      _sum: { amount: true },
    }),
  ]);

  const balanceMap = new Map(balances.map((b) => [b.accountId, b._sum.amount?.toNumber() ?? 0]));

  return NextResponse.json({
    data: accounts.map((a) => ({ ...a, balance: balanceMap.get(a.id) ?? 0 })),
  });
}

// POST /api/bank-accounts … 銀行口座の登録（editor 以上）
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = BankAccountSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const account = await prisma.bankAccount.create({ data: parsed.data });
  await writeAudit(auth.user.id, "create", `bank_account:${account.id}`);
  return NextResponse.json({ data: account }, { status: 201 });
}
