"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { SETTINGS_HELP } from "@/lib/shared/help-texts";
import { PageHeader, Tabs } from "@/components/ui";
import {
  DisplayNameSection,
  FiscalPeriodSection,
  BusinessProfileSection,
} from "@/components/settings/ProfileSections";
import { TaxSettingsSection } from "@/components/settings/TaxSettingsSection";
import { IncomeTaxRulesSection } from "@/components/settings/IncomeTaxRulesSection";
import { SecuritySection } from "@/components/settings/SecuritySection";
import { AccountNamesSection } from "@/components/settings/AccountNamesSection";
import { BillingSection } from "@/components/settings/BillingSection";

// 各タブの中身は components/settings/ に置く
type Tab = "profile" | "tax" | "security" | "accountNames" | "billing";

// ── メインページ ─────────────────────────────────────────────────
const TABS: readonly (readonly [Tab, string])[] = [
  ["profile", "基本設定"],
  ["tax", "税制設定"],
  ["accountNames", "科目名設定"],
  ["security", "セキュリティ"],
  ["billing", "プランと支払い"],
];

function SettingsContent() {
  const searchParams = useSearchParams();
  // 他画面から ?tab=security のように開けるようにする（部門・担当のタブは削除した。古いリンクは基本設定へ）
  // （予算配分ルールと口座・カード管理は、それぞれ予算管理・銀行/カード管理へ移設した）
  const initialTab = TABS.some(([id]) => id === searchParams.get("tab"))
    ? (searchParams.get("tab") as Tab)
    : "profile";
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <AppShell>
      <PageHeader title="設定" lead={SETTINGS_HELP.page} />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "profile" && (
        <>
          <DisplayNameSection />
          <FiscalPeriodSection />
          <BusinessProfileSection />
        </>
      )}
      {tab === "tax" && (
        <>
          <TaxSettingsSection />
          <IncomeTaxRulesSection />
        </>
      )}
      {tab === "accountNames" && <AccountNamesSection />}
      {tab === "security" && <SecuritySection />}
      {tab === "billing" && <BillingSection />}
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SettingsContent />
    </Suspense>
  );
}
