"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";

type Suggestion = {
  homeAccountId: number;
  homeCode: string;
  homeName: string;
  corporateAccountId: number | null;
  corporateCode: string | null;
  corporateName: string | null;
  matchType: "TABLE" | "KEYWORD" | "FUZZY" | "AI_FREE" | "MANUAL";
  confidenceScore: number | null;
  isConvertible: boolean;
  isManuallyOverridden: boolean;
  notes: string | null;
};

type CorpAccount = { id: number; code: string; name: string };

const BADGE: Record<string, { label: string; className: string }> = {
  auto: { label: "自動変換", className: "bg-green-100 text-green-700" },
  review: { label: "要確認", className: "bg-yellow-100 text-yellow-700" },
  manualSet: { label: "手動設定", className: "bg-blue-100 text-blue-700" },
  manualNeeded: { label: "未設定・要選択", className: "bg-slate-200 text-slate-600" },
  unconvertible: { label: "変換不可", className: "bg-red-100 text-red-700" },
};

function badgeKey(
  s: Pick<
    Suggestion,
    "isConvertible" | "corporateAccountId" | "confidenceScore" | "isManuallyOverridden"
  >,
): keyof typeof BADGE {
  if (!s.isConvertible) return "unconvertible";
  if (s.corporateAccountId === null) return "manualNeeded";
  if (s.isManuallyOverridden) return "manualSet";
  const score = s.confidenceScore ?? 0;
  if (score >= 0.8) return "auto";
  if (score >= 0.5) return "review";
  return "manualSet";
}

export default function AccountConversionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [corpAccounts, setCorpAccounts] = useState<CorpAccount[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/account-conversion/preview").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
    ]).then(([p, a]) => {
      setSuggestions(p.data ?? []);
      setCorpAccounts((a.data ?? []).filter((acc: { code: string }) => !/^H-/.test(acc.code)));
      setLoading(false);
    });
  }, []);

  const convertibleCount = useMemo(
    () => suggestions.filter((s) => s.isConvertible && s.corporateAccountId !== null).length,
    [suggestions],
  );

  const changeTarget = (homeAccountId: number, corporateAccountId: number) => {
    const corp = corpAccounts.find((a) => a.id === corporateAccountId) ?? null;
    setSuggestions((list) =>
      list.map((s) =>
        s.homeAccountId === homeAccountId
          ? {
              ...s,
              corporateAccountId: corp?.id ?? null,
              corporateCode: corp?.code ?? null,
              corporateName: corp?.name ?? null,
              isManuallyOverridden: true,
            }
          : s,
      ),
    );
  };

  const toggleUnconvertible = (homeAccountId: number) => {
    setSuggestions((list) =>
      list.map((s) =>
        s.homeAccountId === homeAccountId ? { ...s, isConvertible: !s.isConvertible } : s,
      ),
    );
  };

  const confirm = async () => {
    setSaving(true);
    const res = await fetch("/api/account-conversion/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromMode: "HOME",
        toMode: "CORPORATE",
        mappings: suggestions.map((s) => ({
          homeAccountId: s.homeAccountId,
          corporateAccountId: s.corporateAccountId,
          matchType: s.matchType,
          confidenceScore: s.confidenceScore,
          isConvertible: s.isConvertible,
          isManuallyOverridden: s.isManuallyOverridden,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      const { data } = await res.json();
      router.push(`/account-conversion/history?session=${data.sessionId}`);
    }
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-slate-800">勘定科目変換（家庭 → 法人）</h1>
        <Link
          href="/account-conversion/history"
          className="text-sm text-indigo-600 hover:underline"
        >
          変換履歴を見る
        </Link>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        家庭モード（H-prefix）の勘定科目を法人科目へ変換する候補です。内容を確認し、必要に応じて変換先を変更してから確定してください。
      </p>

      {loading ? (
        <p className="text-slate-400">読み込み中…</p>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🔁</p>
          <p>家庭モードの勘定科目が見つかりませんでした。</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="text-left py-2 px-3">家庭モード科目</th>
                  <th className="text-left py-2 px-3">変換先（法人科目）</th>
                  <th className="text-left py-2 px-3">変換区分</th>
                  <th className="text-left py-2 px-3">メモ</th>
                  <th className="text-left py-2 px-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suggestions.map((s) => {
                  const badge = BADGE[badgeKey(s)];
                  return (
                    <tr key={s.homeAccountId}>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {s.homeCode} {s.homeName}
                      </td>
                      <td className="py-2 px-3">
                        {s.isConvertible ? (
                          <select
                            value={s.corporateAccountId ?? ""}
                            onChange={(e) => changeTarget(s.homeAccountId, Number(e.target.value))}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-sm min-w-[10rem]"
                          >
                            <option value="">未選択</option>
                            {corpAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-400">—（変換不可）</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-500 max-w-xs">{s.notes ?? "—"}</td>
                      <td className="py-2 px-3">
                        <button
                          onClick={() => toggleUnconvertible(s.homeAccountId)}
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          {s.isConvertible ? "変換不可にする" : "変換可能に戻す"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-6">
            <p className="text-sm text-slate-500">
              {convertibleCount} / {suggestions.length} 科目が変換先を持っています。
            </p>
            <div className="flex gap-3">
              <Link
                href="/dashboard"
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                キャンセル
              </Link>
              <button
                onClick={confirm}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "保存中…" : "確定して反映"}
              </button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
