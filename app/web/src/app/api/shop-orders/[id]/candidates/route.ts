import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { UNPAIRED } from "@/lib/ledger/ledger-entries";
import { rankCandidates } from "@/lib/ledger/shop-link-core";
import { chargeYmd, LINK_ENTRY_SELECT, toLinkEntry } from "@/lib/ledger/shop-link";

// GET /api/shop-orders/[id]/candidates?maxDayGap=&limit= … 明細分けの請求を手で紐付けるときの、明細の候補。
//   請求日の前後 maxDayGap 日の、銀行・カードの出金の明細（振替・チャージ・ほかの請求の紐付け先・
//   実績を確定済みの月の明細を除く）を、金額の差 → 摘要のキーワード → 日付の差の順に並べる
//   （lib/ledger/shop-link-core.ts の rankCandidates）。キーワードに当たらない明細も出す
//   （楽天市場の出店者の名前など、摘要が揺れる明細があるため）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    maxDayGap: z.coerce.number().int().min(0).max(60).default(14),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  handler: async ({ db, id, query }) => {
    const charge = await db.shopCharge.findUnique({
      where: { id },
      select: {
        id: true,
        shopAccountId: true,
        date: true,
        amount: true,
        shopAccount: {
          select: {
            id: true,
            type: true,
            matchKeywords: true,
            excludeKeywords: true,
            paymentCardIds: true,
            paymentBankIds: true,
          },
        },
      },
    });
    if (!charge) throw notFound("注文が見つかりません");

    const DAY = 86_400_000;
    const at = charge.date.getTime();
    const rows = await db.financialRecord.findMany({
      where: {
        kind: { in: ["BANK", "CARD"] },
        flow: { lt: 0 },
        ...UNPAIRED,
        period: { actualsConfirmation: { is: null } },
        date: {
          gte: new Date(at - (query.maxDayGap + 1) * DAY),
          lt: new Date(at + (query.maxDayGap + 2) * DAY),
        },
      },
      select: {
        ...LINK_ENTRY_SELECT,
        bankAccount: { select: { name: true } },
        cardAccount: { select: { name: true } },
        account: { select: { id: true, code: true, name: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ranked = rankCandidates(
      {
        id: charge.id,
        shopAccountId: charge.shopAccountId,
        ymd: chargeYmd(charge.date),
        amount: Number(charge.amount),
      },
      rows.map(toLinkEntry),
      charge.shopAccount,
    ).filter((c) => Math.abs(c.dayGap) <= query.maxDayGap);

    return NextResponse.json({
      data: ranked.slice(0, query.limit).map((c) => {
        const r = byId.get(c.id)!;
        return {
          id: c.id,
          kind: c.kind,
          date: c.ymd,
          description: c.description,
          /** +入金 / −出金 */
          amount: c.flow,
          sourceName: r.bankAccount?.name ?? r.cardAccount?.name ?? "",
          /** いま付いている科目（紐付けると外れる） */
          categoryAccount: r.account,
          dayGap: c.dayGap,
          amountGap: c.amountGap,
          keywordMatch: c.keywordMatch,
        };
      }),
    });
  },
});
