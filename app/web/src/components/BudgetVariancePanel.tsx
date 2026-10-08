"use client";

// 予算管理の「予実差確認」タブ。選んだ月の予算と実績を科目ごとに比べて見るだけの画面。
//   データは GET /api/budgets/variance（予算の確定タブ・ダッシュボードのグラフと同じ）。
//   差額の扱いを選んで翌月の予算案を作り、確定するのは「予算の確定」タブ（components/BudgetConfirmPanel.tsx）。
//   年は左のメニュー、月は上のボタンで選ぶ（lib/use-cycle-month.ts）。

import { useQuery } from "@tanstack/react-query";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead } from "@/components/Explain";
import { CycleSteps, type CycleStatus } from "@/components/CycleSteps";
import { MonthPicker } from "@/components/MonthPicker";
import { BUDGET_HELP, textFor } from "@/lib/help-texts";
import { displayName, type ViewMode } from "@/lib/display-name";
import { isExpenseCategory, nextYearMonth, type VarianceRow } from "@/lib/budget-cycle";
import { cycleKey } from "@/lib/cycle-month";
import { useCycleMonth } from "@/lib/use-cycle-month";
import { yen, yenSigned } from "@/lib/format";

export type VarianceRowWithNames = VarianceRow & {
  soleName: string | null;
  corporateName: string | null;
};
export type VarianceResponse = CycleStatus & {
  transferTargetId: number | null;
  rows: VarianceRowWithNames[];
  summary: {
    revenue: { plan: number; actual: number };
    expense: { plan: number; actual: number };
    surplusTotal: number;
    overrunTotal: number;
  };
};

/** 差の色（有利なら緑、不利なら赤） */
export const diffClass = (r: VarianceRow) =>
  r.favorable === null ? "text-slate-500" : r.favorable ? "text-emerald-700" : "text-red-600";
/** 差の呼び方（費用は余り・超過、収入は上振れ・不足） */
export const diffLabel = (r: VarianceRow) => {
  if (r.difference === 0) return "予算どおり";
  if (isExpenseCategory(r.category)) return r.difference < 0 ? "余り" : "超過";
  return r.difference > 0 ? "上振れ" : "不足";
};

export function BudgetVariancePanel({
  mode,
  initialMonth,
  onOpenConfirm,
}: {
  mode: ViewMode;
  /** 比べる月の初期値（YYYY-MM）。省略時は最後に実績を確定した月 */
  initialMonth?: string;
  /** 「予算の確定」タブを、指定した予算の月（YYYY-MM）で開く */
  onOpenConfirm: (month: string) => void;
}) {
  const household = mode === "household";
  const { year, month, setMonth } = useCycleMonth("variance", initialMonth);

  const { data, isLoading } = useQuery({
    queryKey: ["budget-variance", year, month],
    queryFn: async (): Promise<VarianceResponse> =>
      (await (await fetch(`/api/budgets/variance?year=${year}&month=${month}`)).json()).data,
    enabled: month !== null,
  });

  const next = month !== null ? nextYearMonth(year, month) : null;
  // 翌月の予算だけがある科目（この月は予算も実績も無い）は、比べるものが無いので出さない
  const rows = (data?.rows ?? []).filter(
    (r) => r.budget !== null || r.overlay !== 0 || r.actual !== 0,
  );

  return (
    <div className="space-y-5 mb-6">
      <SectionLead className="-mb-2">{textFor(BUDGET_HELP.variance, mode)}</SectionLead>

      <div className="card flex flex-col gap-3">
        <MonthPicker year={year} month={month} onChange={setMonth} label="比べる月" />
        {data && <CycleSteps status={data} links={{ actuals: true }} />}
      </div>

      {isLoading && <LoadingSpinner />}

      {data && rows.length === 0 && (
        <p className="text-sm text-slate-400">
          {year}年{month}月には、予算も実績もまだありません。
        </p>
      )}

      {data && rows.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryTile
              title={household ? "収入" : "売上・収入"}
              main={yen(data.summary.revenue.actual)}
              sub={`予算 ${yen(data.summary.revenue.plan)}`}
            />
            <SummaryTile
              title={household ? "支出" : "費用"}
              main={yen(data.summary.expense.actual)}
              sub={`予算 ${yen(data.summary.expense.plan)}`}
            />
            <SummaryTile
              title="余った額"
              main={yen(data.summary.surplusTotal)}
              sub="予算より少なく済んだ費用の合計"
              tone="good"
            />
            <SummaryTile
              title="超えた額"
              main={yen(data.summary.overrunTotal)}
              sub="予算を超えた費用の合計"
              tone="bad"
            />
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="px-4 pt-4">
              <h3 className="section-title mb-3">
                {year}年{month}月の予算と実績
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                    <th className="px-4 py-2 text-left font-semibold min-w-44">勘定科目</th>
                    <th className="px-3 py-2 text-right font-semibold">予算</th>
                    <th className="px-3 py-2 text-right font-semibold">実績</th>
                    <th className="px-3 py-2 text-right font-semibold">差（実績−予算）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.accountId}>
                      <td className="px-4 py-2">
                        <span className="text-xs font-mono text-slate-400 mr-1.5">
                          {r.accountCode}
                        </span>
                        {displayName(r, mode)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.budget === null && r.overlay === 0 ? "—" : yen(r.plan)}
                        {r.overlay > 0 && (
                          <div className="text-[10px] text-indigo-500">
                            内 自動反映 {yen(r.overlay)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{yen(r.actual)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${diffClass(r)}`}>
                        {yenSigned(r.difference)}
                        <div className="text-[10px]">{diffLabel(r)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {next && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onOpenConfirm(cycleKey(next.year, next.month))}
                  className="btn-primary"
                >
                  {next.month}月の予算案を作る
                </button>
                <span className="text-xs text-slate-500">
                  差額の扱いを選んで{next.month}月の予算を確定するのは「予算の確定」タブです。
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function SummaryTile({
  title,
  main,
  sub,
  tone,
}: {
  title: string;
  main: string;
  sub: string;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-600" : "text-slate-800";
  return (
    <div className="card py-3">
      <p className="text-xs text-slate-500">{title}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{main}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}
