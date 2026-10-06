"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BudgetActualChart } from "@/components/BudgetActualChart";
import { CycleStatusStrip } from "@/components/CycleStatusStrip";
import { KpiCards } from "@/components/KpiCards";
import { NetWorthSummaryCard } from "@/components/NetWorthSummaryCard";
import { LoanSummaryCard } from "@/components/LoanSummaryCard";
import { BankSummaryCard } from "@/components/BankSummaryCard";
import { PageHeader } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { SectionLead } from "@/components/Explain";
import { useViewMode, hasSwitchedViewMode } from "@/lib/use-view-mode";
import { computeStepChecklist } from "@/lib/step-checklist";
import { DASHBOARD_HELP, textFor } from "@/lib/help-texts";

// F-10: ステップ進捗チェックリスト。全ステップ達成後は非表示にする（オンボーディング用途）。
function StepChecklistCard() {
  const { data } = useQuery({
    queryKey: ["onboarding-steps"],
    queryFn: async () => {
      const res = await fetch("/api/onboarding/steps");
      const json = await res.json();
      return json.data as {
        hasIncomeBudget: boolean;
        hasExpenseBudget: boolean;
        hasBankAccount: boolean;
        hasPersonalAsset: boolean;
        hasLoan: boolean;
      };
    },
  });
  const [hasSwitchedMode, setHasSwitchedMode] = useState(false);

  useEffect(() => {
    setHasSwitchedMode(hasSwitchedViewMode());
    const handler = () => setHasSwitchedMode(hasSwitchedViewMode());
    window.addEventListener("viewmode-change", handler);
    return () => window.removeEventListener("viewmode-change", handler);
  }, []);

  if (!data) return null;
  const items = computeStepChecklist({ ...data, hasSwitchedMode });
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <div className="card mb-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-1">
        ステップ進捗（{doneCount} / {items.length}）
      </h2>
      <SectionLead>{DASHBOARD_HELP.steps}</SectionLead>
      <ol className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {items.map((i) => (
          <li
            key={i.step}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              i.done ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-500"
            }`}
          >
            <span aria-hidden="true">{i.done ? "✅" : "⬜"}</span>
            <span>{i.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ダッシュボードは KPI・総資産サマリ・総借入サマリ・予算と実績の確定の状況・予算と実績のグラフの順に置く。
// どれも KPI カードで選んだ対象月の内容を出す（総資産サマリはその月末、今月なら今日の時点）。
// 確定の操作は予算管理（予算の確定）と実績管理（実績の確定）で行い、ここには状況とリンクだけ置く。
export default function DashboardPage() {
  const sysMode = useViewMode();
  // KPI カードで選んだ対象月。確定の状況・予算と実績のグラフ・総資産サマリもこの月を出す
  const [kpiPeriod, setKpiPeriod] = useState<string | null>(null);

  return (
    <AppShell>
      <PageHeader title="ダッシュボード" lead={textFor(DASHBOARD_HELP.page, sysMode)} showYear />

      <StepChecklistCard />

      <div className="card mb-6">
        <SectionLead>{textFor(DASHBOARD_HELP.kpi, sysMode)}</SectionLead>
        <KpiCards mode={sysMode} onPeriodChange={setKpiPeriod} />
      </div>

      {/* ── 総資産サマリ（KPI の対象月の時点。内訳と推移は資産管理）──── */}
      <NetWorthSummaryCard period={kpiPeriod} />

      {/* ── 総借入サマリ（KPI の対象月の時点。借入ごとの内訳は借入金管理）──── */}
      <LoanSummaryCard period={kpiPeriod} />

      {/* ── 口座残高サマリ（KPI の対象月の時点。口座の管理と推移は銀行管理）──── */}
      <BankSummaryCard period={kpiPeriod} />

      {/* ── 予算と実績の確定の状況（KPI の対象月。操作は予算管理・実績管理で行う）──── */}
      <CycleStatusStrip period={kpiPeriod} />

      {/* ── 予算と実績（KPI の対象月の差をひと目で）──── */}
      <BudgetActualChart mode={sysMode} period={kpiPeriod} />
    </AppShell>
  );
}
