import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import {
  buildBalanceTrend,
  buildDailyBalanceTrend,
  trendDates,
  trendMonths,
  ym,
  ymd,
} from "@/lib/balance-trend";

// GET /api/bank-accounts/balance-trend?year=&month=&before=6&after=6&granularity=month|day
//   … 口座残高の推移。対象年月の前後 N か月を月次（既定）または日次で返す。
//     実績のある期間は明細の増減を累積した残高、それ以降は資金移動ルールから
//     推測した残高を返す（estimated=true）。月次は月次純増減、日次は予定日ごとに適用する。
//
// 残高の定義は口座サマリ（GET /api/bank-accounts の balance）と同じく
// 「明細の増減合計 + 差額（BankAccount.balanceAdjustment）」（lib/bank-balance.ts）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
    before: z.coerce.number().int().min(0).max(24).default(6),
    after: z.coerce.number().int().min(0).max(24).default(6),
    granularity: z.enum(["month", "day"]).default("month"),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { year, month, before, after, granularity } = query;

    const [bankAccounts, txns, transfers] = await Promise.all([
      db.bankAccount.findMany({
        where: { tenantId },
        orderBy: { id: "asc" },
        select: { id: true, name: true, balanceAdjustment: true },
      }),
      db.bankTransaction.findMany({
        where: { account: { tenantId } },
        select: { accountId: true, date: true, amount: true },
      }),
      db.transfer.findMany({
        where: { tenantId },
        select: { fromAccountId: true, toAccountId: true, amount: true, day: true },
      }),
    ]);

    // 口座 × 月ごとの増減合計（実績）
    const monthlyNet = new Map<number, Map<string, number>>();
    for (const t of txns) {
      const key = ym(t.date.getUTCFullYear(), t.date.getUTCMonth() + 1);
      const perAccount = monthlyNet.get(t.accountId) ?? new Map<string, number>();
      perAccount.set(key, (perAccount.get(key) ?? 0) + Number(t.amount));
      monthlyNet.set(t.accountId, perAccount);
    }

    // 資金移動ルールから求めた 1 か月あたりの純増減（将来の推測に使う）
    const recurringNet = new Map<number, number>();
    for (const t of transfers) {
      const amount = Math.abs(Number(t.amount));
      if (t.fromAccountId !== null) {
        recurringNet.set(t.fromAccountId, (recurringNet.get(t.fromAccountId) ?? 0) - amount);
      }
      if (t.toAccountId !== null) {
        recurringNet.set(t.toAccountId, (recurringNet.get(t.toAccountId) ?? 0) + amount);
      }
    }

    // 実績と推測の境目は「今日」。対象年月が未来でも、実績がある所までは実線で見せる。
    const today = new Date();
    const actualThroughMonth = ym(today.getFullYear(), today.getMonth() + 1);
    const actualThroughDate = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());
    const accountIds = bankAccounts.map((a) => a.id);
    // 口座サマリと残高の定義を揃える（明細合計 + 差額）
    const adjustments = new Map(bankAccounts.map((a) => [a.id, Number(a.balanceAdjustment)]));

    if (granularity === "day") {
      // 日次は「その日の増減合計」を積み上げる。月次と違い、将来分は
      // 資金移動ルールを予定日ごとに適用するので月の途中の上下も見える。
      const dailyNet = new Map<number, Map<string, number>>();
      for (const t of txns) {
        const key = ymd(t.date.getUTCFullYear(), t.date.getUTCMonth() + 1, t.date.getUTCDate());
        const perAccount = dailyNet.get(t.accountId) ?? new Map<string, number>();
        perAccount.set(key, (perAccount.get(key) ?? 0) + Number(t.amount));
        dailyNet.set(t.accountId, perAccount);
      }

      const points = buildDailyBalanceTrend({
        accountIds,
        dailyNet,
        recurring: transfers.map((t) => ({
          fromId: t.fromAccountId,
          toId: t.toAccountId,
          amount: Number(t.amount),
          day: t.day,
        })),
        dates: trendDates(year, month, before, after),
        actualThroughDate,
        adjustments,
      });

      return NextResponse.json({
        year,
        month,
        granularity,
        actualThroughDate,
        accounts: bankAccounts.map((a) => ({ id: a.id, name: a.name })),
        points,
      });
    }

    const points = buildBalanceTrend({
      accountIds,
      monthlyNet,
      recurringNet,
      months: trendMonths(year, month, before, after),
      actualThroughMonth,
      adjustments,
    });

    return NextResponse.json({
      year,
      month,
      granularity,
      actualThroughMonth,
      accounts: bankAccounts.map((a) => ({ id: a.id, name: a.name })),
      points,
    });
  },
});
