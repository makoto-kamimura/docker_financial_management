import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { loadCycleStatus } from "@/lib/cycle-status";

// GET /api/cycle-status?year=&month= … 月ごとの流れ（① 予算確定 → ② 実績確定 → ③ 翌月の予算確定）の
//   状況と、実績の入力状況（明細の最終日）を返す（読み取り専用）。
//   ダッシュボードの状況の 1 行と、実績管理の「実績の確定」タブが使う。
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
  }),
  handler: async ({ user, db, query }) => {
    const { status } = await loadCycleStatus(db, user.tenantId, query.year, query.month);
    return NextResponse.json({ data: status });
  },
});
