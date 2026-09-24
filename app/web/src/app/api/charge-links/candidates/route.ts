import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { DEFAULT_CHARGE_DAY_GAP, rankChargeCandidates } from "@/lib/charge-link";

// GET /api/charge-links/candidates?targetAccountId=&amount=&date=&maxDayGap=&limit=
//
// チャージ（銀行口座・カード → デビット / プリペイド / 電子マネー）を指定するときに、
// チャージ先に入った明細の候補を返す。金額と日付が近いものから並べるだけで確定はせず、
// 実際にどれと対にするかは画面で人が選ぶ（銀行の振替候補と同じ考え方）。
//
// 対象はチャージ先カードの明細のうち、まだ転記もチャージ指定も紐付けもされていないもの。
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

    const rows = await db.cardTransaction.findMany({
      where: {
        accountId: target.id,
        postedRecordId: null,
        chargeGroupId: null,
        transferToAccountId: null,
      },
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        categoryAccountId: true,
        categoryAccount: { select: { id: true, code: true, name: true } },
      },
      orderBy: { date: "desc" },
      // 期間で絞るのは rankChargeCandidates 側（日付のずれ）に任せるが、
      // 明細が数千件ある口座でも重くならないよう直近から適度に打ち切る
      take: 500,
    });

    const ranked = rankChargeCandidates(
      rows.map((r) => ({ ...r, amount: Number(r.amount) })),
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
