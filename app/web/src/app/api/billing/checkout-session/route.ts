import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { prisma } from "@/lib/server/prisma";
import { appOrigin, createCheckoutSession } from "@/lib/billing/checkout";

// POST /api/billing/checkout-session … 有料プランの申し込みの画面（Stripe Checkout）の URL（管理者のみ）
export const POST = withApi({
  role: "admin",
  handler: async ({ req, user, db, audit }) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { name: true },
    });
    const url = await createCheckoutSession(db, user, tenant.name, appOrigin(req.nextUrl.origin));
    await audit("billing_checkout", `tenant:${user.tenantId}`);
    return NextResponse.json({ data: { url } });
  },
});
