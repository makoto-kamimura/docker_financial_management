"use client";

import { useState } from "react";
import { BudgetActualChart } from "@/components/BudgetActualChart";
import { CycleStatusStrip } from "@/components/CycleStatusStrip";
import { KpiCards } from "@/components/KpiCards";
import { NetWorthSummaryCard } from "@/components/NetWorthSummaryCard";
import { LoanSummaryCard } from "@/components/LoanSummaryCard";
import { BankSummaryCard } from "@/components/BankSummaryCard";
import { PageHeader } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { SectionLead } from "@/components/Explain";
import { useViewMode } from "@/lib/client/use-view-mode";
import { DASHBOARD_HELP, textFor } from "@/lib/shared/help-texts";

// ダッシュボードは 予算と実績の確定の状況・KPI・総資産サマリ・総借入サマリ・口座残高サマリ・予算と実績のグラフの順に置く。
// どれも KPI カードで選んだ対象月の内容を出す（総資産サマリはその月末、今月なら今日の時点）。
// 確定の操作は予算管理（予算の確定）と実績管理（実績の確定）で行い、ここには状況とリンクだけ置く。
// ステップ進捗（はじめて使うときの 6 つの手順）は、いったん Web では出さない（モバイルアプリには残す）。
export default function DashboardPage() {
  const sysMode = useViewMode();
  // KPI カードで選んだ対象月。確定の状況・予算と実績のグラフ・総資産サマリもこの月を出す
  const [kpiPeriod, setKpiPeriod] = useState<string | null>(null);

  return (
    <AppShell>
      <PageHeader title="ダッシュボード" lead={textFor(DASHBOARD_HELP.page, sysMode)} showYear />

      {/* ── 予算と実績の確定の状況（いちばん上。KPI の対象月。操作は予算管理・実績管理で行う）──── */}
      <CycleStatusStrip period={kpiPeriod} />

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

      {/* ── 予算と実績（KPI の対象月の差をひと目で）──── */}
      <BudgetActualChart mode={sysMode} period={kpiPeriod} />
    </AppShell>
  );
}
