"use client";

// 実績管理の「履歴」タブ（出どころが現金）。銀行・カードと同じ共通の表で、科目の変更と削除を行う。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LoadingSpinner } from "@/components/StateViews";
import { LedgerBadge, LedgerTable } from "@/components/LedgerTable";
import { Notice } from "@/components/ui";
import { displayName, type ViewMode } from "@/lib/display-name";
import { invalidateActuals } from "@/lib/invalidate-actuals";
import { CATEGORY_LABEL as GROUP_LABELS, CATEGORY_ORDER as GROUP_ORDER } from "@/lib/labels";
import { yen } from "@/lib/format";
import { EXPENSE_CATS, INCOME_CATS, type Account, type CashEntry } from "@/components/entry/types";

// 現金の履歴のページ送り（銀行・カードの履歴と同じ 30 件ずつ）
const HISTORY_PAGE_SIZE = 30;

export function CashHistoryTab({
  accounts,
  mode,
}: {
  accounts: Account[] | undefined;
  mode: ViewMode;
}) {
  const queryClient = useQueryClient();
  const [histOffset, setHistOffset] = useState(0);

  // 現金の明細（直近 200 件）
  const { data: cashHistoryData, isLoading: histLoading } = useQuery({
    queryKey: ["actuals", "recent"],
    queryFn: async (): Promise<{ data: CashEntry[] }> => (await fetch("/api/actuals")).json(),
  });
  const cashHistory = cashHistoryData?.data;
  const histTotal = cashHistory?.length ?? 0;
  const [histMsg, setHistMsg] = useState<string | null>(null);

  // 現金の明細の科目を変える（科目を付けた明細がそのまま実績。銀行・カードと同じく学習する）
  async function setCashCategory(id: number, categoryAccountId: number | null) {
    setHistMsg(null);
    const res = await fetch(`/api/actuals/${id}/categorize`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryAccountId, learn: categoryAccountId !== null }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setHistMsg(j.error ?? "科目の変更に失敗しました");
    }
    invalidateActuals(queryClient);
  }

  async function deleteCashEntry(e: CashEntry) {
    if (!confirm(`「${e.description}」を削除してよいですか？`)) return;
    setHistMsg(null);
    const res = await fetch(`/api/actuals?id=${e.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setHistMsg(j.error ?? "削除に失敗しました");
    }
    invalidateActuals(queryClient);
  }

  const byCategory = (accounts ?? []).reduce<Record<string, Account[]>>((acc, a) => {
    (acc[a.category] ??= []).push(a);
    return acc;
  }, {});

  if (histLoading && !cashHistory) return <LoadingSpinner label="履歴を読み込み中…" />;

  return (
    <>
      {histMsg && (
        <Notice tone="error" onClose={() => setHistMsg(null)} className="mb-3">
          {histMsg}
        </Notice>
      )}
      <LedgerTable
        total={histTotal}
        offset={histOffset}
        pageSize={HISTORY_PAGE_SIZE}
        onPageChange={setHistOffset}
        emptyText="現金の明細はまだありません。カレンダーから登録できます。"
        rows={(cashHistory ?? []).slice(histOffset, histOffset + HISTORY_PAGE_SIZE).map((e) => ({
          key: e.id,
          date: new Date(e.date).toLocaleDateString("ja-JP"),
          account: "現金",
          description: e.description,
          amount: yen(e.amount),
          tone: e.amount < 0 ? ("out" as const) : ("in" as const),
          category: (
            <select
              value={e.categoryAccountId ?? ""}
              onChange={(ev) =>
                setCashCategory(e.id, ev.target.value === "" ? null : Number(ev.target.value))
              }
              className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white min-w-40"
            >
              <option value="">未割り当て</option>
              {GROUP_ORDER.map((cat) => {
                const items = (byCategory[cat] ?? []).filter((a) =>
                  [...INCOME_CATS, ...EXPENSE_CATS].includes(a.category),
                );
                if (items.length === 0) return null;
                return (
                  <optgroup key={cat} label={GROUP_LABELS[cat]}>
                    {items.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {displayName(a, mode)}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          ),
          status: (
            <LedgerBadge tone={e.categoryAccountId !== null ? "emerald" : "amber"}>
              {e.categoryAccountId !== null ? "実績" : "未割り当て"}
            </LedgerBadge>
          ),
          actions: (
            <button
              type="button"
              onClick={() => deleteCashEntry(e)}
              className="text-xs text-slate-400 hover:text-red-600"
            >
              削除
            </button>
          ),
        }))}
      />
    </>
  );
}
