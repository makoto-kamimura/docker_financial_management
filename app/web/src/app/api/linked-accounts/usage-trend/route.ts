import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { shiftYm, trendMonths, ym } from "@/lib/balance-trend";
import { buildCardUsageTrend } from "@/lib/card-usage";
import { CARD, cardSpend } from "@/lib/ledger-entries";

// GET /api/linked-accounts/usage-trend?before=12&after=6 … カード・電子マネー管理のサマリ「利用額の推移」。
//   今月の前後の月ごとの利用額を、カードごとと合計で返す（計算は lib/card-usage.ts）。
//   過去は明細のある月からにする（最大 before か月前）。先の月は固定決済の合計で見込む。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    before: z.coerce.number().int().min(0).max(36).default(12),
    after: z.coerce.number().int().min(0).max(24).default(6),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const currentKey = ym(year, month);
    const earliest = shiftYm(year, month, -query.before);

    const [cards, txns, recurring] = await Promise.all([
      db.linkedAccount.findMany({
        where: { tenantId },
        orderBy: { id: "asc" },
        select: { id: true, name: true },
      }),
      db.financialRecord.findMany({
        where: { ...CARD },
        select: {
          cardAccountId: true,
          date: true,
          flow: true,
          chargeToCardId: true,
          chargeGroupId: true,
        },
      }),
      db.cardRecurringPayment.findMany({
        where: { tenantId },
        select: { accountId: true, amount: true },
      }),
    ]);

    const rows = txns.map((t) => ({
      accountId: t.cardAccountId!,
      month: ym(t.date!.getUTCFullYear(), t.date!.getUTCMonth() + 1),
      amount: cardSpend(t.flow),
      transferToAccountId: t.chargeToCardId,
      chargeGroupId: t.chargeGroupId,
    }));
    const recurringMonthly = new Map<number, number>();
    for (const r of recurring) {
      recurringMonthly.set(
        r.accountId,
        (recurringMonthly.get(r.accountId) ?? 0) + Number(r.amount),
      );
    }

    // 過去は明細のある最初の月から（最大 before か月前。明細が無ければ今月から）
    const firstKey = rows.reduce<string | null>(
      (min, r) => (min === null || r.month < min ? r.month : min),
      null,
    );
    const start = firstKey === null ? currentKey : firstKey > earliest ? firstKey : earliest;
    const [sy, sm] = start.split("-").map(Number);
    const before = Math.max((year - sy) * 12 + (month - sm), 0);
    const months = trendMonths(year, month, before, query.after);

    const trend = buildCardUsageTrend({
      cardIds: cards.map((c) => c.id),
      txns: rows,
      recurringMonthly,
      months,
      currentKey,
    });

    return NextResponse.json({
      months,
      currentKey,
      total: trend.total,
      cards: cards.map((c) => ({ id: c.id, name: c.name, values: trend.cards.get(c.id) ?? [] })),
    });
  },
});
