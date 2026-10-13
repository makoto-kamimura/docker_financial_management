// Stripe からの通知（Webhook）を検証して、契約（subscriptions）に反映する。
// 通知はテナントの外から届くので、テナントで絞り込まないクライアント（prisma）を使う。
// 同じ通知は二度処理しない（stripe_webhook_events）。
import Stripe from "stripe";
import { Prisma, type Subscription, type SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { badRequest } from "@/lib/server/api-error";
import { billingDisabled, billingSettings, stripeId } from "@/lib/billing/stripe";

type Tx = Prisma.TransactionClient;

/** Stripe の契約の状態を subscriptions.status にする */
export function subscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "incomplete":
      return "INCOMPLETE";
    default: // canceled・unpaid・incomplete_expired・paused は有料プランとして扱わない
      return "CANCELED";
  }
}

/**
 * 通知を検証して反映する。署名が正しくなければ 400、Webhook の鍵が無ければ 503。
 * 処理済みの通知なら何もしない（Stripe は同じ通知を送り直すことがある）。
 */
export async function handleStripeWebhook(payload: string, signature: string | null) {
  const secret = billingSettings().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw billingDisabled();

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(payload, signature ?? "", secret);
  } catch {
    throw badRequest("署名を確認できません");
  }
  const at = new Date(event.created * 1000);

  await prisma.$transaction(async (tx) => {
    const recorded = await tx.stripeWebhookEvent.createMany({
      data: [{ eventId: event.id, eventType: event.type }],
      skipDuplicates: true,
    });
    if (recorded.count === 0) return; // 処理済み

    switch (event.type) {
      case "checkout.session.completed":
        return applyCheckoutCompleted(tx, event.data.object);
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return applySubscription(
          tx,
          event.data.object,
          at,
          event.type === "customer.subscription.deleted",
        );
      case "invoice.payment_failed":
        return applyPaymentFailed(tx, event.data.object, at);
    }
  });
}

/** Stripe の顧客の契約の行をロックして読む（同じ顧客の通知が同時に届いても順に反映する） */
async function lockSubscription(tx: Tx, customerId: string | null): Promise<Subscription | null> {
  if (!customerId) return null;
  const rows = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "subscriptions" WHERE "stripeCustomerId" = ${customerId} FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.subscription.findUnique({ where: { id: rows[0].id } });
}

async function applyCheckoutCompleted(tx: Tx, cs: Stripe.Checkout.Session) {
  const sub = await lockSubscription(tx, stripeId(cs.customer));
  const subscriptionId = stripeId(cs.subscription);
  if (!sub || !subscriptionId) return;

  // 契約の通知（customer.subscription.*）が先に届いていれば、そちらの状態を残す
  let status = sub.status;
  if (status === "INCOMPLETE" || status === "CANCELED") {
    status =
      cs.payment_status === "paid" || cs.payment_status === "no_payment_required"
        ? "ACTIVE"
        : "INCOMPLETE";
  }
  await tx.subscription.update({
    where: { id: sub.id },
    data: { stripeSubscriptionId: subscriptionId, status, canceledAt: null },
  });
}

async function applySubscription(tx: Tx, st: Stripe.Subscription, at: Date, deleted: boolean) {
  const customerId = stripeId(st.customer);
  let sub = await lockSubscription(tx, customerId);
  if (!sub) {
    // 申し込みの画面を経ずに Stripe の画面で作った契約など：メタデータのテナントに結び付ける
    sub = await createForMetadataTenant(tx, customerId, st.metadata?.tenant_id);
    if (!sub) {
      console.warn("[billing] stripe subscription for unknown customer:", st.id);
      return;
    }
  }

  const status = deleted ? "CANCELED" : subscriptionStatus(st.status);
  const periodEnd = st.items?.data?.[0]?.current_period_end;
  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      stripeSubscriptionId: st.id,
      status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: st.cancel_at_period_end && status !== "CANCELED",
      // 支払いに失敗した日時は、past_due の間は最初の日時を残す（7 日間の猶予の起点）
      pastDueSince: status === "PAST_DUE" ? (sub.pastDueSince ?? at) : null,
      canceledAt:
        status === "CANCELED" ? (st.canceled_at ? new Date(st.canceled_at * 1000) : at) : null,
    },
  });
}

async function createForMetadataTenant(
  tx: Tx,
  customerId: string | null,
  tenantIdText: string | undefined,
): Promise<Subscription | null> {
  const tenantId = Number(tenantIdText);
  if (!customerId || !Number.isInteger(tenantId) || tenantId <= 0) return null;
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, subscription: { select: { id: true } } },
  });
  // 別の顧客の契約がすでにあるテナントには結び付けない（二重の契約を上書きしない）
  if (!tenant || tenant.subscription) return null;
  return tx.subscription.create({ data: { tenantId, stripeCustomerId: customerId } });
}

async function applyPaymentFailed(tx: Tx, inv: Stripe.Invoice, at: Date) {
  const sub = await lockSubscription(tx, stripeId(inv.customer));
  if (!sub || sub.pastDueSince) return;
  // 状態は customer.subscription.updated で past_due になる。ここでは猶予の起点だけを記録する
  await tx.subscription.update({ where: { id: sub.id }, data: { pastDueSince: at } });
}
