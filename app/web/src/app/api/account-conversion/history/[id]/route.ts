import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { getSessionDetail } from "@/lib/accounting/account-conversion";

// GET /api/account-conversion/history/[id] … 変換セッションの詳細
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, id }) => {
    const detail = await getSessionDetail(id, user.tenantId, user.id);
    if (!detail) throw notFound();
    return NextResponse.json({ data: detail });
  },
});
