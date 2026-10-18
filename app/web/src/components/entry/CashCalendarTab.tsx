"use client";

// 実績管理の「カレンダー」タブ（出どころが現金）。日を選んで現金の明細を登録・削除する。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Paperclip } from "lucide-react";
import { CalendarTotals, DayAmounts, MonthCalendar } from "@/components/MonthCalendar";
import { DirectedAmount } from "@/components/DirectedAmount";
import { setFiscalYear, useFiscalYear } from "@/lib/client/use-fiscal-year";
import { displayName, type ViewMode } from "@/lib/shared/display-name";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { yen } from "@/lib/common/format";
import { ReceiptScanButton, type ScannedReceipt } from "@/components/entry/ReceiptScanButton";
import { CashEntryForm } from "@/components/entry/CashEntryForm";
import { BusinessTag } from "@/components/LedgerTable";
import { businessPortion } from "@/lib/shared/business-use";
import { entryAmount, type Account, type CashEntry } from "@/components/entry/types";

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
  // 読み取ったレシート。フォームはレシートを読み取るたび・レシートから登録するたびに作り直す（formKey）
  const [receipt, setReceipt] = useState<ScannedReceipt | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [calError, setCalError] = useState("");
  // 個人事業主モードは事業利用の明細だけを、事業の分の額で出す
  const businessMode = mode === "sole";

  const { data: cashData, isLoading: calLoading } = useQuery({
    queryKey: ["actuals", viewYear, viewMonth],
    queryFn: async (): Promise<{ data: CashEntry[] }> =>
      (await fetch(`/api/actuals?year=${viewYear}&month=${viewMonth}`)).json(),
  });

  // 参照が毎回変わると下の useMemo が無駄に再計算されるため、ここで安定させる
  const calEntries = useMemo(() => {
    const all = cashData?.data ?? [];
    if (!businessMode) return all;
    return all
      .filter((e) => e.businessUse && e.businessRatio != null)
      .map((e) => ({ ...e, amount: businessPortion(e.amount, e.businessRatio!) }));
  }, [cashData, businessMode]);

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

  // レシートの読み取り結果をフォームに入れる。日付が読めたら、その日を選ぶ
  function applyReceipt(scanned: ScannedReceipt) {
    const { date } = scanned.result.draft;
    if (date) {
      const [y, m, d] = date.split("-").map(Number);
      setFiscalYear(y);
      setViewMonth(m);
      setSelectedDay(d);
    }
    setReceipt(scanned);
    setFormKey((k) => k + 1);
    setCalError("");
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
              kind="cash"
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
                            {businessMode && (
                              <BusinessTag
                                businessUse={e.businessUse}
                                businessRatio={e.businessRatio}
                              />
                            )}
                            {(e.receipts ?? []).map((r) => (
                              <a
                                key={r.id}
                                href={r.fileUrl}
                                title={`証憑: ${r.fileName}`}
                                className="inline-flex align-middle ml-1 text-slate-400 hover:text-indigo-600"
                              >
                                <Paperclip className="w-3 h-3" aria-label="証憑" />
                              </a>
                            ))}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {e.categoryAccount
                              ? displayName(e.categoryAccount, mode)
                              : "未割り当て"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <DirectedAmount
                            kind="cash"
                            amount={isIncome ? income : -expense}
                            className="text-xs font-semibold"
                          />
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
              <ReceiptScanButton onScanned={applyReceipt} />
              <CashEntryForm
                key={formKey}
                accounts={accounts}
                mode={mode}
                date={`${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`}
                receipt={receipt}
                onSaved={() => {
                  if (!receipt) return;
                  setReceipt(null);
                  setFormKey((k) => k + 1);
                }}
              />
              {calError && <p className="text-xs text-red-600 mt-2">{calError}</p>}
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
