import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { requireAccountByCode } from "@/lib/period";
import { buildBankBalanceMap } from "@/lib/bank-balance";
import { invalidateCache } from "@/lib/redis";

const BankAccountSchema = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  branchName: z.string().optional(),
  accountType: z.string().default("普通"),
  role: z.enum(["SALARY", "WITHDRAWAL", "SAVINGS", "OTHER"]).default("OTHER"),
  lastFour: z.string().max(4).optional(),
  accountCode: z.string().optional(),
  note: z.string().optional(),
});

// GET /api/bank-accounts … 銀行口座一覧（残高は「明細合計 + 差額」= lib/bank-balance.ts の定義）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const { tenantId } = user;
    const [accounts, balances] = await Promise.all([
      db.bankAccount.findMany({
        where: { tenantId },
        orderBy: { id: "asc" },
        include: {
          _count: { select: { transactions: true } },
          account: { select: { id: true, code: true, name: true, category: true } },
        },
      }),
      db.bankTransaction.groupBy({
        by: ["accountId"],
        _sum: { amount: true },
        // 最終更新日時（取込・手入力した日時）と、明細上の最新取引日をサマリに出す
        _max: { createdAt: true, date: true },
        where: { account: { tenantId } },
      }),
    ]);

    const transactionSumMap = new Map(
      balances.map((b) => [b.accountId, b._sum.amount?.toNumber() ?? 0]),
    );
    const lastUpdatedMap = new Map(balances.map((b) => [b.accountId, b._max.createdAt ?? null]));
    const lastTransactionDateMap = new Map(balances.map((b) => [b.accountId, b._max.date ?? null]));
    const balanceMap = buildBankBalanceMap(
      accounts,
      balances.map((b) => ({ accountId: b.accountId, sum: b._sum.amount?.toNumber() ?? 0 })),
    );

    return NextResponse.json({
      data: accounts.map((a) => ({
        ...a,
        balance: balanceMap.get(a.id) ?? 0,
        // 明細合計だけの残高も返す（編集画面で差額の入力を案内するために使う）
        transactionSum: transactionSumMap.get(a.id) ?? 0,
        balanceAdjustment: Number(a.balanceAdjustment),
        // 明細を最後に登録（CSV 取込・手入力）した日時。明細が 1 件も無ければ口座の登録日時
        lastUpdatedAt: lastUpdatedMap.get(a.id) ?? a.createdAt,
        // 明細上の最新の取引日（「どこまで取り込めているか」の目安）
        lastTransactionDate: lastTransactionDateMap.get(a.id) ?? null,
      })),
    });
  },
});

// POST /api/bank-accounts … 銀行口座の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: BankAccountSchema,
  handler: async ({ user, db, body, audit }) => {
    const { accountCode, ...fields } = body;
    const { tenantId } = user;

    let accountId: number | undefined;
    if (accountCode) {
      const acct = await requireAccountByCode(db, tenantId, accountCode);
      accountId = acct.id;
    }

    const account = await db.bankAccount.create({ data: { tenantId, ...fields, accountId } });
    await audit("create", `bank_account:${account.id}`);
    await invalidateCache(`assets:summary:${tenantId}:*`);
    return NextResponse.json({ data: account }, { status: 201 });
  },
});
