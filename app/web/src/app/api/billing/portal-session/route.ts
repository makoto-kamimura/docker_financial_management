import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { appOrigin, createPortalSession } from "@/lib/billing/checkout";

// POST /api/billing/portal-session … 支払い方法の変更・解約の画面（Stripe Customer Portal）の URL（管理者のみ）
export const POST = withApi({
  role: "admin",
  handler: async ({ req, user, db, audit }) => {
    const url = await createPortalSession(db, appOrigin(req.nextUrl.origin));
    await audit("billing_portal", `tenant:${user.tenantId}`);
    return NextResponse.json({ data: { url } });
  },
});
