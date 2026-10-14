"use client";

// 控除の説明（tax-guide.ts の DEDUCTION_GUIDES）を折りたたんで出す。

import type { DeductionGuide } from "@/lib/shared/tax-guide";

export function GuideDetails({ guide }: { guide: DeductionGuide }) {
  return (
    <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <summary className="cursor-pointer select-none text-indigo-700">この控除について</summary>
      <dl className="mt-2 space-y-2">
        <Item term="概要">{guide.summary}</Item>
        <Item term="対象になる人">{guide.who}</Item>
        <Item term="計算のしかた">{guide.calc}</Item>
        <Item term="手続き">{guide.procedure}</Item>
        {guide.documents.length > 0 && <Item term="必要な書類">{guide.documents.join("、")}</Item>}
        {guide.ledger && <Item term="下書きに使う科目">{guide.ledger}</Item>}
      </dl>
    </details>
  );
}

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}
