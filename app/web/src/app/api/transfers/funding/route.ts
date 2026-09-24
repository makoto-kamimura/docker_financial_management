import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { computeFundingPlans, type FundingAccount, type FundingTransfer } from "@/lib/funding-plan";
import { CHANNEL_LABELS, type TransferChannel } from "@/lib/transferflow";
import { buildBankBalanceMap } from "@/lib/bank-balance";

// GET /api/transfers/funding?year=&month=&months=
// 資金繰り（必要残高と入金期限）。各口座の現在残高を起点に、資金移動ルールから
// 先々の入出金を並べ、残高不足になる日と必要な追加入金額を算出する。
// 期首残高の手入力とシミュレーション実行ボタンは廃止し、常に現在残高を起点とする。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
    months: z.coerce.number().int().min(1).max(12).default(3),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year, month, months } = query;

    // 起点残高は口座一覧と同じ定義（明細合計 + 差額 = 現在残高。lib/bank-balance.ts）
    const [bankAccounts, balances, transfers] = await Promise.all([
      db.bankAccount.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
      db.bankTransaction.groupBy({
        by: ["accountId"],
        _sum: { amount: true },
        where: { account: { tenantId } },
      }),
      db.transfer.findMany({ where: { tenantId } }),
    ]);
    const balanceMap = buildBankBalanceMap(
      bankAccounts,
      balances.map((b) => ({ accountId: b.accountId, sum: b._sum.amount?.toNumber() ?? 0 })),
    );

    const accounts: FundingAccount[] = bankAccounts.map((a) => ({
      id: a.id,
      name: a.name,
      opening: balanceMap.get(a.id) ?? 0,
    }));
    const fundingTransfers: FundingTransfer[] = transfers.map((t) => ({
      fromId: t.fromAccountId,
      toId: t.toAccountId,
      amount: Number(t.amount),
      day: t.day,
      label: t.label ?? CHANNEL_LABELS[t.channel as TransferChannel] ?? null,
    }));

    const plans = computeFundingPlans(accounts, fundingTransfers, {
      startYear: year,
      startMonth: month,
      months,
    });

    return NextResponse.json({
      year,
      month,
      months,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, opening: a.opening })),
      plans,
    });
  },
});
