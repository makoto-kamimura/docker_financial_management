import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const BankAccountSchema = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  branchName: z.string().optional(),
  accountType: z.string().default("普通"),
  role: z.enum(["SALARY", "WITHDRAWAL", "SAVINGS", "OTHER"]).default("OTHER"),
});

export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const [accounts, balances] = await Promise.all([
    db.bankAccount.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
      include: { _count: { select: { transactions: true } } },
    }),
    db.bankTransaction.groupBy({
      by: ["accountId"],
      _sum: { amount: true },
      where: { account: { tenantId } },
    }),
  ]);

  const balanceMap = new Map(balances.map((b) => [b.accountId, b._sum.amount?.toNumber() ?? 0]));

  return NextResponse.json({
    data: accounts.map((a) => ({ ...a, balance: balanceMap.get(a.id) ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = BankAccountSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const account = await db.bankAccount.create({ data: { tenantId, ...parsed.data } });
  await writeAudit(auth.user.id, "create", `bank_account:${account.id}`);
  return NextResponse.json({ data: account }, { status: 201 });
}
