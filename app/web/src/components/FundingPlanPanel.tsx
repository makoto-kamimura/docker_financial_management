"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

// 資金繰り（必要残高と入金期限）。「銀行管理 › 資金移動」タブに表示する。
// 期首残高の手入力とシミュレーション実行ボタンは廃止し、現在残高と資金移動ルールから
// 常時自動で算出する。各口座の引き落とし予定を時系列に並べ、残高が足りなくなる日
// （＝この日までに預け入れないと処理されない日）と必要額をフロー表示する。

type FundingEvent = { date: string; label: string; amount: number; balanceAfter: number };
type FundingPlan = {
  accountId: number;
  accountName: string;
  opening: number;
  closing: number;
  minBalance: number;
  minBalanceDate: string | null;
  requiredDeposit: number;
  deadline: string | null;
  trigger: FundingEvent | null;
  events: FundingEvent[];
};
type FundingResponse = {
  year: number;
  month: number;
  months: number;
  accounts: { id: number; name: string; opening: number }[];
  plans: FundingPlan[];
};

const yen = (v: number) => `¥${Math.round(v).toLocaleString("ja-JP")}`;
const mmdd = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

type Props = { year: number; month: number; months?: number };

export function FundingPlanPanel({ year, month, months = 3 }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["funding-plan", year, month, months],
    queryFn: async (): Promise<FundingResponse> => {
      const res = await fetch(
        `/api/transfers/funding?year=${year}&month=${month}&months=${months}`,
      );
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  if (isLoading || !data) {
    return <div className="text-center text-sm text-slate-400 py-8">資金繰りを計算中…</div>;
  }

  const shortPlans = data.plans.filter((p) => p.requiredDeposit > 0);
  const activePlans = data.plans.filter((p) => p.events.length > 0);

  return (
    <>
      {/* ── 不足サマリ（いつまでにいくら預け入れが必要か）────────────── */}
      {shortPlans.length > 0 ? (
        <div className="card mb-4 border border-red-200 bg-red-50">
          <h3 className="section-title text-red-700 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            預け入れが必要な口座
          </h3>
          <ul className="space-y-3">
            {shortPlans.map((p) => (
              <li key={p.accountId} className="text-sm text-red-800">
                <p>
                  <strong>{p.accountName}</strong> は{" "}
                  <strong>{p.deadline ? mmdd(p.deadline) : ""}</strong> の
                  {p.trigger ? `「${p.trigger.label}」` : "引き落とし"}
                  までに <strong>{yen(Math.abs(p.trigger?.balanceAfter ?? 0))}</strong>{" "}
                  以上を預け入れないと引き落としできません。
                </p>
                <p className="text-xs text-red-700 mt-0.5">
                  {data.months}か月間で最も残高が減るのは
                  {p.minBalanceDate ? ` ${mmdd(p.minBalanceDate)} ` : ""}（{yen(p.minBalance)}
                  ）。この期間を通すには合計 <strong>{yen(p.requiredDeposit)}</strong>{" "}
                  の追加入金が必要です。
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="card mb-4 border border-green-200 bg-green-50">
          <p className="text-sm text-green-700 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            現在残高と資金移動の設定では、{data.months}か月間で残高不足は発生しません。
          </p>
        </div>
      )}

      {/* ── 口座ごとの入出金フロー（現在残高 → 各引き落とし → 残高）───── */}
      <div className="card mb-4">
        <h3 className="section-title mb-1">口座別の資金繰りフロー</h3>
        <p className="text-xs text-slate-400 mb-4">
          現在残高（明細の合計＋差額）を起点に、資金移動の設定から{data.year}年{data.month}月以降{" "}
          {data.months} か月分の予定を時系列に並べています。残高がマイナスになる予定は赤で示し、
          最初にマイナスになる予定が「預け入れの期限」です。
        </p>
        {activePlans.length === 0 ? (
          <p className="text-sm text-slate-400">
            資金移動が設定されていません。「振替」タブの資金移動スケジュールで毎月の入出金を登録すると表示されます。
          </p>
        ) : (
          <div className="space-y-5">
            {activePlans.map((p) => (
              <div key={p.accountId}>
                <div className="flex flex-wrap items-baseline gap-x-3 mb-2">
                  <span className="text-sm font-semibold text-slate-800">{p.accountName}</span>
                  <span className="text-xs text-slate-500">現在残高 {yen(p.opening)}</span>
                  <span className="text-xs text-slate-400">
                    → {data.months}か月後 {yen(p.closing)}
                  </span>
                  {p.requiredDeposit > 0 && (
                    <span className="text-xs font-medium text-red-600">
                      {p.deadline ? mmdd(p.deadline) : ""} までに {yen(p.requiredDeposit)}{" "}
                      の入金が必要
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <div className="flex items-stretch gap-1.5 min-w-max pb-1">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center min-w-28">
                      <p className="text-[10px] text-slate-400">現在</p>
                      <p className="text-xs font-medium text-slate-600">残高</p>
                      <p className="text-sm font-semibold text-slate-800 tabular-nums">
                        {yen(p.opening)}
                      </p>
                    </div>
                    {p.events.map((e, i) => {
                      const isTrigger = p.trigger !== null && p.events.indexOf(p.trigger) === i;
                      const negative = e.balanceAfter < 0;
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                          <div
                            className={`rounded-lg border px-3 py-2 text-center min-w-32 ${
                              negative
                                ? "border-red-300 bg-red-50"
                                : "border-slate-200 bg-white hover:border-indigo-300"
                            }`}
                          >
                            <p className="text-[10px] text-slate-400">{mmdd(e.date)}</p>
                            <p className="text-xs font-medium text-slate-700 truncate max-w-36">
                              {e.label}
                            </p>
                            <p
                              className={`text-xs tabular-nums ${e.amount < 0 ? "text-rose-600" : "text-emerald-600"}`}
                            >
                              {e.amount < 0 ? "−" : "+"}
                              {yen(Math.abs(e.amount))}
                            </p>
                            <p
                              className={`text-sm font-semibold tabular-nums ${negative ? "text-red-600" : "text-slate-800"}`}
                            >
                              {yen(e.balanceAfter)}
                            </p>
                            {isTrigger && (
                              <p className="mt-1 text-[10px] font-medium text-white bg-red-500 rounded px-1 py-0.5">
                                この日までに入金
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
