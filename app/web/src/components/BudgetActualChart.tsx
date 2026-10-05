"use client";

// ダッシュボードの「予算と実績」グラフ。KPI の対象月の予算と実績の差を、科目ごとの横棒で見せる。
//   - 灰色の帯が予算、その上の細い棒が実績。帯の右端の縦線が予算の位置
//   - 実績の色は有利＝青・不利＝赤（発散配色。赤緑は色覚の違いで見分けにくいため使わない）、
//     予算 0 は灰色。色だけに頼らず、右に「余り／超過」などの
//     ラベルと矢印を出し、金額も文字で並べる（ツールチップだけで値を読ませない）
//   データは予算管理の「予実差確認」「予算の確定」と同じ GET /api/budgets/variance。整形は lib/budget-actual-chart.ts。

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead } from "@/components/Explain";
import { budgetConfirmHref } from "@/components/CycleSteps";
import { buildBudgetActualGroups, type BudgetActualBar } from "@/lib/budget-actual-chart";
import { nextYearMonth, type VarianceRow } from "@/lib/budget-cycle";
import { displayName, type ViewMode } from "@/lib/display-name";
import { DASHBOARD_HELP, textFor } from "@/lib/help-texts";

type Row = VarianceRow & { soleName: string | null; corporateName: string | null };

// 有利・不利の色（青⇔赤の発散配色。色覚シミュレーションで ΔE 23.8 を確認済み）。
// 予算 0 の科目は有利・不利を持たないので灰色
const COLOR_GOOD = "#2a78d6";
const COLOR_BAD = "#d03b3b";
const COLOR_NEUTRAL = "#64748b";

const yen = (v: number) => `¥${Math.round(v).toLocaleString("ja-JP")}`;

function stateOf(bar: BudgetActualBar, expense: boolean) {
  if (bar.favorable === null) {
    return { color: COLOR_NEUTRAL, label: bar.plan === 0 ? "予算なし" : "予算どおり", up: null };
  }
  const label = expense ? (bar.favorable ? "余り" : "超過") : bar.favorable ? "上振れ" : "不足";
  return { color: bar.favorable ? COLOR_GOOD : COLOR_BAD, label, up: bar.difference > 0 };
}

function BarRow({
  bar,
  expense,
  strong,
}: {
  bar: BudgetActualBar;
  expense: boolean;
  strong?: boolean;
}) {
  const state = stateOf(bar, expense);
  const pct = (r: number) => `${Math.min(r, 1) * 100}%`;
  return (
    <li
      className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)_13rem] items-center gap-x-3 gap-y-1 py-1.5"
      title={`${bar.label}：予算 ${yen(bar.plan)} / 実績 ${yen(bar.actual)}（差 ${bar.difference >= 0 ? "+" : "−"}${yen(Math.abs(bar.difference))}）`}
    >
      <span
        className={`text-xs truncate ${strong ? "font-semibold text-slate-800" : "text-slate-600"}`}
      >
        {bar.label}
      </span>
      {/* 予算の帯（灰色）と実績の棒。帯の右端に予算の位置の縦線 */}
      <div className="relative h-4" aria-hidden="true">
        <div
          className="absolute inset-y-0 left-0 rounded bg-slate-200"
          style={{ width: pct(bar.planRatio) }}
        />
        {bar.plan > 0 && (
          <div
            className="absolute -inset-y-0.5 w-0.5 bg-slate-700"
            style={{ left: `calc(${pct(bar.planRatio)} - 1px)` }}
          />
        )}
        <div
          className="absolute top-1 bottom-1 left-0 rounded"
          style={{ width: pct(bar.actualRatio), backgroundColor: state.color }}
        />
      </div>
      <div className="col-span-2 sm:col-span-1 flex items-baseline justify-end gap-2 text-xs tabular-nums">
        <span className="text-slate-800">{yen(bar.actual)}</span>
        <span className="text-slate-400">/ {yen(bar.plan)}</span>
        <span className="inline-flex items-center gap-0.5 min-w-[6.5rem] justify-end text-slate-600">
          {state.up !== null &&
            (state.up ? (
              <ArrowUp className="w-3 h-3" style={{ color: state.color }} aria-hidden="true" />
            ) : (
              <ArrowDown className="w-3 h-3" style={{ color: state.color }} aria-hidden="true" />
            ))}
          {state.label}
          {bar.difference !== 0 && bar.plan !== 0 && ` ${yen(Math.abs(bar.difference))}`}
        </span>
      </div>
    </li>
  );
}

export function BudgetActualChart({ mode, period }: { mode: ViewMode; period: string | null }) {
  const household = mode === "household";
  const [year, month] = (period ?? "").split("-").map(Number);
  const enabled = Number.isInteger(year) && Number.isInteger(month);

  const { data, isLoading } = useQuery({
    queryKey: ["budget-variance", year, month],
    queryFn: async (): Promise<{ rows: Row[] }> =>
      (await (await fetch(`/api/budgets/variance?year=${year}&month=${month}`)).json()).data,
    enabled,
    placeholderData: (prev) => prev,
  });

  if (!enabled) return null;

  // 差額の扱いは、翌月の予算案を作るときに選ぶ（予算の確定タブは予算の月で開く）
  const next = nextYearMonth(year, month);

  const rows = data?.rows ?? [];
  const groups = buildBudgetActualGroups(rows, (r) => displayName(r as Row, mode), {
    revenue: household ? "収入の合計" : "売上・収入の合計",
    expense: household ? "支出の合計" : "費用の合計",
  });
  const hasBudget = rows.some((r) => r.plan !== 0);

  return (
    <div className="card mb-6">
      <h2 className="section-title mb-1">
        予算と実績（{year}年{month}月）
      </h2>
      <SectionLead>{textFor(DASHBOARD_HELP.budgetActual, mode)}</SectionLead>

      {isLoading && !data && <LoadingSpinner />}

      {data && !hasBudget && (
        <p className="text-sm text-slate-500">
          {month}月の予算が未設定です。{" "}
          <Link href={"/budget" as never} className="underline text-indigo-600">
            予算管理で予算を入れる
          </Link>
        </p>
      )}

      {data && hasBudget && (
        <>
          {/* 凡例（予算は帯、実績は状態の色） */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 mb-2">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-4 h-2.5 rounded-sm bg-slate-200" />
              予算
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-4 h-1.5 rounded-sm"
                style={{ background: COLOR_GOOD }}
              />
              実績（予算内・上振れ）
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-4 h-1.5 rounded-sm"
                style={{ background: COLOR_BAD }}
              />
              実績（超過・不足）
            </span>
            <span className="ml-auto">実績 / 予算</span>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {groups.map((g) => (
              <section key={g.kind} aria-label={g.total.label}>
                <ul className="border-b border-slate-200 pb-1 mb-1">
                  <BarRow bar={g.total} expense={g.kind === "expense"} strong />
                </ul>
                <ul>
                  {g.items.map((b) => (
                    <BarRow
                      key={b.accountId ?? `other-${g.kind}`}
                      bar={b}
                      expense={g.kind === "expense"}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="text-[11px] text-slate-400 mt-3">
            差の大きい科目から並べています。差額の扱いと翌月の予算は、
            <Link href={budgetConfirmHref(next.year, next.month) as never} className="underline">
              予算管理の「予算の確定」
            </Link>
            で決めます。
          </p>
        </>
      )}
    </div>
  );
}
