"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

type SessionSummary = {
  id: number;
  fromMode: string;
  toMode: string;
  convertedAt: string;
  status: string;
  accountCount: number;
  convertibleCount: number;
  manualCount: number;
};

type LogDetail = {
  id: number;
  matchType: string;
  confidenceScore: number | null;
  isConvertible: boolean;
  isManuallyOverridden: boolean;
  homeAccount: { code: string; name: string } | null;
  corporateAccount: { code: string; name: string } | null;
};

type SessionDetail = SessionSummary & { logs: LogDetail[] };

const MODE_LABEL: Record<string, string> = { HOME: "家庭", CORPORATE: "法人" };

export default function AccountConversionHistoryPage() {
  return (
    <Suspense>
      <AccountConversionHistoryInner />
    </Suspense>
  );
}

function AccountConversionHistoryInner() {
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account-conversion/history")
      .then((r) => r.json())
      .then((res) => {
        const list: SessionSummary[] = res.data ?? [];
        setSessions(list);
        const initial = searchParams.get("session");
        setSelectedId(initial ? Number(initial) : (list[0]?.id ?? null));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    fetch(`/api/account-conversion/history/${selectedId}`)
      .then((r) => r.json())
      .then((res) => setDetail(res.data ?? null));
  }, [selectedId]);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">勘定科目 変換履歴</h1>
        <Link href="/account-conversion" className="text-sm text-indigo-600 hover:underline">
          新しく変換する
        </Link>
      </div>

      {loading ? (
        <p className="text-slate-400">読み込み中…</p>
      ) : sessions.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🗂️</p>
          <p>変換履歴はまだありません。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-2 h-fit">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${
                  selectedId === s.id ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50"
                }`}
              >
                <div className="font-medium">
                  {new Date(s.convertedAt).toLocaleDateString("ja-JP")} {MODE_LABEL[s.fromMode] ?? s.fromMode} →{" "}
                  {MODE_LABEL[s.toMode] ?? s.toMode}
                </div>
                <div className="text-xs text-slate-400">
                  {s.convertibleCount}/{s.accountCount} 科目変換済み
                </div>
              </button>
            ))}
          </div>

          <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
            {!detail ? (
              <p className="text-slate-400">セッションを選択してください。</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-slate-800">
                    {new Date(detail.convertedAt).toLocaleString("ja-JP")} の変換結果
                  </h2>
                  <a
                    href={`/api/account-conversion/history/${detail.id}/export`}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    CSV エクスポート
                  </a>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="text-left pb-2">家庭モード科目</th>
                      <th className="text-left pb-2">法人モード科目</th>
                      <th className="text-left pb-2">変換区分</th>
                      <th className="text-left pb-2">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {detail.logs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-1.5">
                          {l.homeAccount ? `${l.homeAccount.code} ${l.homeAccount.name}` : "—"}
                        </td>
                        <td className="py-1.5">
                          {l.corporateAccount
                            ? `${l.corporateAccount.code} ${l.corporateAccount.name}`
                            : "—（変換不可）"}
                        </td>
                        <td className="py-1.5">{l.matchType}</td>
                        <td className="py-1.5">
                          {!l.isConvertible ? (
                            <span className="text-red-600">変換不可</span>
                          ) : l.isManuallyOverridden ? (
                            <span className="text-blue-600">手動</span>
                          ) : (
                            <span className="text-green-600">自動</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
