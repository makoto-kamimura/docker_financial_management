import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const BankAccountSchema = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  branchName: z.string().optional(),
  accountType: z.string().default("普通"),
  role: z.enum(["SALARY", "WITHDRAWAL", "SAVINGS", "OTHER"]).default("OTHER"),
});

// GET /api/bank-accounts … 銀行口座一覧（残高は明細合計から自動計算）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const { tenantId } = user;
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
  },
});

// POST /api/bank-accounts … 銀行口座の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: BankAccountSchema,
  handler: async ({ user, db, body, audit }) => {
    const account = await db.bankAccount.create({ data: { tenantId: user.tenantId, ...body } });
    await audit("create", `bank_account:${account.id}`);
    return NextResponse.json({ data: account }, { status: 201 });
  },
});
