"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import type { ViewMode } from "@/lib/display-name";
import { KPI_LABELS } from "@/lib/mode-labels";

type Kpi = {
  period: string;
  revenue: number;
  grossProfit: number;
  grossMargin: number;
  operatingProfit: number;
  operatingMargin: number;
  mom: number | null;
  yoy: number | null;
  ytd: number;
};

type AnnualOutlook = {
  year: number;
  ytd: number;
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

// YTD / MoM / YoY の意味説明（?アイコンのツールチップ）
const helpText = (mode: ViewMode) => {
  const income = KPI_LABELS[mode].revenue;
  return {
    ytd:
      `当年累計（Year To Date）。同じ年の1月から対象月までの${income}を合計した金額です。` +
      `対象月を切り替えると、その月までの累計に変わります。` +
      `「年間見込み」は残りの月を過去の実績（直近3か月の移動平均）から予測して足した年間の想定額、` +
      `「達成率」は想定額に対する現時点の累計の割合です。`,
    mom:
      `前月比（Month over Month）。対象月の${income}が前月から何%増減したかを示します。` +
      `＋は増加、−は減少。前月のデータが無い月は「—」と表示されます。`,
    yoy:
      `前年同月比（Year over Year）。対象月の${income}を前年の同じ月と比べた増減率です。` +
      `季節変動の影響を受けにくく、前月比より長期の傾向を掴めます。前年同月のデータが無い月は「—」です。`,
  };
};

// "2026-07" → "2026年7月"
const periodLabel = (key: string) => {
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
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
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  /** 対象月の予算（実績の下に並べて表示する） */
  budget?: string;
  /** 指定するとラベル横に ? アイコンを出し、ホバー/フォーカスで説明を表示する */
  help?: string;
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
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label={`${label}の説明`}
              className="inline-flex text-slate-400 hover:text-slate-600 focus:text-slate-600 focus:outline-none"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            <span className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-64 rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg group-hover:block group-focus-within:block">
              {help}
            </span>
          </span>
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
  const resolvedPeriod = kpi?.period;

  useEffect(() => {
    if (resolvedPeriod) onPeriodChange?.(resolvedPeriod);
  }, [resolvedPeriod, onPeriodChange]);

  if (!kpi) return <p className="text-sm text-slate-400 py-4">KPI データがありません。</p>;

  const help = helpText(mode);
  const labels = KPI_LABELS[mode];
  // 当年累計カードの補助表示（年間の着地見込みと現時点の達成率）
  const ytdSub = annual
    ? annual.remainingMonths > 0
      ? `年間見込み ${yen(annual.projected)}（残り${annual.remainingMonths}か月は予測）`
      : `年間見込み ${yen(annual.projected)}（実績確定）`
    : undefined;
  const ytdProgress = annual ? `達成率 ${pct(annual.progressRate)}` : undefined;
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
            sub={`${labels.profitRate} ${pct(kpi.operatingMargin)}`}
            budget={budgetSub(
              budget?.operatingProfit,
              budget?.operatingProfitRate ?? null,
              "達成率",
            )}
            warn={isDeficit}
          />
          <KpiCard
            label="当年累計 (YTD)"
            value={yen(kpi.ytd)}
            sub={ytdSub}
            budget={ytdProgress}
            help={help.ytd}
          />
          <KpiCard label="前月比 (MoM)" value={pct(kpi.mom)} help={help.mom} />
          <KpiCard label="前年同月比 (YoY)" value={pct(kpi.yoy)} help={help.yoy} />
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
          sub={`${labels.profitRate} ${pct(kpi.operatingMargin)}`}
          budget={budgetSub(budget?.operatingProfit, budget?.operatingProfitRate ?? null, "達成率")}
        />
        <KpiCard
          label="当年累計 (YTD)"
          value={yen(kpi.ytd)}
          sub={ytdSub}
          budget={ytdProgress}
          help={help.ytd}
        />
        <KpiCard label="前月比 (MoM)" value={pct(kpi.mom)} help={help.mom} />
        <KpiCard label="前年同月比 (YoY)" value={pct(kpi.yoy)} help={help.yoy} />
      </div>
    </div>
  );
}
