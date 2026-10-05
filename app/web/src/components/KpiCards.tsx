"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { HelpTip } from "@/components/HelpTip";
import type { ViewMode } from "@/lib/display-name";
import { KPI_LABELS } from "@/lib/mode-labels";
import { kpiTermHelp } from "@/lib/help-texts";

type Kpi = {
  period: string;
  revenue: number;
  grossProfit: number;
  grossMargin: number;
  operatingProfit: number;
  operatingMargin: number;
  ytd: number;
};

type AnnualOutlook = {
  closingMonth: number;
  startKey: string;
  endKey: string;
  ytd: number;
  elapsedMonths: number;
  enteredMonths: number;
  missingMonths: number;
  estimatedMissing: number;
  remainingMonths: number;
  forecastRemaining: number;
  projected: number;
  progressRate: number | null;
};

type KpiBudget = {
  revenue: number;
  cogs: number;
  expense: number;
  grossProfit: number;
  operatingProfit: number;
  revenueRate: number | null;
  expenseRate: number | null;
  operatingProfitRate: number | null;
};

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

// 予算行の文言。予算が未登録の月は「予算 未設定」を出して欠落と 0 円を区別する。
const budgetSub = (amount: number | undefined, rate: number | null, rateLabel: string) =>
  amount == null ? "予算 未設定" : `予算 ${yen(amount)}（${rateLabel} ${pct(rate)}）`;

// "2026-07" → "2026年7月"
const periodLabel = (key: string) => {
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
};

// 年間見込みの補助表示。未入力の月（平均で按分）と残りの月（予測）の内訳を添える
const outlookSub = (a: AnnualOutlook) => {
  const notes = [
    a.missingMonths > 0 ? `未入力${a.missingMonths}か月は平均` : null,
    a.remainingMonths > 0 ? `残り${a.remainingMonths}か月は予測` : null,
  ].filter(Boolean);
  return `年間見込み ${yen(a.projected)}（${notes.length > 0 ? notes.join("・") : "実績確定"}）`;
};

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const periodKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// 対象年月セレクタ。periods は実データのある月の昇順リスト。
// 年はプルダウンで選び、月は 1〜12 を並べて選択中の月を色で示す（データの無い月は選べない）。
function PeriodSelector({
  periods,
  selected,
  onChange,
}: {
  periods: string[];
  selected: string;
  onChange: (period: string) => void;
}) {
  const selectedYear = Number(selected.slice(0, 4));
  const selectedMonth = Number(selected.slice(5));
  // 実データのある年（昇順）。選択中の年が periods に無いときも候補に含める
  const years = [...new Set([...periods.map((p) => Number(p.slice(0, 4))), selectedYear])].sort(
    (a, b) => a - b,
  );
  // 選択中の年で実データのある月
  const available = new Set(
    periods.filter((p) => Number(p.slice(0, 4)) === selectedYear).map((p) => Number(p.slice(5))),
  );

  // 年を変えたら、同じ月があればその月、無ければその年で最も新しい月へ移す
  const changeYear = (year: number) => {
    const monthsOfYear = periods
      .filter((p) => Number(p.slice(0, 4)) === year)
      .map((p) => Number(p.slice(5)));
    if (monthsOfYear.length === 0) return;
    const month = monthsOfYear.includes(selectedMonth)
      ? selectedMonth
      : monthsOfYear[monthsOfYear.length - 1];
    onChange(periodKey(year, month));
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3">
      <label htmlFor="kpi-period-year" className="text-xs font-medium text-slate-500">
        対象月:
      </label>
      <select
        id="kpi-period-year"
        value={selectedYear}
        onChange={(e) => changeYear(Number(e.target.value))}
        className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {[...years].reverse().map((y) => (
          <option key={y} value={y}>
            {y}年
          </option>
        ))}
      </select>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="対象月">
        {MONTHS.map((m) => {
          const isSelected = m === selectedMonth;
          const hasData = available.has(m);
          return (
            <button
              key={m}
              type="button"
              disabled={!hasData}
              aria-pressed={isSelected}
              title={hasData ? undefined : `${selectedYear}年${m}月のデータはありません`}
              onClick={() => onChange(periodKey(selectedYear, m))}
              className={`text-xs w-11 py-1 rounded-md border font-medium transition-colors ${
                isSelected
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                  : hasData
                    ? "border-slate-300 bg-white text-slate-600 hover:bg-indigo-50 hover:border-indigo-300"
                    : "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
              }`}
            >
              {m}月
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  budget,
  help,
  helpAlign,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  /** 対象月の予算（実績の下に並べて表示する） */
  budget?: string;
  /** 指定するとラベル横に ? を出し、押すと説明を表示する */
  help?: string;
  /** 説明の吹き出しを左へ開く（グリッドの右寄りのカード用） */
  helpAlign?: "left" | "right";
  /** true のとき赤色強調 + 警告アイコンを表示する（当月赤字警告） */
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-5 py-4 flex flex-col gap-1 ${
        warn ? "bg-red-50 border-red-300" : "bg-white border-slate-200"
      }`}
    >
      <span
        className={`text-xs font-medium uppercase tracking-wide flex items-center gap-1 ${
          warn ? "text-red-600" : "text-slate-500"
        }`}
      >
        {warn && <span aria-hidden="true">⚠</span>}
        {label}
        {help && (
          <HelpTip title={label} align={helpAlign}>
            {help}
          </HelpTip>
        )}
      </span>
      <span
        className={`text-lg font-bold tabular-nums ${warn ? "text-red-700" : "text-slate-900"}`}
      >
        {value}
      </span>
      {sub && <span className={`text-xs ${warn ? "text-red-500" : "text-slate-400"}`}>{sub}</span>}
      {budget && (
        <span className="text-xs text-indigo-600 border-t border-slate-100 pt-1 mt-0.5">
          {budget}
        </span>
      )}
    </div>
  );
}

export function KpiCards({
  mode = "sole",
  onPeriodChange,
}: {
  mode?: ViewMode;
  /** 実際に表示している対象月（サーバー既定を含む）を親へ通知する。グラフの中心月に使う */
  onPeriodChange?: (period: string) => void;
}) {
  // null のうちはサーバー既定（現在月以前の最新月）に従う
  const [period, setPeriod] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["kpi", period],
    queryFn: async (): Promise<{
      kpi: Kpi | null;
      budget: KpiBudget | null;
      periods: string[];
      annual: AnnualOutlook | null;
      annualProfit: AnnualOutlook | null;
    }> => {
      const res = await fetch(period ? `/api/kpi?period=${period}` : "/api/kpi");
      return res.json();
    },
    // 月の切り替え中も前の値を表示し続け、カードのちらつきを防ぐ
    placeholderData: (prev) => prev,
  });

  const kpi = data?.kpi;
  const budget = data?.budget ?? null;
  const annual = data?.annual ?? null;
  const annualProfit = data?.annualProfit ?? null;
  const resolvedPeriod = kpi?.period;

  useEffect(() => {
    if (resolvedPeriod) onPeriodChange?.(resolvedPeriod);
  }, [resolvedPeriod, onPeriodChange]);

  if (!kpi) return <p className="text-sm text-slate-400 py-4">KPI データがありません。</p>;

  const help = kpiTermHelp(mode);
  const labels = KPI_LABELS[mode];
  // 累計カード（期の着地見込みと現時点の達成率）。12 月決算以外は「当期」と呼び、期間を添える
  const fiscalYearIsCalendar = !annual || annual.closingMonth === 12;
  const ytdLabel = fiscalYearIsCalendar ? "当年累計 (YTD)" : "当期累計 (YTD)";
  const ytdSub = annual ? outlookSub(annual) : undefined;
  const ytdProgress = annual
    ? `達成率 ${pct(annual.progressRate)}` +
      (fiscalYearIsCalendar
        ? ""
        : `（${periodLabel(annual.startKey)}〜${periodLabel(annual.endKey)}）`)
    : undefined;
  // 利益カード（家計では貯蓄額）の補助表示は、利益率ではなく年間見込み
  const profitSub = annualProfit ? `年間見込み ${yen(annualProfit.projected)}` : undefined;
  const selector = (
    <PeriodSelector
      periods={data?.periods ?? [kpi.period]}
      selected={kpi.period}
      onChange={setPeriod}
    />
  );

  if (mode === "household") {
    const expenses = kpi.revenue - kpi.operatingProfit;
    const isDeficit = kpi.operatingProfit < 0;
    return (
      <div>
        {selector}
        {isDeficit && (
          <p className="text-sm text-red-600 font-medium mb-3 flex items-center gap-1.5">
            <span aria-hidden="true">⚠</span>
            {periodLabel(kpi.period)}は支出が収入を上回っています
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label={labels.revenue}
            value={yen(kpi.revenue)}
            budget={budgetSub(budget?.revenue, budget?.revenueRate ?? null, "達成率")}
          />
          <KpiCard
            label="支出"
            value={yen(expenses)}
            budget={budgetSub(
              budget ? budget.cogs + budget.expense : undefined,
              budget?.expenseRate ?? null,
              "消化率",
            )}
          />
          <KpiCard
            label={labels.profit}
            value={yen(kpi.operatingProfit)}
            sub={profitSub}
            budget={budgetSub(
              budget?.operatingProfit,
              budget?.operatingProfitRate ?? null,
              "達成率",
            )}
            help={help.profit}
            warn={isDeficit}
          />
          <KpiCard
            label={ytdLabel}
            value={yen(kpi.ytd)}
            sub={ytdSub}
            budget={ytdProgress}
            help={help.ytd}
            helpAlign="right"
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {selector}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label={labels.revenue}
          value={yen(kpi.revenue)}
          budget={budgetSub(budget?.revenue, budget?.revenueRate ?? null, "達成率")}
        />
        <KpiCard
          label={labels.grossProfit}
          value={yen(kpi.grossProfit)}
          sub={`${labels.grossMargin} ${pct(kpi.grossMargin)}`}
          budget={budget ? `予算 ${yen(budget.grossProfit)}` : "予算 未設定"}
        />
        <KpiCard
          label={labels.profit}
          value={yen(kpi.operatingProfit)}
          sub={profitSub}
          budget={budgetSub(budget?.operatingProfit, budget?.operatingProfitRate ?? null, "達成率")}
          help={help.profit}
        />
        <KpiCard
          label={ytdLabel}
          value={yen(kpi.ytd)}
          sub={ytdSub}
          budget={ytdProgress}
          help={help.ytd}
          helpAlign="right"
        />
      </div>
    </div>
  );
}
