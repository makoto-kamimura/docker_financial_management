import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";

// GET /api/periods/years … 対象年度の候補（左のメニューの年度切替が使う）。
//   予算か実績のある年（periods.fiscalYear）と今年を、新しい順に返す。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const rows = await db.period.findMany({
      where: { tenantId: user.tenantId },
      select: { fiscalYear: true },
      distinct: ["fiscalYear"],
    });
    const years = new Set(rows.map((r) => r.fiscalYear));
    years.add(new Date().getFullYear());
    return NextResponse.json({ data: [...years].sort((a, b) => b - a) });
  },
});
