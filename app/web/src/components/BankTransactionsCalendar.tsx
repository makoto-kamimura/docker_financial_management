"use client";

// 銀行管理「カレンダー」タブ。実績管理のカレンダー（/entry の「カレンダー」タブ）と同じ形で、
// 選んだ口座の明細を日ごとに並べ、日付を押すとその日の入出金の確認と手入力での登録ができる。
// 明細は GET/POST/DELETE /api/bank-accounts/{id}/transactions（一覧と同じ）。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SectionLead } from "@/components/Explain";
import { Notice } from "@/components/ui";
import { BANK_HELP } from "@/lib/help-texts";

type BankAccount = { id: number; name: string; bankName: string };
type Txn = {
  id: number;
  date: string;
  description: string;
  amount: number;
  categoryAccount: { code: string; name: string } | null;
  transferGroupId: string | null;
  chargeToAccount: { name: string } | null;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const now = new Date();
const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const pad = (n: number) => String(n).padStart(2, "0");
const BLANK_FORM = { type: "expense" as "income" | "expense", description: "", amount: "" };

type Props = {
  /** 表示する口座（一覧・キャッシュフロータブの口座の選択と共有する）。null なら最初の口座 */
  accountId: number | null;
  onAccountIdChange: (id: number) => void;
};

export function BankTransactionsCalendar({ accountId: accountIdProp, onAccountIdChange }: Props) {
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
  const accountId = accountIdProp ?? accounts?.[0]?.id ?? null;

  const { data: txns, isLoading } = useQuery({
    queryKey: ["bank-txns", accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<Txn[]> =>
      (await (await fetch(`/api/bank-accounts/${accountId}/transactions`)).json()).data ?? [],
  });

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

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
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

  // 明細が変わると残高を使う表示（資金繰り・残高の推移・ダッシュボードのサマリ）も変わる
  const refresh = (allAccounts: boolean) => {
    qc.invalidateQueries({ queryKey: allAccounts ? ["bank-txns"] : ["bank-txns", accountId] });
    for (const key of ["bank-accounts", "funding-plan", "cash-outlook", "bank-summary"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (accountId === null || selectedDay === null) return;
    setError(null);
    const raw = Number(form.amount);
    if (!form.description.trim() || !(raw > 0)) {
      setError("摘要と金額を入力してください。");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/bank-accounts/${accountId}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: `${monthPrefix}${pad(selectedDay)}`,
        description: form.description.trim(),
        amount: form.type === "expense" ? -Math.abs(raw) : Math.abs(raw),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setForm((f) => ({ ...BLANK_FORM, type: f.type }));
      refresh(false);
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
    await fetch(`/api/bank-accounts/${accountId}/transactions?txnId=${t.id}`, {
      method: "DELETE",
    });
    refresh(t.transferGroupId !== null);
  }

  if (accounts && accounts.length === 0) {
    return (
      <Notice tone="warn" className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <span>
            口座が登録されていません。キャッシュフロータブの「銀行口座」から口座を登録してください。
          </span>
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SectionLead className="mb-0">{BANK_HELP.calendar}</SectionLead>
        <select
          className="input-field w-60 ml-auto"
          value={accountId ?? ""}
          onChange={(e) => {
            onAccountIdChange(Number(e.target.value));
            setSelectedDay(null);
          }}
        >
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}（{a.bankName}）
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* カレンダー */}
        <div className="card w-full lg:flex-1 min-w-0 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <button
              onClick={prevMonth}
              aria-label="前の月"
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <span className="font-semibold text-slate-800">
              {viewYear}年{viewMonth}月
            </span>
            <button
              onClick={nextMonth}
              aria-label="次の月"
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
          {/* 表示中の月の入出金の合計 */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <span className="text-xs text-slate-500">
              入金合計{" "}
              <span className="text-sm font-semibold text-emerald-600 tabular-nums">
                {yen(monthTotals.income)}
              </span>
            </span>
            <span className="text-xs text-slate-500">
              出金合計{" "}
              <span className="text-sm font-semibold text-rose-600 tabular-nums">
                {yen(monthTotals.expense)}
              </span>
            </span>
            <span className="text-xs text-slate-500">
              差引{" "}
              <span
                className={`text-sm font-semibold tabular-nums ${
                  monthTotals.net < 0 ? "text-red-600" : "text-indigo-600"
                }`}
              >
                {yen(monthTotals.net)}
              </span>
            </span>
            <span className="text-xs text-slate-400 ml-auto">{monthTotals.count} 件の明細</span>
          </div>
          <div className="grid grid-cols-7 border-b border-slate-100">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={`py-2 text-center text-xs font-medium ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-slate-500"}`}
              >
                {w}
              </div>
            ))}
          </div>
          {isLoading ? (
            <p className="p-8 text-center text-sm text-slate-400">読み込み中…</p>
          ) : (
            <div className="grid grid-cols-7">
              {Array.from({ length: totalCells }, (_, i) => {
                const day = i - firstWeekday + 1;
                const isValid = day >= 1 && day <= daysInMonth;
                const isToday =
                  isValid &&
                  viewYear === now.getFullYear() &&
                  viewMonth === now.getMonth() + 1 &&
                  day === now.getDate();
                const isSelected = isValid && day === selectedDay;
                const dayTxns = byDay.get(day) ?? [];
                const totalIncome = dayTxns.reduce((s, t) => s + Math.max(t.amount, 0), 0);
                const totalExpense = dayTxns.reduce((s, t) => s + Math.max(-t.amount, 0), 0);
                const weekday = i % 7;
                return (
                  <button
                    key={i}
                    disabled={!isValid}
                    onClick={() => isValid && setSelectedDay(day)}
                    className={[
                      "min-h-[4.5rem] p-1.5 border-b border-r border-slate-100 text-left transition-colors",
                      !isValid ? "bg-slate-50/50" : "hover:bg-indigo-50/50 cursor-pointer",
                      isSelected ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300" : "",
                    ].join(" ")}
                  >
                    {isValid && (
                      <>
                        <span
                          className={[
                            "inline-flex items-center justify-center w-6 h-6 text-xs font-medium rounded-full mb-0.5",
                            isToday
                              ? "bg-indigo-600 text-white"
                              : weekday === 0
                                ? "text-red-500"
                                : weekday === 6
                                  ? "text-blue-500"
                                  : "text-slate-700",
                          ].join(" ")}
                        >
                          {day}
                        </span>
                        {totalIncome > 0 && (
                          <p className="text-[10px] text-emerald-600 truncate leading-tight">
                            +{yen(totalIncome)}
                          </p>
                        )}
                        {totalExpense > 0 && (
                          <p className="text-[10px] text-rose-600 truncate leading-tight">
                            −{yen(totalExpense)}
                          </p>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

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
                        onClick={() => setForm((f) => ({ ...f, type: d }))}
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
