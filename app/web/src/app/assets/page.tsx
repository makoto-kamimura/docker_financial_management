"use client";

import { AppShell } from "@/components/AppShell";
import { AssetTrendCharts } from "@/components/AssetTrendCharts";
import { PageHeader } from "@/components/ui";
import { ASSETS_HELP, textFor } from "@/lib/shared/help-texts";
import { useViewMode } from "@/lib/client/use-view-mode";
import { PersonalAssetsSection } from "@/components/assets/PersonalAssetsSection";

// 資産管理は「実物資産の評価額の推移」と「実物資産」の一覧。総資産サマリ（口座・借入金を含む純資産）は
// ダッシュボードへ移し、KPI の対象月の時点で出す（components/NetWorthSummaryCard.tsx）。
// ASSET / LIABILITY 科目の残高から作っていた KPI カードと純資産推移グラフは、家計モードでは科目側に
// 残高を積まないため常に 0 円になり、同じ数字は総資産サマリが実データから出しているため撤去済み。
export default function AssetsPage() {
  const sysMode = useViewMode();
  return (
    <AppShell>
      <PageHeader title="資産管理" lead={textFor(ASSETS_HELP.page, sysMode)} />

      <AssetTrendCharts />

      <PersonalAssetsSection />
    </AppShell>
  );
}
