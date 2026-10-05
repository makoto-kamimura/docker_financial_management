import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { loadLastActualsConfirmed } from "@/lib/cycle-status";

// GET /api/cycle-status/latest … 最後に実績を確定した月（読み取り専用）。
//   予実差確認・予算の確定・実績の確定の画面が、開いたときの対象月を決めるのに使う（lib/cycle-month.ts）。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const lastActualsConfirmed = await loadLastActualsConfirmed(db, user.tenantId);
    return NextResponse.json({ data: { lastActualsConfirmed } });
  },
});
