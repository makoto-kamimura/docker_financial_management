// 有料プランの申し込み（Stripe Checkout）と、支払い方法の変更・解約（Stripe Customer Portal）。
// 契約はテナント単位。申し込むのはテナントの管理者（admin）。
import { conflict } from "@/lib/server/api-error";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import {
  billingDisabled,
  billingEnabled,
  billingSettings,
  stripeClient,
  stripeFailed,
} from "@/lib/billing/stripe";
import { isPremiumSubscription } from "@/lib/billing/plan";

/** 申し込み・支払い管理の画面から戻る先（設定の「プランと支払い」タブ） */
export const BILLING_PAGE_PATH = "/settings?tab=billing";

type Admin = { tenantId: number; email: string };

/**
 * 有料プランの申し込みの画面（Stripe Checkout）の URL を返す。
 * Stripe の顧客がまだなければ作り、契約の行を入れる（申し込みが済むまでは INCOMPLETE）。
 */
export async function createCheckoutSession(
  db: TenantDbClient,
  admin: Admin,
  tenantName: string,
  origin: string,
): Promise<string> {
  const settings = billingSettings();
  if (!billingEnabled(settings)) throw billingDisabled();
  const stripe = stripeClient(settings);

  let sub = await db.subscription.findFirst();
  if (sub && isPremiumSubscription(sub)) {
    throw conflict(
      "すでに有料プランです。支払い方法の変更や解約は「支払い方法・解約」から行ってください",
    );
  }
  const tenantId = String(admin.tenantId);
  if (!sub) {
    let customerId: string;
    try {
      const customer = await stripe.customers.create({
        email: admin.email,
        name: tenantName,
        metadata: { tenant_id: tenantId },
      });
      customerId = customer.id;
    } catch (e) {
      throw stripeFailed(e);
    }
    sub = await db.subscription.create({
      data: { tenantId: admin.tenantId, stripeCustomerId: customerId },
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: sub.stripeCustomerId,
      client_reference_id: tenantId,
      line_items: [{ price: settings.STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: { metadata: { tenant_id: tenantId } },
      success_url: `${origin}${BILLING_PAGE_PATH}&checkout=success`,
      cancel_url: `${origin}${BILLING_PAGE_PATH}&checkout=cancel`,
      locale: "ja",
    });
    if (!session.url) throw new Error("checkout session has no url");
    return session.url;
  } catch (e) {
    throw stripeFailed(e);
  }
}

/** 支払い方法の変更・解約の画面（Stripe Customer Portal）の URL を返す */
export async function createPortalSession(db: TenantDbClient, origin: string): Promise<string> {
  const settings = billingSettings();
  if (!billingEnabled(settings)) throw billingDisabled();

  const sub = await db.subscription.findFirst();
  if (!sub?.stripeSubscriptionId) throw conflict("有料プランの申し込みがありません");
  try {
    const session = await stripeClient(settings).billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${origin}${BILLING_PAGE_PATH}`,
      locale: "ja",
    });
    return session.url;
  } catch (e) {
    throw stripeFailed(e);
  }
}

/** 決済の画面から戻ってくる先のオリジン（公開 URL があればそちら） */
export function appOrigin(requestOrigin: string): string {
  return billingSettings().APP_ORIGIN ?? requestOrigin;
}
