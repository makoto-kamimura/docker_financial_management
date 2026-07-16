import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { getSessionDetail } from "@/lib/account-conversion";

// GET /api/account-conversion/history/[id] … 変換セッションの詳細
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, id }) => {
    const detail = await getSessionDetail(id, user.tenantId, user.id);
    if (!detail) throw notFound();
    return NextResponse.json({ data: detail });
  },
});
