"use client";

// 設定の「プランと支払い」タブ。有料プランの申し込み（Stripe Checkout）と、
// 支払い方法の変更・解約（Stripe Customer Portal）。契約はテナント単位で、操作できるのは管理者だけ。

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SETTINGS_HELP } from "@/lib/shared/help-texts";
import { PLAN_LABELS, subscriptionStatusText, type PlanInfo } from "@/lib/billing/labels";
import { SaveNotice, SectionCard, type SaveMessage } from "@/components/SectionCard";
import { Notice } from "@/components/ui";

// Checkout から戻った直後は Stripe の通知がまだ届いていないことがあるので、少しのあいだ読み直す
const POLL_INTERVAL_MS = 2000;
const POLL_TIMES = 5;

export function BillingSection() {
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");
  const [polls, setPolls] = useState(0);

  const { data: me } = useQuery({
    queryKey: ["auth-me"],
    queryFn: async (): Promise<{ role: string } | null> => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return (await res.json()).user ?? null;
    },
  });
  const isAdmin = me?.role === "admin";

  const { data: info, refetch } = useQuery({
    queryKey: ["billing-plan"],
    queryFn: async (): Promise<PlanInfo> => (await (await fetch("/api/billing/plan")).json()).data,
  });
  const premium = info?.plan === "premium";

  useEffect(() => {
    if (checkout !== "success" || premium || polls >= POLL_TIMES) return;
    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [checkout, premium, polls, refetch]);

  const [opening, setOpening] = useState(false);
  const [msg, setMsg] = useState<SaveMessage>(null);

  // Stripe の画面（申し込み・支払いの管理）の URL をもらって移る
  async function openStripe(path: "checkout-session" | "portal-session") {
    setOpening(true);
    setMsg(null);
    const res = await fetch(`/api/billing/${path}`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { data?: { url: string }; error?: string };
    if (res.ok && json.data) {
      window.location.href = json.data.url;
      return;
    }
    setOpening(false);
    setMsg({ ok: false, text: json.error ?? "決済の画面を開けませんでした" });
  }

  // 申し込みが済んだ契約（Stripe の契約がある）なら支払いの管理、無ければ申し込み
  const subscribed =
    info?.subscription != null &&
    info.subscription.status !== "INCOMPLETE" &&
    info.subscription.status !== "CANCELED";
  const statusText = subscriptionStatusText(info?.subscription ?? null);

  return (
    <SectionCard
      title="プランと支払い"
      lead={SETTINGS_HELP.billing}
      badge={
        info && (
          <span className={`badge ${premium ? "badge-green" : "badge-slate"}`}>
            {PLAN_LABELS[info.plan]}
          </span>
        )
      }
      actions={
        info?.billingEnabled &&
        isAdmin && (
          <button
            type="button"
            className={subscribed ? "btn-secondary" : "btn-primary"}
            disabled={opening}
            onClick={() => openStripe(subscribed ? "portal-session" : "checkout-session")}
          >
            {opening ? "開いています…" : subscribed ? "支払い方法・解約" : "有料プランにする"}
          </button>
        )
      }
    >
      {checkout === "success" && !premium && polls < POLL_TIMES && (
        <Notice className="mb-3">申し込みを確認しています…</Notice>
      )}
      {checkout === "success" && premium && (
        <Notice tone="success" className="mb-3">
          有料プランの申し込みが完了しました。
        </Notice>
      )}
      {checkout === "success" && !premium && polls >= POLL_TIMES && (
        <Notice className="mb-3">
          申し込みの確認に時間がかかっています。しばらくしてから、このページを開き直してください。
        </Notice>
      )}
      {checkout === "cancel" && <Notice className="mb-3">申し込みを取りやめました。</Notice>}

      {statusText && <p className="text-sm text-slate-700">{statusText}</p>}
      {info && !info.billingEnabled && (
        <p className="text-sm text-slate-500">有料プランの申し込みは準備中です。</p>
      )}
      {info?.billingEnabled && me && !isAdmin && (
        <p className="text-sm text-slate-500">
          プランの申し込みと支払いの管理は、管理者のユーザーが行えます。
        </p>
      )}
      <SaveNotice msg={msg} />
    </SectionCard>
  );
}
