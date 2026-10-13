import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/server/api-error";
import { handleStripeWebhook } from "@/lib/billing/webhook";

// POST /api/webhooks/stripe … Stripe からの通知（契約の開始・更新・解約、支払いの失敗）。
// ログインは無く、Stripe-Signature の署名で送り主を確かめる（lib/billing/webhook.ts）。
// 署名は受け取ったままのボディで検証するため、JSON として読まずに文字列で渡す。
// Cookie の無いリクエストなので、CSRF の検査（middleware.ts）では止まらない。
export async function POST(req: NextRequest) {
  try {
    await handleStripeWebhook(await req.text(), req.headers.get("stripe-signature"));
    return NextResponse.json({ received: true });
  } catch (e) {
    return errorResponse(e);
  }
}
