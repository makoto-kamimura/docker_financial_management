"use client";

// 銀行管理「キャッシュフロー」タブの「残高の推移」（借入金管理の「借入残高の推移」と同じ形）。
// 上に日付つきの総残高と合計のグラフ、下に口座ごとの小さなグラフを並べる。今月より先は破線。
// 合計の先は予算と実績の収支から、口座ごとの先は毎月の入出金（資金移動ルールと借入の返済）から見込む
// （GET /api/bank-accounts/cash-outlook。計算は lib/cash-outlook.ts）。
// 「表示する銀行」で 1 口座を選んだときは、その口座の残高と線グラフだけを出す（見込みは毎月の入出金から）。

import { useQuery } from "@tanstack/react-query";
import { SectionLead } from "@/components/Explain";
import { SERIES_COLORS, ValueLineChart } from "@/components/ValueLineChart";
import { asOfDateLabel } from "@/lib/asset-valuation";
import { BANK_HELP } from "@/lib/help-texts";

type CashOutlookResponse = {
  months: string[];
  currentKey: string;
  total: number[];
  totalBasis: ("actual" | "budget" | "rule")[];
  accounts: { id: number; name: string; balance: number; values: number[] }[];
};

const yen = (v: number) =>
  Math.abs(v) >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : `${Math.round(v).toLocaleString("ja-JP")}円`;

export function CashFlowTrendCharts({
  accountId = null,
}: {
  /** 銀行管理の「表示する銀行」で選んだ口座。null / 省略はすべての口座 */
  accountId?: number | null;
}) {
  const { data } = useQuery({
    queryKey: ["cash-outlook"],
    queryFn: async (): Promise<CashOutlookResponse> => {
      const res = await fetch("/api/bank-accounts/cash-outlook");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });
  if (!data || data.accounts.length === 0) return null;
  const single = accountId === null ? null : data.accounts.find((a) => a.id === accountId);
  if (accountId !== null && !single) return null;

  const currentIndex = data.months.indexOf(data.currentKey);
  const todayTotal = single ? single.balance : data.accounts.reduce((s, a) => s + a.balance, 0);
  const lastIndex = data.months.length - 1;
  const budgetMonths = data.totalBasis.filter((b, i) => i > currentIndex && b === "budget").length;
  const ruleMonths = data.totalBasis.filter((b) => b === "rule").length;
  const lastLabel = `${data.months[lastIndex].slice(0, 4)}年${Number(data.months[lastIndex].slice(5))}月`;

  return (
    <section aria-labelledby="cash-trend-title" className="card mb-6">
      <h2 id="cash-trend-title" className="section-title mb-1">
        残高の推移
      </h2>
      <SectionLead className="mb-3">{BANK_HELP.trend}</SectionLead>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-1 mb-2">
        <div>
          <p className="text-xs text-slate-500">
            {single ? `${single.name}の残高` : "総残高"}（{asOfDateLabel(new Date())}）
          </p>
          <p className="text-2xl font-bold text-indigo-600 tabular-nums">{yen(todayTotal)}</p>
        </div>
        <p className="text-xs text-slate-500">
          {lastLabel}末の見込み{" "}
          <span className="font-medium text-slate-700">
            {yen(single ? (single.values[lastIndex] ?? 0) : data.total[lastIndex])}
          </span>
        </p>
        <p className="text-xs text-slate-400">
          {single
            ? "予算は口座ごとに分かれていないため、先はこの口座の毎月の入出金から見込み"
            : budgetMonths === 0
              ? "予算がないため、先は毎月の入出金から見込み"
              : ruleMonths === 0
                ? `先の ${budgetMonths} か月は予算から見込み`
                : `先の ${budgetMonths} か月は予算、予算のない ${ruleMonths} か月は毎月の入出金から見込み`}
        </p>
      </div>
      <ValueLineChart
        months={data.months}
        currentKey={data.currentKey}
        series={[
          single
            ? {
                key: `a${single.id}`,
                label: "残高",
                color: SERIES_COLORS[0],
                values: single.values,
              }
            : { key: "total", label: "合計", color: SERIES_COLORS[0], values: data.total },
        ]}
        height={240}
      />
      {!single && (
        <>
          <h3 className="text-sm font-semibold text-slate-700 mt-6 mb-2">口座ごとの推移</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {data.accounts.map((a) => {
              return (
                <div key={a.id} className="rounded-lg border border-slate-100 p-3">
                  <p className="text-sm font-medium text-slate-800 mb-1">{a.name}</p>
                  <p className="text-xs text-slate-500 mb-1">
                    今の残高{" "}
                    <span className="font-medium text-slate-700 tabular-nums">
                      {yen(a.balance)}
                    </span>{" "}
                    ・ {lastLabel}末の見込み {yen(a.values[lastIndex] ?? 0)}
                  </p>
                  <ValueLineChart
                    months={data.months}
                    currentKey={data.currentKey}
                    series={[
                      { key: `a${a.id}`, label: "残高", color: SERIES_COLORS[0], values: a.values },
                    ]}
                    height={130}
                    compact
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
