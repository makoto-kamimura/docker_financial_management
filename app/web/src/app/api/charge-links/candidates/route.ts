import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { DEFAULT_CHARGE_DAY_GAP, rankChargeCandidates } from "@/lib/ledger/charge-link";
import { CARD, cardSpend } from "@/lib/ledger/ledger-entries";

// GET /api/charge-links/candidates?targetAccountId=&amount=&date=&maxDayGap=&limit=
//
// チャージ（銀行口座・カード → デビット / プリペイド / 電子マネー）を指定するときに、
// チャージ先に入った明細の候補を返す。金額と日付が近いものから並べるだけで確定はせず、
// 実際にどれと対にするかは画面で人が選ぶ（銀行の振替候補と同じ考え方）。
//
// 対象はチャージ先カードの明細のうち、まだチャージ指定も紐付けもされておらず、実績を確定済みの月でないもの。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    targetAccountId: z.coerce.number().int().positive(),
    /** チャージ元の明細の金額（符号は問わない。絶対値で突き合わせる） */
    amount: z.coerce.number(),
    /** チャージ元の明細の日付（YYYY-MM-DD） */
    date: z.string().min(1),
    maxDayGap: z.coerce.number().int().min(0).max(62).default(DEFAULT_CHARGE_DAY_GAP),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  handler: async ({ user, db, query }) => {
    const target = await db.linkedAccount.findUnique({
      where: { id: query.targetAccountId, tenantId: user.tenantId },
      select: { id: true, name: true, type: true },
    });
    if (!target) throw notFound("チャージ先のカードが見つかりません");

    const chargeDate = new Date(query.date);
    if (Number.isNaN(chargeDate.getTime())) throw notFound("日付が不正です");
    // 日付のずれの範囲で先に絞る（明細が多いカードでも、古い日付の候補が件数の上限で落ちないように）。
    // 時刻の扱いの違いで日がずれないよう前後 1 日広く読み、正確な日数は rankChargeCandidates で絞る
    const DAY = 86_400_000;
    const dateRange = {
      gte: new Date(chargeDate.getTime() - (query.maxDayGap + 1) * DAY),
      lt: new Date(chargeDate.getTime() + (query.maxDayGap + 2) * DAY),
    };

    const rows = await db.financialRecord.findMany({
      where: {
        ...CARD,
        cardAccountId: target.id,
        date: dateRange,
        // 対にすると科目が外れて実績から抜けるので、実績を確定済みの月の明細は出さない
        period: { actualsConfirmation: { is: null } },
        chargeGroupId: null,
        chargeToCardId: null,
      },
      select: {
        id: true,
        date: true,
        description: true,
        flow: true,
        accountId: true,
        account: { select: { id: true, code: true, name: true } },
      },
      orderBy: { date: "desc" },
      // 日付の範囲で絞ってあるので、ふつうは当たらない保険の上限
      take: 500,
    });

    const ranked = rankChargeCandidates(
      // 候補の照合はカードの符号（+利用 / −入金）で行う
      rows.map((r) => ({
        id: r.id,
        date: r.date!,
        description: r.description!,
        amount: cardSpend(r.flow),
        categoryAccountId: r.accountId,
        categoryAccount: r.account,
      })),
      { amount: query.amount, date: chargeDate },
      { maxDayGap: query.maxDayGap },
    );

    return NextResponse.json({
      target,
      maxDayGap: query.maxDayGap,
      total: ranked.length,
      data: ranked.slice(0, query.limit).map((c) => ({
        id: c.txn.id,
        date: c.txn.date,
        description: c.txn.description,
        amount: c.txn.amount,
        // 科目が付いたまま紐付けると外れるので、画面で知らせる
        categoryAccount: c.txn.categoryAccount,
        dayGap: c.dayGap,
        amountMatch: c.amountMatch,
        incoming: c.incoming,
      })),
    });
  },
});
