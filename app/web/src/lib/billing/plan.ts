// 有料プランかどうかの判定。契約はテナントに 1 行（subscriptions）で、行が無ければ無料プラン。
import type { Subscription } from "@prisma/client";
import type { TenantDbClient } from "@/lib/server/tenant-db";

/** 支払いに失敗してから、有料プランのまま使える期間 */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

type SubscriptionState = Pick<Subscription, "status" | "pastDueSince">;

/** 支払いに失敗した契約が有料プランでいられる期限（past_due でなければ null） */
export function graceUntil(sub: SubscriptionState): Date | null {
  if (sub.status !== "PAST_DUE" || !sub.pastDueSince) return null;
  return new Date(sub.pastDueSince.getTime() + PAST_DUE_GRACE_MS);
}

/**
 * 有料プランかどうか。active・trialing、または支払いに失敗してから 7 日以内（past_due）。
 * 解約予定（cancelAtPeriodEnd）の契約は、期間の終わりに Stripe が canceled にするまで有料のまま。
 */
export function isPremiumSubscription(sub: SubscriptionState, now: Date = new Date()): boolean {
  switch (sub.status) {
    case "ACTIVE":
    case "TRIALING":
      return true;
    case "PAST_DUE": {
      const until = graceUntil(sub);
      return until === null || now < until;
    }
    default:
      return false;
  }
}

export type TenantPlan = { premium: boolean; subscription: Subscription | null };

/** ログイン中のテナントのプラン（db はテナントで絞り込み済みのクライアント） */
export async function getTenantPlan(
  db: TenantDbClient,
  now: Date = new Date(),
): Promise<TenantPlan> {
  const subscription = await db.subscription.findFirst();
  return {
    premium: subscription !== null && isPremiumSubscription(subscription, now),
    subscription,
  };
}
