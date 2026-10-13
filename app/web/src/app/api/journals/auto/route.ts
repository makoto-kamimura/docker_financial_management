import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { loadAutoBook } from "@/lib/accounting/auto-journal-data";

// GET /api/journals/auto?year=&month= … 実績から作った仕訳（個人事業主モードの仕訳帳。閲覧だけ）
//   年度は暦年。番号は年度の通し番号のまま、month を指定するとその月の仕訳だけを返す。
//   作り方は lib/accounting/auto-journal.ts。skippedJournals は含めなかった仕訳（損益の科目を含むが実績に入っていないもの）。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ user, db, query }) => {
    const book = await loadAutoBook(db, user.tenantId, query.year);
    const prefix = `${query.year}-${String(query.month).padStart(2, "0")}-`;
    const journals = query.month
      ? book.journals.filter((j) => j.date.startsWith(prefix))
      : book.journals;
    return NextResponse.json({
      data: journals.map((j) => ({
        ...j,
        lines: j.lines.map((l) => ({ ...l, account: book.accounts.get(l.key)! })),
      })),
      total: journals.length,
      skippedJournals: book.skippedJournals,
    });
  },
});
