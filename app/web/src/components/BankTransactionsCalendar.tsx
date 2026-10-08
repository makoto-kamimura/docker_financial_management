"use client";

// 銀行管理「カレンダー」タブ。実績管理のカレンダー（/entry の「カレンダー」タブ）と同じ形で、
// 「表示する銀行」で選んだ口座（指定なしは全口座）の明細を日ごとに並べ、日付を押すとその日の入出金の
// 確認と手入力での登録ができる。全口座のときは、登録フォームで口座を選ぶ。
// 明細は GET/POST/DELETE /api/bank-accounts/{id}/transactions（一覧と同じ）。

import { useQueries, useQueryClient, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarTotals, DayAmounts, MonthCalendar } from "@/components/MonthCalendar";
import { SectionLead } from "@/components/Explain";
import { Notice } from "@/components/ui";
import { BANK_HELP } from "@/lib/shared/help-texts";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { categoryPayload, EntryCategoryField } from "@/components/EntryCategoryField";
import { yen } from "@/lib/common/format";

type BankAccount = { id: number; name: string; bankName: string };
type Txn = {
  id: number;
  accountId: number;
  date: string;
  description: string;
  amount: number;
  categoryAccount: { code: string; name: string } | null;
  transferGroupId: string | null;
  chargeToAccount: { name: string } | null;
};

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const BLANK_FORM = {
  type: "expense" as "income" | "expense",
  description: "",
  amount: "",
  /** 全口座の表示で登録するときの口座（文字列で保持して未選択も許す） */
  accountId: "",
  /** 科目（"" = 自動。components/EntryCategoryField.tsx） */
  category: "",
};

type Props = {
  /** 銀行管理の「表示する銀行」で選んだ口座。null はすべての口座 */
  accountId: number | null;
};

export function BankTransactionsCalendar({ accountId }: Props) {
  const qc = useQueryClient();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data ?? [],
  });
  const accountName = (id: number) => accounts?.find((a) => a.id === id)?.name ?? "";

  // 明細は口座ごとに取る（一覧と同じキー）。全口座のときはまとめて日付順に並べる
  const targetIds = accountId !== null ? [accountId] : (accounts ?? []).map((a) => a.id);
  const txnQueries = useQueries({
    queries: targetIds.map((id) => ({
      queryKey: ["bank-txns", id],
      queryFn: async (): Promise<Txn[]> =>
        (await (await fetch(`/api/bank-accounts/${id}/transactions`)).json()).data ?? [],
    })),
  });
  const isLoading = txnQueries.some((q) => q.isLoading);
  const txns = useMemo(
    () => txnQueries.flatMap((q) => q.data ?? []),
    // 各口座の取得結果が変わったときだけまとめ直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txnQueries.map((q) => q.dataUpdatedAt).join(",")],
  );

  // 表示中の月の明細を日ごとに（明細の日付は "YYYY-MM-DD..." の先頭で判定する）
  const monthPrefix = `${viewYear}-${pad(viewMonth)}-`;
  const byDay = useMemo(() => {
    const m = new Map<number, Txn[]>();
    for (const t of txns ?? []) {
      if (!t.date.startsWith(monthPrefix)) continue;
      const d = Number(t.date.slice(8, 10));
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(t);
    }
    return m;
  }, [txns, monthPrefix]);

  const monthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    let count = 0;
    for (const list of byDay.values()) {
      for (const t of list) {
        if (t.amount > 0) income += t.amount;
        else expense += -t.amount;
        count++;
      }
    }
    return { income, expense, net: income - expense, count };
  }, [byDay]);

  const selectedTxns = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else setViewMonth((m) => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else setViewMonth((m) => m + 1);
    setSelectedDay(null);
  }

  // 明細が変わると残高を使う表示（残高の推移・ダッシュボードのサマリ）も変わる
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["bank-txns"] });
    for (const key of ["bank-accounts", "bank-summary"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
    invalidateActuals(qc);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedDay === null) return;
    setError(null);
    const target = accountId ?? (form.accountId ? Number(form.accountId) : null);
    if (target === null) {
      setError("登録する口座を選んでください。");
      return;
    }
    const raw = Number(form.amount);
    if (!form.description.trim() || !(raw > 0)) {
      setError("摘要と金額を入力してください。");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/bank-accounts/${target}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: `${monthPrefix}${pad(selectedDay)}`,
        description: form.description.trim(),
        amount: form.type === "expense" ? -Math.abs(raw) : Math.abs(raw),
        ...categoryPayload(form.category),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setForm((f) => ({ ...BLANK_FORM, type: f.type, accountId: f.accountId }));
      refresh();
    } else {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? "登録に失敗しました");
    }
  }

  async function remove(t: Txn) {
    const message = t.transferGroupId
      ? `「${t.description}」を削除してよいですか？振替の相手の口座の明細も一緒に削除されます。`
      : `「${t.description}」を削除してよいですか？`;
    if (!confirm(message)) return;
    const res = await fetch(`/api/bank-accounts/${t.accountId}/transactions?txnId=${t.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? "削除に失敗しました");
    }
    refresh();
  }

  if (accounts && accounts.length === 0) {
    return (
      <Notice tone="warn" className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <span>口座が登録されていません。銀行管理の「銀行口座」から口座を登録してください。</span>
          <Link
            href={"/bank-accounts?tab=cashflow" as never}
            className="shrink-0 text-amber-900 font-medium underline underline-offset-2 hover:text-amber-700"
          >
            口座を登録する
          </Link>
        </div>
      </Notice>
    );
  }

  return (
    <>
      <SectionLead>{BANK_HELP.calendar}</SectionLead>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* カレンダー（components/MonthCalendar.tsx） */}
        <MonthCalendar
          year={viewYear}
          month={viewMonth}
          onMove={(d) => (d < 0 ? prevMonth() : nextMonth())}
          summary={
            <CalendarTotals
              items={[
                { label: "入金合計", value: monthTotals.income, tone: "in" },
                { label: "出金合計", value: monthTotals.expense, tone: "out" },
                { label: "差引", value: monthTotals.net, tone: "net" },
              ]}
              note={`${monthTotals.count} 件の明細`}
            />
          }
          loading={isLoading}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          renderDay={(day) => {
            const dayEntries = byDay.get(day) ?? [];
            return (
              <DayAmounts
                income={dayEntries.reduce((s, t) => s + Math.max(t.amount, 0), 0)}
                expense={dayEntries.reduce((s, t) => s + Math.max(-t.amount, 0), 0)}
              />
            );
          }}
        />

        {/* サイドパネル */}
        <div className="w-full lg:w-80 shrink-0 flex flex-col gap-3">
          {selectedDay ? (
            <>
              <div className="card py-2 px-4">
                <p className="text-sm font-semibold text-slate-800">
                  {viewYear}年{viewMonth}月{selectedDay}日
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{selectedTxns.length} 件の明細</p>
              </div>

              {selectedTxns.length > 0 && (
                <div className="card p-0 overflow-hidden">
                  <ul className="divide-y divide-slate-100">
                    {selectedTxns.map((t) => (
                      <li key={t.id} className="flex items-start gap-2 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">
                            {t.description}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {accountId === null && `${accountName(t.accountId)} ・ `}
                            {t.transferGroupId
                              ? "口座間の振替"
                              : t.chargeToAccount
                                ? `チャージ: ${t.chargeToAccount.name}`
                                : t.categoryAccount
                                  ? `${t.categoryAccount.code} ${t.categoryAccount.name}`
                                  : "科目なし"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-xs font-semibold tabular-nums ${t.amount > 0 ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {t.amount > 0 ? "+" : "−"}
                            {yen(Math.abs(t.amount))}
                          </span>
                          <button
                            onClick={() => remove(t)}
                            className="text-slate-300 hover:text-red-400 text-xs"
                            title="削除"
                            aria-label={`${t.description} を削除`}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="card">
                <h3 className="text-xs font-semibold text-slate-600 mb-3">入出金を追加</h3>
                <form onSubmit={submit} className="flex flex-col gap-2.5">
                  <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
                    {(["expense", "income"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, type: d, category: "" }))}
                        className={`flex-1 py-1.5 font-medium transition-colors ${
                          form.type === d
                            ? d === "expense"
                              ? "bg-rose-500 text-white"
                              : "bg-emerald-500 text-white"
                            : "bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {d === "expense" ? "出金" : "入金"}
                      </button>
                    ))}
                  </div>
                  {/* すべての銀行を表示しているときは、登録する口座を選ぶ */}
                  {accountId === null && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">口座</label>
                      <select
                        required
                        value={form.accountId}
                        onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                        className="input-field text-xs"
                      >
                        <option value="">選択してください</option>
                        {accounts?.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}（{a.bankName}）
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500">摘要</label>
                    <input
                      type="text"
                      required
                      placeholder="例: 食料品"
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      className="input-field text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500">金額（円）</label>
                    <input
                      type="number"
                      required
                      min={1}
                      placeholder="例: 5000"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                      className="input-field text-xs"
                    />
                  </div>
                  <EntryCategoryField
                    value={form.category}
                    onChange={(category) => setForm((f) => ({ ...f, category }))}
                    direction={form.type}
                  />
                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <button type="submit" disabled={saving} className="btn-primary text-xs mt-1">
                    {saving ? "登録中..." : "登録"}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="card text-center py-8">
              <p className="text-sm text-slate-400">
                カレンダーの日付をクリックして
                <br />
                入出金を確認・追加してください
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
