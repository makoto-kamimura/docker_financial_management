import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { getTenantPlan, graceUntil } from "@/lib/billing/plan";
import { billingEnabled } from "@/lib/billing/stripe";

// GET /api/billing/plan … テナントのプランと契約の状態（設定の「プランと支払い」タブ）
export const GET = withApi({
  role: "viewer",
  handler: async ({ db }) => {
    const { premium, subscription: sub } = await getTenantPlan(db);
    return NextResponse.json({
      data: {
        plan: premium ? "premium" : "free",
        billingEnabled: billingEnabled(),
        subscription: sub && {
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          graceUntil: graceUntil(sub),
          canceledAt: sub.canceledAt,
        },
      },
    });
  },
});
