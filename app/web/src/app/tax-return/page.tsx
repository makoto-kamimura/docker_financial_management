"use client";

// 控除・確定申告（家計・個人事業主モード）。年ごとに、帳簿の年合計を下書きにして所得控除・所得税・住民税・
// ふるさと納税の上限・確定申告の要否・必要書類を出す。入力を変えるとその場で計算し直し、「保存」で残す。
// 計算は lib/shared/tax-estimate.ts、制度の値は設定の「税制設定」（lib/shared/tax-rules.ts ＋上書き）。

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { ErrorBanner, LoadingSpinner } from "@/components/StateViews";
import { Notice, PageHeader, Tabs } from "@/components/ui";
import { useFiscalYear } from "@/lib/client/use-fiscal-year";
import { useActualsScope } from "@/lib/client/use-view-mode";
import { withScope } from "@/lib/shared/business-use";
import { TAX_RETURN_HELP } from "@/lib/shared/help-texts";
import { estimateTax, type TaxInputs } from "@/lib/shared/tax-estimate";
import type { TaxReturnPayload } from "@/components/tax-return/types";
import { OverviewTab } from "@/components/tax-return/OverviewTab";
import { FamilyIncomeTab } from "@/components/tax-return/FamilyIncomeTab";
import { DeductionsTab } from "@/components/tax-return/DeductionsTab";
import { HousingTab } from "@/components/tax-return/HousingTab";
import { FurusatoTab } from "@/components/tax-return/FurusatoTab";
import { ChangesTab, TodoTab } from "@/components/tax-return/GuideTabs";

type Tab = "overview" | "family" | "deductions" | "housing" | "furusato" | "changes" | "todo";

const TABS: readonly (readonly [Tab, string])[] = [
  ["overview", "概要"],
  ["family", "家族と所得"],
  ["deductions", "所得控除"],
  ["housing", "住宅・税額控除"],
  ["furusato", "ふるさと納税"],
  ["changes", "今年の変更点"],
  ["todo", "やること・書類"],
];

export default function TaxReturnPage() {
  const year = useFiscalYear();
  const scope = useActualsScope();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [draft, setDraft] = useState<TaxInputs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading, error } = useQuery<TaxReturnPayload>({
    queryKey: ["tax-return", year, scope],
    enabled: scope !== null,
    queryFn: async () => {
      const res = await fetch(withScope(`/api/tax-return?year=${year}`, scope!));
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "読み込みに失敗しました");
      return json.data;
    },
  });

  // 年を変えたとき・保存し直したときは、保存済みの入力から始める
  useEffect(() => {
    if (data) setDraft(data.inputs);
  }, [data]);

  const estimate = useMemo(
    () => (data && draft ? estimateTax(data.rules, data.year, data.ledger, draft) : null),
    [data, draft],
  );
  const dirty = !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.inputs);

  const update = (patch: Partial<TaxInputs>) => {
    setSaveMsg(null);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  async function save() {
    if (!draft || !data) return;
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch("/api/tax-return", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: data.year, inputs: draft }),
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg({ ok: true, text: "保存しました" });
      await qc.invalidateQueries({ queryKey: ["tax-return"] });
    } else {
      const json = await res.json().catch(() => ({}));
      setSaveMsg({ ok: false, text: json.error ?? "保存に失敗しました" });
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="控除・確定申告"
        lead={TAX_RETURN_HELP.page}
        showYear
        actions={
          <>
            {dirty && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => data && setDraft(data.inputs)}
              >
                元に戻す
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={!dirty || saving}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      />
      {saveMsg && (
        <Notice
          tone={saveMsg.ok ? "success" : "error"}
          className="mb-4"
          onClose={() => setSaveMsg(null)}
        >
          {saveMsg.text}
        </Notice>
      )}
      {isLoading || (data && !estimate) ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorBanner message={(error as Error).message} />
      ) : data && draft && estimate ? (
        <>
          {data.rulesInfo.fallback && (
            <Notice tone="warn" className="mb-4">
              {data.year} 年分の制度の値はまだ用意していないため、{data.rulesInfo.baseYear}{" "}
              年分の値で計算しています。改正があった場合は
              <Link href="/settings?tab=tax" className="mx-1 text-indigo-700 underline">
                設定の「税制設定」
              </Link>
              で値を直せます。
            </Notice>
          )}
          {!data.rulesInfo.fallback && data.rulesInfo.changed.length > 0 && (
            <Notice tone="info" className="mb-4">
              設定の「税制設定」で変えた値（{data.rulesInfo.changed.length} 項目）で計算しています。
            </Notice>
          )}
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          {(() => {
            const props = { year: data.year, ledger: data.ledger, draft, estimate, update };
            switch (tab) {
              case "overview":
                return <OverviewTab {...props} />;
              case "family":
                return <FamilyIncomeTab {...props} />;
              case "deductions":
                return <DeductionsTab {...props} />;
              case "housing":
                return <HousingTab {...props} />;
              case "furusato":
                return <FurusatoTab {...props} />;
              case "changes":
                return <ChangesTab {...props} />;
              case "todo":
                return (
                  <TodoTab
                    {...props}
                    scope={scope!}
                    dirty={dirty}
                    onOpenTab={(t) => {
                      setTab(t);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                );
            }
          })()}
        </>
      ) : null}
    </AppShell>
  );
}
