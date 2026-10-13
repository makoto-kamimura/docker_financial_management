// Stripe のクライアントと設定。秘密鍵と価格 ID の両方があるときだけ、有料プランを申し込める。
import Stripe from "stripe";
import { Env } from "@/lib/server/config-schema";
import { badGateway, conflict, serviceUnavailable } from "@/lib/server/api-error";

const BillingEnv = Env.pick({
  STRIPE_SECRET_KEY: true,
  STRIPE_WEBHOOK_SECRET: true,
  STRIPE_PRICE_ID: true,
  STRIPE_API_BASE: true,
  APP_ORIGIN: true,
});
export type BillingSettings = ReturnType<typeof BillingEnv.parse>;

// getConfig() は最初の読み込みの値を使い続けるため、課金の設定は呼ぶたびに読む
// （結合テストで、設定がある場合と無い場合を同じプロセスで試せるようにする）
export function billingSettings(): BillingSettings {
  return BillingEnv.parse(process.env);
}

export function billingEnabled(s: BillingSettings = billingSettings()): boolean {
  return Boolean(s.STRIPE_SECRET_KEY && s.STRIPE_PRICE_ID);
}

export const billingDisabled = () =>
  serviceUnavailable(
    "有料プランの申し込みは準備中です。決済の設定が済んでいないため、いまは申し込めません",
    "billing_disabled",
  );

/** Stripe のクライアント（設定が無ければ 503） */
export function stripeClient(s: BillingSettings = billingSettings()): Stripe {
  if (!s.STRIPE_SECRET_KEY) throw billingDisabled();
  if (!s.STRIPE_API_BASE) return new Stripe(s.STRIPE_SECRET_KEY);
  const base = new URL(s.STRIPE_API_BASE);
  return new Stripe(s.STRIPE_SECRET_KEY, {
    host: base.hostname,
    port: base.port || (base.protocol === "https:" ? 443 : 80),
    protocol: base.protocol === "https:" ? "https" : "http",
    maxNetworkRetries: 0,
  });
}

/** Stripe の呼び出しの失敗を、画面に出せるエラーにする */
export function stripeFailed(err: unknown): Error {
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    return conflict("決済の画面を開けませんでした。時間をおいてから、もう一度お試しください");
  }
  console.error("[billing] stripe request failed:", err);
  return badGateway("決済サービスに接続できません。時間をおいてから、もう一度お試しください");
}

/** Stripe のオブジェクトの参照（ID か展開済みのオブジェクト）から ID を取り出す */
export function stripeId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}
