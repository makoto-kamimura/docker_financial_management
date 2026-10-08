"use client";

// 借入金管理の「借入残高の推移」（資産管理の「実物資産の評価額の推移」と同じ形）。
// 上に日付つきの借入残高合計と合計のグラフ、下にローンごとの残高と金利の小さなグラフを並べる。
// 残高は今日までは返済の実績、先は償還の予定から計算した見込み。金利は今日までは履歴どおり、
// 先は登録済みの改定と履歴の傾向からの予測（lib/shared/loan-schedule.ts）。今月より先は破線。
// 単位の違う残高と金利は、同じグラフに重ねず別のグラフにする。

import { SectionCard } from "@/components/SectionCard";
import { SERIES_COLORS, ValueLineChart } from "@/components/ValueLineChart";
import { asOfDateLabel } from "@/lib/shared/asset-valuation";
import { LOANS_HELP } from "@/lib/shared/help-texts";
import { LOAN_TYPE_LABEL } from "@/lib/shared/labels";
import { loanTrendSeries, type Loan } from "@/lib/shared/loan-schedule";
import { yenShort } from "@/lib/common/format";

const percent = (v: number) => `${v.toFixed(3)}%`;
const percentAxis = (v: number) => `${Number(v).toFixed(2)}%`;

/** 返済済みの割合（%） */
export const repaidPercent = (l: Loan) =>
  Number(l.amount) > 0 ? Math.round((1 - Number(l.remainingAmount) / Number(l.amount)) * 100) : 0;

export function LoanTrendCharts({ loans }: { loans: Loan[] }) {
  if (loans.length === 0) return null;
  const trend = loanTrendSeries(loans);
  if (trend.months.length === 0) return null;

  const asOf = asOfDateLabel(new Date());
  const totalRemaining = loans
    .filter((l) => l.status === "active")
    .reduce((s, l) => s + Number(l.remainingAmount), 0);
  const totalBorrowed = loans.reduce((s, l) => s + Number(l.amount), 0);

  return (
    <SectionCard title="借入残高の推移" lead={LOANS_HELP.schedule}>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-1 mb-2">
        <div>
          <p className="text-xs text-slate-500">借入残高合計（{asOf}）</p>
          <p className="text-2xl font-bold text-rose-600 tabular-nums">
            {yenShort(totalRemaining)}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          借入総額 <span className="font-medium text-slate-700">{yenShort(totalBorrowed)}</span>
        </p>
      </div>
      <ValueLineChart
        months={trend.months}
        currentKey={trend.currentKey}
        series={[{ key: "total", label: "合計", color: SERIES_COLORS[0], values: trend.total }]}
        height={240}
      />

      <h3 className="text-sm font-semibold text-slate-700 mt-6 mb-2">ローンごとの推移</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {loans.map((l) => {
          const row = trend.loans.find((r) => r.id === l.id);
          if (!row) return null;
          return (
            <div key={l.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                  {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType}
                </span>
                <span className="text-sm font-medium text-slate-800">{l.lenderName}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${l.status === "active" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}
                >
                  {l.status === "active" ? "返済中" : "完済"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-1">
                {asOf}の残高{" "}
                <span className="font-medium text-slate-700 tabular-nums">
                  {yenShort(Number(l.remainingAmount))}
                </span>{" "}
                ・ 完済予定 {l.repaymentDate.slice(0, 7)} ・ {repaidPercent(l)}% 返済済
                {l.personalAsset && <> ・ 資産: {l.personalAsset.name}</>}
              </p>
              <p className="text-[11px] text-slate-500 mt-2">残高</p>
              <ValueLineChart
                months={trend.months}
                currentKey={trend.currentKey}
                series={[
                  { key: `b${l.id}`, label: "残高", color: SERIES_COLORS[0], values: row.balance },
                ]}
                height={130}
                compact
              />
              <p className="text-[11px] text-slate-500 mt-2">
                金利（今の金利 {percent(Number(l.interestRate) * 100)}）
              </p>
              <ValueLineChart
                months={trend.months}
                currentKey={trend.currentKey}
                series={[
                  { key: `r${l.id}`, label: "金利", color: SERIES_COLORS[1], values: row.rate },
                ]}
                height={90}
                compact
                stepped
                formatValue={percent}
                formatAxis={percentAxis}
              />
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
