"use client";

// 予算管理の「カレンダー」タブ。実績管理のカレンダー（手動）と同じ形で、日付を選んで予算を登録する。
// 登録した 1 件は、その科目・月の予算（budgets.amount）に足され、一覧のセルの内訳に出る
// （POST/DELETE /api/budget-items）。予算を確定した月は登録・削除できない。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SectionLead } from "@/components/Explain";
import { displayName, type ViewMode } from "@/lib/display-name";
import { BUDGET_HELP } from "@/lib/help-texts";
import { setFiscalYear, useFiscalYear } from "@/lib/use-fiscal-year";

type CategoryAccount = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};
type BudgetItem = {
  id: number;
  date: string;
  description: string;
  amount: number;
  account: { code: string; name: string; category: string };
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const now = new Date();
const yen = (v: number) => `${Math.round(v).toLocaleString("ja-JP")}円`;
const pad = (n: number) => String(n).padStart(2, "0");
const INCOME_CATS = ["REVENUE"];
const EXPENSE_CATS = ["EXPENSE", "COGS"];
const BLANK_FORM = {
  direction: "expense" as "income" | "expense",
  description: "",
  accountCode: "",
  amount: "",
};

type Props = {
  mode: ViewMode;
  accounts: CategoryAccount[];
  /** 予算を確定済みの月（表示中の年度。登録・削除を止める） */
  confirmedMonths: number[];
};

export function BudgetCalendar({ mode, accounts, confirmedMonths }: Props) {
  const qc = useQueryClient();
  // 年は対象年度（左のメニュー）に合わせる。月を送って年をまたいだら、対象年度も変える
  const viewYear = useFiscalYear();
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = confirmedMonths.includes(viewMonth);

  const { data: items, isLoading } = useQuery({
    queryKey: ["budget-items", viewYear, viewMonth],
    queryFn: async (): Promise<BudgetItem[]> =>
      (await (await fetch(`/api/budget-items?year=${viewYear}&month=${viewMonth}`)).json()).data ??
      [],
  });

  const isIncome = (i: BudgetItem) => INCOME_CATS.includes(i.account.category);
  const byDay = useMemo(() => {
    const m = new Map<number, BudgetItem[]>();
    for (const i of items ?? []) {
      const d = Number(i.date.slice(8, 10));
      m.set(d, [...(m.get(d) ?? []), i]);
    }
    return m;
  }, [items]);
  const monthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const i of items ?? []) {
      if (isIncome(i)) income += i.amount;
      else expense += i.amount;
    }
    return { income, expense, net: income - expense, count: items?.length ?? 0 };
  }, [items]);

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const selectedItems = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const mainAccounts = accounts.filter((a) =>
    (form.direction === "income" ? INCOME_CATS : EXPENSE_CATS).includes(a.category),
  );

  function moveMonth(delta: number) {
    const d = new Date(viewYear, viewMonth - 1 + delta, 1);
    if (d.getFullYear() !== viewYear) setFiscalYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
    setSelectedDay(null);
  }

  // 予算の内訳を使う表示（一覧・予実差・履歴・ダッシュボード）をまとめて取り直す
  const refresh = () => {
    for (const key of ["budget-items", "budgets", "budget-history", "budget-variance", "kpi"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDay) return;
    setError(null);
    const amount = Number(form.amount);
    if (!form.description.trim() || !form.accountCode || !(amount > 0)) {
      setError("摘要・科目・金額を入力してください。");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/budget-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: `${viewYear}-${pad(viewMonth)}-${pad(selectedDay)}`,
        accountCode: form.accountCode,
        description: form.description.trim(),
        amount,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setForm((f) => ({ ...BLANK_FORM, direction: f.direction, accountCode: f.accountCode }));
      refresh();
    } else {
      const j = await res.json().catch(() => null);
      setError(typeof j?.error === "string" ? j.error : "登録に失敗しました");
    }
  }

  async function remove(i: BudgetItem) {
    if (
      !confirm(
        `「${i.description}」を削除してよいですか？この月の予算から ${yen(i.amount)} を引きます。`,
      )
    )
      return;
    const res = await fetch(`/api/budget-items/${i.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(typeof j?.error === "string" ? j.error : "削除に失敗しました");
    }
    refresh();
  }

  return (
    <>
      <SectionLead>{BUDGET_HELP.calendar}</SectionLead>
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* カレンダー */}
        <div className="card w-full lg:flex-1 min-w-0 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <button
              onClick={() => moveMonth(-1)}
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
              {locked && <span className="ml-2 text-xs text-slate-400">🔒 確定済み</span>}
            </span>
            <button
              onClick={() => moveMonth(1)}
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
          {/* 表示中の月にカレンダーで登録した予算の合計 */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <span className="text-xs text-slate-500">
              収入合計{" "}
              <span className="text-sm font-semibold text-emerald-600 tabular-nums">
                {yen(monthTotals.income)}
              </span>
            </span>
            <span className="text-xs text-slate-500">
              支出合計{" "}
              <span className="text-sm font-semibold text-rose-600 tabular-nums">
                {yen(monthTotals.expense)}
              </span>
            </span>
            <span className="text-xs text-slate-500">
              差引{" "}
              <span
                className={`text-sm font-semibold tabular-nums ${monthTotals.net < 0 ? "text-red-600" : "text-indigo-600"}`}
              >
                {yen(monthTotals.net)}
              </span>
            </span>
            <span className="text-xs text-slate-400 ml-auto">{monthTotals.count} 件の予算</span>
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
                const dayItems = byDay.get(day) ?? [];
                const inc = dayItems.filter(isIncome).reduce((s, x) => s + x.amount, 0);
                const exp = dayItems.filter((x) => !isIncome(x)).reduce((s, x) => s + x.amount, 0);
                const weekday = i % 7;
                return (
                  <button
                    key={i}
                    disabled={!isValid}
                    onClick={() => isValid && setSelectedDay(day)}
                    className={[
                      "min-h-[4.5rem] p-1.5 border-b border-r border-slate-100 text-left transition-colors",
                      !isValid ? "bg-slate-50/50" : "hover:bg-indigo-50/50 cursor-pointer",
                      isValid && day === selectedDay
                        ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300"
                        : "",
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
                        {inc > 0 && (
                          <p className="text-[10px] text-emerald-600 truncate leading-tight">
                            +{yen(inc)}
                          </p>
                        )}
                        {exp > 0 && (
                          <p className="text-[10px] text-rose-600 truncate leading-tight">
                            −{yen(exp)}
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
                <p className="text-xs text-slate-400 mt-0.5">{selectedItems.length} 件の予算</p>
              </div>

              {selectedItems.length > 0 && (
                <div className="card p-0 overflow-hidden">
                  <ul className="divide-y divide-slate-100">
                    {selectedItems.map((i) => (
                      <li key={i.id} className="flex items-start gap-2 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">
                            {i.description}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {displayName(
                              accounts.find((a) => a.code === i.account.code) ?? i.account,
                              mode,
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-xs font-semibold tabular-nums ${isIncome(i) ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {isIncome(i) ? "+" : "−"}
                            {yen(i.amount)}
                          </span>
                          {!locked && (
                            <button
                              onClick={() => remove(i)}
                              className="text-slate-300 hover:text-red-400 text-xs"
                              title="削除"
                              aria-label={`${i.description} を削除`}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {locked ? (
                <div className="card text-xs text-slate-500">{BUDGET_HELP.cycleLocked}</div>
              ) : (
                <div className="card">
                  <h3 className="text-xs font-semibold text-slate-600 mb-3">予算を追加</h3>
                  <form onSubmit={submit} className="flex flex-col gap-2.5">
                    <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
                      {(["expense", "income"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, direction: d, accountCode: "" }))}
                          className={`flex-1 py-1.5 font-medium transition-colors ${
                            form.direction === d
                              ? d === "expense"
                                ? "bg-rose-500 text-white"
                                : "bg-emerald-500 text-white"
                              : "bg-white text-slate-500 hover:bg-slate-50"
                          }`}
                        >
                          {d === "expense" ? "支出" : "収入"}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">摘要</label>
                      <input
                        type="text"
                        required
                        placeholder="例: 旅行"
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        className="input-field text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">
                        {form.direction === "expense" ? "支出科目" : "収入科目"}
                      </label>
                      <select
                        required
                        value={form.accountCode}
                        onChange={(e) => setForm((f) => ({ ...f, accountCode: e.target.value }))}
                        className="input-field text-xs"
                      >
                        <option value="">選択してください</option>
                        {mainAccounts.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} {displayName(a, mode)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500">金額（円）</label>
                      <input
                        type="number"
                        required
                        min={1}
                        placeholder="例: 50000"
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
              )}
            </>
          ) : (
            <div className="card text-center py-8">
              <p className="text-sm text-slate-400">
                カレンダーの日付をクリックして
                <br />
                予算を入力してください
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
