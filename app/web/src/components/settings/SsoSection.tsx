"use client";

// 設定の「セキュリティ」タブの SSO の欄: 共通の認証サーバーとの連携・解除と「SSO だけでログインする」。
// 仕様は docker_auth_server の docs/runbooks/app-integration.md。

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SaveNotice, SectionCard, type SaveMessage } from "@/components/SectionCard";
import { SSO_COPY, ssoErrorMessage } from "@/lib/shared/sso-copy";

type Identities = {
  sso_enabled: boolean;
  sso_name: string | null;
  can_link: boolean;
  identities: { provider: string; email: string | null }[];
  sso_only: boolean;
  login_method: "pwd" | "sso";
};

export function SsoSection() {
  const qc = useQueryClient();
  const { data: ids } = useQuery({
    queryKey: ["sso-identities"],
    queryFn: async (): Promise<Identities | null> => {
      const res = await fetch("/api/me/identities");
      return res.ok ? res.json() : null;
    },
  });
  const [msg, setMsg] = useState<SaveMessage>(null);
  const [busy, setBusy] = useState(false);

  // 連携から戻ってきたとき（?sso=linked / ?sso_error=…）の結果を出し、アドレスから消す
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("sso") && !q.has("sso_error")) return;
    const name = ids?.sso_name ?? "SSO";
    const err = ssoErrorMessage(q.get("sso_error"), "link", name);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: SSO_COPY.linked });
    q.delete("sso");
    q.delete("sso_error");
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  }, [ids?.sso_name]);

  if (!ids?.sso_enabled) return null;
  const name = ids.sso_name || "SSO";
  const sso = ids.identities.find((i) => i.provider === "sso");

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, init);
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: typeof j.error === "string" ? j.error : "操作できませんでした。" });
    }
    qc.invalidateQueries({ queryKey: ["sso-identities"] });
  }

  const setOnly = (enabled: boolean) =>
    call("/api/me/sso-only", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });

  return (
    <SectionCard title={SSO_COPY.linkTitle(name)}>
      <p className="text-sm text-slate-600 mb-3">{SSO_COPY.linkDescription(name)}</p>
      {sso ? (
        <div className="space-y-3">
          <p className="text-sm">{SSO_COPY.linkedAs(sso.email ?? name)}</p>
          <div>
            <p className="text-sm font-medium">{SSO_COPY.ssoOnlyTitle(name, ids.sso_only)}</p>
            <p className="text-xs text-slate-500 mt-1">{SSO_COPY.ssoOnlyDescription}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ids.sso_only ? (
              <button className="btn-secondary" disabled={busy} onClick={() => setOnly(false)}>
                {SSO_COPY.ssoOnlyOff}
              </button>
            ) : (
              <button
                className="btn-secondary"
                disabled={busy || ids.login_method !== "sso"}
                onClick={() => confirm(SSO_COPY.ssoOnlyConfirm(name)) && setOnly(true)}
              >
                {SSO_COPY.ssoOnlyOn}
              </button>
            )}
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                confirm(SSO_COPY.unlinkConfirm(name)) &&
                call("/api/me/identities/sso", { method: "DELETE" })
              }
            >
              {SSO_COPY.unlink}
            </button>
          </div>
          {!ids.sso_only && ids.login_method !== "sso" && (
            <p className="text-xs text-slate-500">{SSO_COPY.ssoOnlyNeedsSso(name)}</p>
          )}
        </div>
      ) : ids.can_link ? (
        <a href="/auth/sso/start?mode=link" className="btn-secondary inline-block">
          {SSO_COPY.link(name)}
        </a>
      ) : (
        <p className="text-sm text-slate-500">{SSO_COPY.demoDenied(name)}</p>
      )}
      <SaveNotice msg={msg} />
    </SectionCard>
  );
}
