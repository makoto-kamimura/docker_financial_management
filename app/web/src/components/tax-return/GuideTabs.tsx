"use client";

// 今年の変更点と、やること・書類のタブ。

import { ExternalLink } from "lucide-react";
import { buildTodos, yearGuideFor } from "@/lib/shared/tax-guide";
import { Notice } from "@/components/ui";
import { SectionCard } from "@/components/SectionCard";
import { Check } from "./fields";
import { useTaxDocuments } from "./DocumentFiles";
import {
  documentStatus,
  isTaxDocumentId,
  TAX_DOCUMENTS,
  type TaxDocumentPlace,
} from "@/lib/shared/tax-documents";
import { TaxFormsCard } from "./TaxFormsCard";
import type { ActualsScope } from "@/lib/shared/business-use";
import type { TabProps } from "./types";

export function ChangesTab({ year }: TabProps) {
  const guide = yearGuideFor(year);
  if (!guide) {
    return <Notice tone="info">この年の変更点はまだ用意していません。</Notice>;
  }
  return (
    <>
      {guide.year !== year && (
        <Notice tone="warn" className="mb-6">
          {year} 年の変更点はまだ用意していません。{guide.year} 年の内容を出しています。
        </Notice>
      )}
      <SectionCard title={`${guide.year} 年分の主な変更点`}>
        <Sections items={guide.changes} />
      </SectionCard>
      <SectionCard title="この先に決まっている改正">
        <Sections items={guide.upcoming} />
      </SectionCard>
      <SectionCard title="出典">
        <ul className="space-y-1 text-sm">
          {guide.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
              >
                {s.label}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </SectionCard>
    </>
  );
}

function Sections({ items }: { items: { title: string; body: string }[] }) {
  return (
    <dl className="space-y-3 text-sm text-slate-700">
      {items.map((s) => (
        <div key={s.title}>
          <dt className="font-medium text-slate-800">{s.title}</dt>
          <dd className="mt-0.5">{s.body}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 書類の置き場所と、その入力欄があるタブ */
export type DocumentTab = "family" | "deductions" | "housing";
const PLACE_TAB: Record<TaxDocumentPlace, DocumentTab | null> = {
  income: "family",
  business: "family",
  disability: "family",
  "deduction:socialInsurance": "deductions",
  "deduction:smallBusinessMutualAid": "deductions",
  "deduction:lifeInsurance": "deductions",
  "deduction:earthquake": "deductions",
  "deduction:medical": "deductions",
  "deduction:casualty": "deductions",
  "deduction:donation": "deductions",
  housing: "housing",
  filing: null,
};
const TAB_LABEL: Record<DocumentTab, string> = {
  family: "家族と所得",
  deductions: "所得控除",
  housing: "住宅・税額控除",
};

export function TodoTab({
  year,
  draft,
  estimate,
  update,
  scope,
  dirty,
  onOpenTab,
}: TabProps & { scope: ActualsScope; dirty: boolean; onOpenTab: (tab: DocumentTab) => void }) {
  const todos = buildTodos(year, estimate);
  const files = useTaxDocuments(year);
  const status = new Map(
    documentStatus(
      estimate.documents,
      files.data?.documents ?? [],
      files.data?.selfMedicationReceipts.length ?? 0,
    ).map((s) => [s.id, s]),
  );
  const checked = new Set(draft.checks);
  const toggle = (id: string, on: boolean) =>
    update({
      checks: on
        ? [...draft.checks.filter((c) => c !== id), id]
        : draft.checks.filter((c) => c !== id),
    });
  return (
    <>
      <SectionCard title="やること" lead="チェックは「保存」で年ごとに残ります。">
        <ul className="space-y-3">
          {todos.map((t) => (
            <li key={t.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <Check
                  label={t.title}
                  checked={checked.has(`todo:${t.id}`)}
                  onChange={(v) => toggle(`todo:${t.id}`, v)}
                />
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {t.due.replaceAll("-", "/")} まで
                </span>
              </div>
              <p className="mt-1 pl-6 text-xs text-slate-600">{t.body}</p>
            </li>
          ))}
        </ul>
      </SectionCard>
      <TaxFormsCard year={year} scope={scope} dirty={dirty} />
      <SectionCard
        title="必要な書類"
        lead="入力した控除から、申告や年末調整で使う書類を出しています。届いた証明書は、それぞれの入力欄のそばで撮影・アップロードして残せます。"
      >
        {estimate.documents.length === 0 ? (
          <p className="text-sm text-slate-500">今の入力では、集める書類はありません。</p>
        ) : (
          <ul className="space-y-3">
            {estimate.documents.map((d) => {
              const st = status.get(d.id);
              const tab = isTaxDocumentId(d.id) ? PLACE_TAB[TAX_DOCUMENTS[d.id].place] : null;
              const kept = d.id === "selfMedicationStatement" ? "保存したレシート" : "保存済み";
              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <Check
                    label={d.label}
                    hint={d.why}
                    checked={checked.has(`doc:${d.id}`)}
                    onChange={(v) => toggle(`doc:${d.id}`, v)}
                  />
                  <div className="flex shrink-0 items-center gap-2">
                    {files.isLoading ? null : d.id === "myNumber" ? (
                      <span className="badge badge-slate">提出のときに用意（保存しません）</span>
                    ) : st && st.count > 0 ? (
                      <span className="badge badge-green">
                        {kept} {st.count} 枚
                      </span>
                    ) : (
                      <span className="badge badge-amber">未保存</span>
                    )}
                    {tab && (
                      <button
                        type="button"
                        className="text-xs text-indigo-600 hover:underline"
                        onClick={() => onOpenTab(tab)}
                      >
                        {TAB_LABEL[tab]}の入力欄へ
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {estimate.filing.willFile && (
          <a
            href="https://www.keisan.nta.go.jp/"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary btn-sm mt-4 inline-flex items-center gap-1"
          >
            確定申告書等作成コーナー（国税庁）
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </SectionCard>
    </>
  );
}
