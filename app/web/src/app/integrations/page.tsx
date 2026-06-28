"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

type OBAccount = {
  id: number; bankName: string; accountName: string; accountType: string; balance: number | null;
};
type OBStatus = { configured: boolean; message?: string; accounts: OBAccount[] };

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

function IntegrationCard({
  name, icon, description, status, onConnect,
}: {
  name: string; icon: string; description: string;
  status: "connected" | "unconfigured" | "pending";
  onConnect: () => void;
}) {
  const statusProps = {
    connected:    { label: "連携済み", cls: "bg-green-100 text-green-700" },
    unconfigured: { label: "未設定",   cls: "bg-slate-100 text-slate-500" },
    pending:      { label: "設定中…",  cls: "bg-amber-100 text-amber-600" },
  }[status];

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">{icon}</span>
          <div>
            <p className="font-semibold text-slate-800 text-sm">{name}</p>
            <p className="text-xs text-slate-500 mt-0.5">{description}</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusProps.cls}`}>
          {statusProps.label}
        </span>
      </div>
      <button
        type="button"
        onClick={onConnect}
        disabled={status === "pending"}
        className="w-full text-xs px-3 py-2 rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors font-medium"
      >
        {status === "connected" ? "再連携・設定確認" : "連携を開始"}
      </button>
    </div>
  );
}

export default function IntegrationsPage() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: obStatus } = useQuery<OBStatus>({
    queryKey: ["openbanking-accounts"],
    queryFn:  async () => {
      const res = await fetch("/api/integrations/openbanking?action=accounts");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  async function connectFreee() {
    setMsg(null);
    const res = await fetch("/api/integrations/freee?action=auth_url");
    const json = await res.json() as { authUrl?: string; configured?: boolean; error?: string };
    if (!json.configured || !json.authUrl) {
      setMsg({ ok: false, text: json.error ?? "FREEE_CLIENT_ID が環境変数に設定されていません。" });
      return;
    }
    window.location.href = json.authUrl;
  }

  async function connectMoneyForward() {
    setMsg(null);
    const res = await fetch("/api/integrations/moneyforward?action=auth_url");
    const json = await res.json() as { authUrl?: string; configured?: boolean; error?: string };
    if (!json.configured || !json.authUrl) {
      setMsg({ ok: false, text: json.error ?? "MF_CLIENT_ID が環境変数に設定されていません。" });
      return;
    }
    window.location.href = json.authUrl;
  }

  function connectOpenBanking() {
    if (!obStatus?.configured) {
      setMsg({ ok: false, text: "OPENBANKING_API_KEY が環境変数に設定されていません。" });
      return;
    }
    setMsg({ ok: true, text: "オープンバンキング API は設定済みです。銀行口座管理ページで残高同期できます。" });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">外部サービス連携</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          freee・マネーフォワード・オープンバンキング API との連携管理
        </p>
      </div>

      {msg && (
        <p className={`mb-4 text-sm rounded-lg px-4 py-3 border ${
          msg.ok
            ? "text-green-700 bg-green-50 border-green-200"
            : "text-amber-700 bg-amber-50 border-amber-200"
        }`} role="alert">
          {msg.text}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <IntegrationCard
          name="freee 会計"
          icon="📒"
          description="取引データ・仕訳の同期。OAuth 2.0 認可。"
          status={process.env.NEXT_PUBLIC_FREEE_CONFIGURED === "true" ? "connected" : "unconfigured"}
          onConnect={connectFreee}
        />
        <IntegrationCard
          name="マネーフォワード クラウド"
          icon="💰"
          description="仕訳帳・請求書データの同期。OAuth 2.0 認可。"
          status={process.env.NEXT_PUBLIC_MF_CONFIGURED === "true" ? "connected" : "unconfigured"}
          onConnect={connectMoneyForward}
        />
        <IntegrationCard
          name="オープンバンキング（全銀 API）"
          icon="🏦"
          description="銀行口座の入出金を自動取得。API キー認証。"
          status={obStatus?.configured ? "connected" : "unconfigured"}
          onConnect={connectOpenBanking}
        />
      </div>

      {/* 銀行口座一覧 */}
      <div className="card">
        <h2 className="section-title mb-4">連携済み銀行口座</h2>
        {!obStatus && (
          <p className="text-sm text-slate-400">読み込み中…</p>
        )}
        {obStatus?.accounts.length === 0 && (
          <p className="text-sm text-slate-500">銀行口座が登録されていません。</p>
        )}
        {obStatus && obStatus.accounts.length > 0 && (
          <table className="w-full text-sm" role="table">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-slate-600">銀行名</th>
                <th className="text-left px-4 py-2 font-semibold text-slate-600">口座名義</th>
                <th className="text-left px-4 py-2 font-semibold text-slate-600">種別</th>
                <th className="text-right px-4 py-2 font-semibold text-slate-600">残高</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {obStatus.accounts.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-800">{a.bankName}</td>
                  <td className="px-4 py-2 text-slate-700">{a.accountName}</td>
                  <td className="px-4 py-2 text-slate-500">{a.accountType}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-800">
                    {a.balance != null ? yen(a.balance) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 設定手順 */}
      <div className="card mt-4 bg-slate-50 border-slate-200">
        <h2 className="section-title mb-3">設定手順</h2>
        <ol className="space-y-1.5 text-sm text-slate-600 list-decimal list-inside">
          <li><strong>freee</strong>: <code className="text-xs bg-white border border-slate-200 rounded px-1">FREEE_CLIENT_ID</code> / <code className="text-xs bg-white border border-slate-200 rounded px-1">FREEE_CLIENT_SECRET</code> を <code className="text-xs bg-white border border-slate-200 rounded px-1">.env</code> に設定</li>
          <li><strong>マネーフォワード</strong>: <code className="text-xs bg-white border border-slate-200 rounded px-1">MF_CLIENT_ID</code> / <code className="text-xs bg-white border border-slate-200 rounded px-1">MF_CLIENT_SECRET</code> を設定</li>
          <li><strong>オープンバンキング</strong>: 参加銀行の API 申請後、<code className="text-xs bg-white border border-slate-200 rounded px-1">OPENBANKING_API_KEY</code> / <code className="text-xs bg-white border border-slate-200 rounded px-1">OPENBANKING_API_BASE</code> を設定</li>
          <li>Docker Compose または本番環境を再起動して環境変数を反映</li>
        </ol>
      </div>
    </AppShell>
  );
}
