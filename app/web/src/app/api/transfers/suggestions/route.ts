import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { loanFundingTransfers } from "@/lib/loan-funding";
import { dismissKey, findRecurringCandidates } from "@/lib/recurring-suggestions";

// GET /api/transfers/suggestions … 明細から見つけた「毎月の入出金」の候補（読み取り専用）
//   資金移動ルールとして登録すると、資金繰り・資金フロー図に入る。判定は lib/recurring-suggestions.ts。
//   振替（口座間の組）・チャージにした明細は見ない。すでに近い資金移動ルールや、引き落とし口座を入れた借入の
//   返済があるもの、非表示にしたものは出さない。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const { tenantId } = user;
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 6, 1);

    const [accounts, txns, transfers, loans, dismissals] = await Promise.all([
      db.bankAccount.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      db.financialRecord.findMany({
        where: {
          kind: "BANK",
          date: { gte: since },
          transferGroupId: null,
          chargeToCardId: null,
          chargeGroupId: null,
        },
        select: { bankAccountId: true, date: true, description: true, flow: true },
      }),
      db.transfer.findMany({ where: { tenantId } }),
      db.loan.findMany({ where: { tenantId, debitBankAccountId: { not: null } } }),
      db.recurringSuggestionDismissal.findMany({ where: { tenantId } }),
    ]);

    const rules = transfers.map((t) => ({
      fromId: t.fromAccountId,
      toId: t.toAccountId,
      amount: Number(t.amount),
      day: t.day,
    }));
    // 借入の返済（自動で資金繰りに入るもの）も、ルールがあるものとして扱う
    const loanRules = loanFundingTransfers(loans, rules).transfers.map((t) => ({
      fromId: t.fromId,
      toId: null,
      amount: t.amount,
      day: t.day,
    }));
    const candidates = findRecurringCandidates(
      txns.map((t) => ({
        accountId: t.bankAccountId!,
        date: t.date!,
        description: t.description!,
        amount: Number(t.flow),
      })),
      [...rules, ...loanRules],
      new Set(dismissals.map((d) => dismissKey(d.bankAccountId, d.signature))),
      now,
    );
    const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
    return NextResponse.json({
      data: candidates.map((c) => ({ ...c, accountName: nameOf.get(c.accountId) ?? "" })),
    });
  },
});
