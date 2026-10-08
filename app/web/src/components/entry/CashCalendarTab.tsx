"use client";

// 実績管理の「カレンダー」タブ（出どころが現金）。日を選んで現金の明細を登録・削除する。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { CalendarTotals, DayAmounts, MonthCalendar } from "@/components/MonthCalendar";
import { setFiscalYear, useFiscalYear } from "@/lib/use-fiscal-year";
import { displayName, type ViewMode } from "@/lib/display-name";
import { invalidateActuals } from "@/lib/invalidate-actuals";
import { yen } from "@/lib/format";
import {
  EXPENSE_CATS,
  INCOME_CATS,
  entryAmount,
  type Account,
  type CashEntry,
} from "@/components/entry/types";

// 現金のカレンダーの登録フォーム。支払元・入金先は現金に固定する（銀行・カードは出どころで選ぶ）
const BLANK_CAL_FORM = {
  description: "",
  accountCode: "",
  amount: "",
  direction: "expense" as "income" | "expense",
};

const now = new Date();

export function CashCalendarTab({
  accounts,
  mode,
}: {
  accounts: Account[] | undefined;
  mode: ViewMode;
}) {
  const queryClient = useQueryClient();
  // ── カレンダー ────────────────────────────────────────────────
  // カレンダーの年は対象年度に合わせる。月を送って年をまたいだら、対象年度も変える
  const viewYear = useFiscalYear();
  const setViewYear = (f: (y: number) => number) => setFiscalYear(f(viewYear));
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());
  const [calForm, setCalForm] = useState(BLANK_CAL_FORM);
  const [calSaving, setCalSaving] = useState(false);
  const [calError, setCalError] = useState("");

  const { data: cashData, isLoading: calLoading } = useQuery({
    queryKey: ["actuals", viewYear, viewMonth],
    queryFn: async (): Promise<{ data: CashEntry[] }> =>
      (await fetch(`/api/actuals?year=${viewYear}&month=${viewMonth}`)).json(),
  });

  // 参照が毎回変わると下の useMemo が無駄に再計算されるため、ここで安定させる
  const calEntries = useMemo(() => cashData?.data ?? [], [cashData]);

  const byDay = useMemo(() => {
    const m = new Map<number, CashEntry[]>();
    for (const e of calEntries) {
      const d = new Date(e.date).getDate();
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(e);
    }
    return m;
  }, [calEntries]);

  const selectedEntries = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  // 表示中の月に入力された実績の合計（カレンダー上部に表示する）
  const monthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const e of calEntries) {
      const a = entryAmount(e);
      income += a.income;
      expense += a.expense;
    }
    return { income, expense, net: income - expense, count: calEntries.length };
  }, [calEntries]);

  const incomeAccounts = (accounts ?? []).filter((a) => INCOME_CATS.includes(a.category));
  const expenseAccounts = (accounts ?? []).filter((a) => EXPENSE_CATS.includes(a.category));
  const calMainAccounts = calForm.direction === "income" ? incomeAccounts : expenseAccounts;

  // ── カレンダーハンドラ ───────────────────────────────────────
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

  async function handleCalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDay) return;
    setCalSaving(true);
    setCalError("");
    const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
    const res = await fetch("/api/actuals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: dateStr,
        description: calForm.description,
        accountCode: calForm.accountCode,
        amount: Number(calForm.amount),
        direction: calForm.direction,
      }),
    });
    if (res.ok) {
      setCalForm(BLANK_CAL_FORM);
      invalidateActuals(queryClient);
    } else {
      const j = (await res.json()) as { error?: string };
      setCalError(j.error ?? "登録に失敗しました");
    }
    setCalSaving(false);
  }

  async function handleCalDelete(id: number) {
    const res = await fetch(`/api/actuals?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setCalError(j.error ?? "削除に失敗しました");
    }
    invalidateActuals(queryClient);
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* カレンダー（components/MonthCalendar.tsx） */}
      <MonthCalendar
        year={viewYear}
        month={viewMonth}
        onMove={(d) => (d < 0 ? prevMonth() : nextMonth())}
        summary={
          <CalendarTotals
            items={[
              { label: "収入合計", value: monthTotals.income, tone: "in" },
              { label: "支出合計", value: monthTotals.expense, tone: "out" },
              { label: "差引", value: monthTotals.net, tone: "net" },
            ]}
            note={`${monthTotals.count} 件の実績`}
          />
        }
        loading={calLoading}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        renderDay={(day) => {
          const dayEntries = byDay.get(day) ?? [];
          return (
            <DayAmounts
              income={dayEntries.reduce((s, e) => s + entryAmount(e).income, 0)}
              expense={dayEntries.reduce((s, e) => s + entryAmount(e).expense, 0)}
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
              <p className="text-xs text-slate-400 mt-0.5">{selectedEntries.length} 件の実績</p>
              {selectedEntries.length > 0 &&
                (() => {
                  const income = selectedEntries.reduce((s, e) => s + entryAmount(e).income, 0);
                  const expense = selectedEntries.reduce((s, e) => s + entryAmount(e).expense, 0);
                  return (
                    <p className="text-xs text-slate-500 mt-1">
                      {income > 0 && (
                        <span className="text-emerald-600 font-medium mr-3">
                          収入 {yen(income)}
                        </span>
                      )}
                      {expense > 0 && (
                        <span className="text-rose-600 font-medium">支出 {yen(expense)}</span>
                      )}
                    </p>
                  );
                })()}
            </div>

            {selectedEntries.length > 0 && (
              <div className="card p-0 overflow-hidden">
                <ul className="divide-y divide-slate-100">
                  {selectedEntries.map((e) => {
                    const { income, expense } = entryAmount(e);
                    const isIncome = income > 0;
                    return (
                      <li key={e.id} className="flex items-start gap-2 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">
                            {e.description}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {e.categoryAccount
                              ? displayName(e.categoryAccount, mode)
                              : "未割り当て"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-xs font-semibold ${isIncome ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {isIncome ? "+" : "−"}
                            {yen(isIncome ? income : expense)}
                          </span>
                          <button
                            onClick={() => handleCalDelete(e.id)}
                            className="text-slate-300 hover:text-red-400 text-xs"
                            title="削除"
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="card">
              <h3 className="text-xs font-semibold text-slate-600 mb-3">実績を追加</h3>
              <form onSubmit={handleCalSubmit} className="flex flex-col gap-2.5">
                <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
                  {(["expense", "income"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setCalForm((f) => ({ ...f, direction: d, accountCode: "" }))}
                      className={`flex-1 py-1.5 font-medium transition-colors ${
                        calForm.direction === d
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
                    placeholder="例: 食料品"
                    value={calForm.description}
                    onChange={(e) => setCalForm((f) => ({ ...f, description: e.target.value }))}
                    className="input-field text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-500">
                    {calForm.direction === "expense" ? "支出科目" : "収入科目"}
                  </label>
                  <select
                    required
                    value={calForm.accountCode}
                    onChange={(e) => setCalForm((f) => ({ ...f, accountCode: e.target.value }))}
                    className="input-field text-xs"
                  >
                    <option value="">選択してください</option>
                    {calMainAccounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.name}
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
                    placeholder="例: 5000"
                    value={calForm.amount}
                    onChange={(e) => setCalForm((f) => ({ ...f, amount: e.target.value }))}
                    className="input-field text-xs"
                  />
                </div>
                {calError && <p className="text-xs text-red-600">{calError}</p>}
                <button type="submit" disabled={calSaving} className="btn-primary text-xs mt-1">
                  {calSaving ? "登録中..." : "登録"}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="card text-center py-8">
            <p className="text-sm text-slate-400">
              カレンダーの日付をクリックして
              <br />
              実績を入力してください
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
