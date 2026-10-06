"use client";

// 銀行管理「キャッシュフロー」タブの「残高の推移」（借入金管理の「借入残高の推移」と同じ形）。
// 上に日付つきの総残高と合計のグラフ、下に口座ごとの小さなグラフを並べる。今月より先は破線。
// 合計の先は予算と実績の収支から、口座ごとの先は毎月の入出金（資金移動ルールと借入の返済）から見込む
// （GET /api/bank-accounts/cash-outlook。計算は lib/cash-outlook.ts）。
// 口座の枠には、資金繰り（同じ月から 3 か月）で入金が必要と出た期限と金額も添える。

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
type FundingShort = { accountId: number; requiredDeposit: number; deadline: string | null };

const yen = (v: number) =>
  Math.abs(v) >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : `${Math.round(v).toLocaleString("ja-JP")}円`;
const mmdd = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

export function CashFlowTrendCharts({ year, month }: { year: number; month: number }) {
  const { data } = useQuery({
    queryKey: ["cash-outlook"],
    queryFn: async (): Promise<CashOutlookResponse> => {
      const res = await fetch("/api/bank-accounts/cash-outlook");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });
  // 資金繰りの表示と同じ問い合わせ（キャッシュを共有する）。入金が必要な口座の期限と金額に使う
  const { data: funding } = useQuery({
    queryKey: ["funding-plan", year, month, 3],
    queryFn: async (): Promise<{ plans: FundingShort[] }> => {
      const res = await fetch(`/api/transfers/funding?year=${year}&month=${month}&months=3`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  if (!data || data.accounts.length === 0) return null;

  const currentIndex = data.months.indexOf(data.currentKey);
  const todayTotal = data.accounts.reduce((s, a) => s + a.balance, 0);
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
          <p className="text-xs text-slate-500">総残高（{asOfDateLabel(new Date())}）</p>
          <p className="text-2xl font-bold text-indigo-600 tabular-nums">{yen(todayTotal)}</p>
        </div>
        <p className="text-xs text-slate-500">
          {lastLabel}末の見込み{" "}
          <span className="font-medium text-slate-700">{yen(data.total[lastIndex])}</span>
        </p>
        <p className="text-xs text-slate-400">
          {budgetMonths === 0
            ? "予算がないため、先は毎月の入出金から見込み"
            : ruleMonths === 0
              ? `先の ${budgetMonths} か月は予算から見込み`
              : `先の ${budgetMonths} か月は予算、予算のない ${ruleMonths} か月は毎月の入出金から見込み`}
        </p>
      </div>
      <ValueLineChart
        months={data.months}
        currentKey={data.currentKey}
        series={[{ key: "total", label: "合計", color: SERIES_COLORS[0], values: data.total }]}
        height={240}
      />

      <h3 className="text-sm font-semibold text-slate-700 mt-6 mb-2">口座ごとの推移</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {data.accounts.map((a) => {
          const short = funding?.plans.find((p) => p.accountId === a.id && p.requiredDeposit > 0);
          return (
            <div key={a.id} className="rounded-lg border border-slate-100 p-3">
              <p className="text-sm font-medium text-slate-800 mb-1">{a.name}</p>
              <p className="text-xs text-slate-500 mb-1">
                今の残高{" "}
                <span className="font-medium text-slate-700 tabular-nums">{yen(a.balance)}</span> ・{" "}
                {lastLabel}末の見込み {yen(a.values[lastIndex] ?? 0)}
              </p>
              {short && (
                <p className="text-xs font-medium text-red-600 mb-1">
                  {short.deadline ? `${mmdd(short.deadline)} までに` : ""}
                  {yen(short.requiredDeposit)} の入金が必要
                </p>
              )}
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
    </section>
  );
}
