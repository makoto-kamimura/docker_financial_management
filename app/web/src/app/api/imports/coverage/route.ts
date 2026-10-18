import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { BANK, CARD } from "@/lib/ledger/ledger-entries";

// GET /api/imports/coverage?target=bank|card&accountId= … 口座・カードの、CSV の取り込みと自動取得で入った明細の
//   いちばん新しい日付（lastDate、YYYY-MM-DD。まだ無ければ null）。実績管理の取り込みで「前回はこの日まで」と出し、
//   次に落とす明細の期間の目安にする（手入力の明細は数えない）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    target: z.enum(["bank", "card"]),
    accountId: z.coerce.number().int().positive(),
  }),
  handler: async ({ db, query }) => {
    const account =
      query.target === "bank"
        ? { ...BANK, bankAccountId: query.accountId }
        : { ...CARD, cardAccountId: query.accountId };
    const { _max } = await db.financialRecord.aggregate({
      where: { ...account, source: { in: ["CSV", "SYNC"] } },
      _max: { date: true },
    });
    return NextResponse.json({ lastDate: _max.date?.toISOString().slice(0, 10) ?? null });
  },
});
