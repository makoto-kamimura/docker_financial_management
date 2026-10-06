"use client";

// 明細から見つけた「毎月の入出金」の候補（銀行管理の振替タブ）。資金繰りを登録済みの情報から割り出すため、
// 毎月同じころ・同じくらいの入出金を、資金移動ルールの候補として出す（判定は lib/recurring-suggestions.ts）。
// 「登録」で資金移動ルールになり、資金繰り・資金フロー図に入る。「非表示」は記録して以後は出さない。

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SectionLead } from "@/components/Explain";
import { Notice } from "@/components/ui";
import { BANK_HELP } from "@/lib/help-texts";

export type RecurringSuggestion = {
  accountId: number;
  accountName: string;
  signature: string;
  direction: "in" | "out";
  label: string;
  amount: number;
  day: number;
  months: number;
  lastDate: string;
};

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

export function useRecurringSuggestions() {
  return useQuery({
    queryKey: ["transfer-suggestions"],
    queryFn: async (): Promise<RecurringSuggestion[]> =>
      (await (await fetch("/api/transfers/suggestions")).json()).data ?? [],
  });
}

export function RecurringSuggestionsPanel() {
  const qc = useQueryClient();
  const { data } = useRecurringSuggestions();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["transfer-suggestions"] });
    qc.invalidateQueries({ queryKey: ["transfer-flow"] });
    qc.invalidateQueries({ queryKey: ["funding-plan"] });
    qc.invalidateQueries({ queryKey: ["transfers"] });
  };

  // 登録: 入金は外部 → 口座（給与・収入）、出金は口座 → 外部（支出）の資金移動ルールにする
  const register = useMutation({
    mutationFn: async (s: RecurringSuggestion) => {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(s.direction === "in" ? { toAccountId: s.accountId } : { fromAccountId: s.accountId }),
          amount: s.amount,
          day: s.day,
          label: s.label,
          channel: s.direction === "in" ? "INCOME" : "EXPENSE",
          kind: "AUTO",
        }),
      });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).error ?? "登録に失敗しました");
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const dismiss = useMutation({
    mutationFn: async (s: RecurringSuggestion) => {
      const res = await fetch("/api/transfers/suggestions/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId: s.accountId, signature: s.signature }),
      });
      if (!res.ok) throw new Error("非表示にできませんでした");
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!data || data.length === 0) return null;

  return (
    <section aria-labelledby="recurring-suggestions-title" className="card mb-6">
      <h3 id="recurring-suggestions-title" className="section-title mb-1">
        毎月の入出金の候補（{data.length} 件）
      </h3>
      <SectionLead className="mb-3">{BANK_HELP.suggestions}</SectionLead>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {data.map((s) => (
          <li
            key={`${s.accountId}:${s.signature}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${s.direction === "in" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
            >
              {s.direction === "in" ? "入金" : "出金"}
            </span>
            <span className="min-w-40 text-slate-700">
              {s.label}
              <span className="block text-[11px] text-slate-400">
                {s.accountName} ・ 直近6か月のうち {s.months} か月 ・ 最後は {s.lastDate}
              </span>
            </span>
            <span className="tabular-nums text-slate-700">{yen(s.amount)}</span>
            <span className="text-slate-500">毎月{s.day}日</span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled={register.isPending}
                onClick={() => register.mutate(s)}
                className="btn-primary btn-sm"
              >
                登録
              </button>
              <button
                type="button"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(s)}
                className="btn-secondary btn-sm"
              >
                非表示
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
