// 有料プランの画面に出す文言（クライアントからも使うため、サーバー専用のモジュールを import しない）。
import type { SubscriptionStatus } from "@prisma/client";

/** GET /api/billing/plan の data */
export type PlanInfo = {
  plan: "free" | "premium";
  billingEnabled: boolean;
  subscription: {
    status: SubscriptionStatus;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    graceUntil: string | null;
    canceledAt: string | null;
  } | null;
};

export const PLAN_LABELS: Record<PlanInfo["plan"], string> = {
  free: "無料プラン",
  premium: "有料プラン",
};

const dateText = (iso: string) => new Date(iso).toLocaleDateString("ja-JP");

/** 契約の状態の説明（契約が無ければ null） */
export function subscriptionStatusText(sub: PlanInfo["subscription"]): string | null {
  if (!sub) return null;
  switch (sub.status) {
    case "ACTIVE":
    case "TRIALING": {
      const head = sub.status === "TRIALING" ? "お試し期間中です" : "契約中です";
      if (!sub.currentPeriodEnd) return head;
      return sub.cancelAtPeriodEnd
        ? `${head}。${dateText(sub.currentPeriodEnd)} に解約されます`
        : `${head}。次の更新日は ${dateText(sub.currentPeriodEnd)} です`;
    }
    case "PAST_DUE":
      return sub.graceUntil
        ? `支払いに失敗しました。${dateText(sub.graceUntil)} までに支払い方法を更新してください`
        : "支払いに失敗しました。支払い方法を更新してください";
    case "INCOMPLETE":
      return "申し込みが済んでいません";
    case "CANCELED":
      return sub.canceledAt ? `${dateText(sub.canceledAt)} に解約しました` : "解約しました";
  }
}
