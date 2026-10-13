"use client";

// 実績管理の「履歴」タブ（出どころが現金）。銀行・カードと同じ共通の表で、科目の変更と削除を行う。
// 明細はサーバーで 30 件ずつ読み、状態・科目・事業利用で絞り込める（useLedgerHistory）。
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LoadingSpinner } from "@/components/StateViews";
import { BusinessTag, LedgerBadge, LedgerTable, useLedgerHistory } from "@/components/LedgerTable";
import { Notice } from "@/components/ui";
import { displayName, type ViewMode } from "@/lib/shared/display-name";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { CATEGORY_LABEL as GROUP_LABELS, CATEGORY_ORDER as GROUP_ORDER } from "@/lib/shared/labels";
import { yenAbs } from "@/lib/common/format";
import { flowLabel, flowSide } from "@/lib/shared/amount-direction";
import { EXPENSE_CATS, INCOME_CATS, type Account, type CashEntry } from "@/components/entry/types";

export function CashHistoryTab({
  accounts,
  mode,
}: {
  accounts: Account[] | undefined;
  mode: ViewMode;
}) {
  const queryClient = useQueryClient();
  // 現金の明細（30 件ずつ。個人事業主モードは最初から事業利用の明細だけ）
  const history = useLedgerHistory<CashEntry>({ kind: "CASH", mode });
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

  if (history.loading) return <LoadingSpinner label="履歴を読み込み中…" />;

  return (
    <>
      {histMsg && (
        <Notice tone="error" onClose={() => setHistMsg(null)} className="mb-3">
          {histMsg}
        </Notice>
      )}
      <LedgerTable
        total={history.total}
        offset={history.offset}
        pageSize={history.pageSize}
        onPageChange={history.setOffset}
        emptyText={
          history.filtered
            ? "この条件に一致する明細はありません"
            : "現金の明細はまだありません。カレンダーから登録できます。"
        }
        toolbar={history.toolbar}
        rows={history.rows.map((e) => ({
          key: e.id,
          date: new Date(e.date).toLocaleDateString("ja-JP"),
          account: "現金",
          description: (
            <>
              {e.description}
              <BusinessTag businessUse={e.businessUse} businessRatio={e.businessRatio} />
            </>
          ),
          amount: yenAbs(e.amount),
          tone: flowSide("cash", e.amount),
          directionLabel: flowLabel("cash", e.amount),
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
