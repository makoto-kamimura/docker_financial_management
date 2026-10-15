"use client";

// 申告書の転記用 PDF（/api/tax-return/forms）。保存した入力で、要る申告書だけを出す（ほかの申告書も表示できる）。
// 「確認」は新しいタブで開き、「ダウンロード」は保存する。

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import { withScope, type ActualsScope } from "@/lib/shared/business-use";
import { Notice } from "@/components/ui";
import { SectionCard } from "@/components/SectionCard";

type FormItem = {
  key: string;
  title: string;
  group: string;
  needed: boolean;
  why: string;
  pageCount: number;
};

export function TaxFormsCard({
  year,
  scope,
  dirty,
}: {
  year: number;
  scope: ActualsScope;
  dirty: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  // 保存すると ["tax-return"] を読み直すので、その下に置いて一緒に読み直す
  const { data, isLoading, error } = useQuery({
    queryKey: ["tax-return", "forms", year, scope],
    queryFn: async (): Promise<FormItem[]> => {
      const res = await fetch(withScope(`/api/tax-return/forms?year=${year}`, scope));
      if (!res.ok) throw new Error("申告書の一覧を読み込めませんでした");
      return (await res.json()).data;
    },
  });
  const forms = (data ?? []).filter((f) => showAll || f.needed);
  const url = (key: string, download: boolean) =>
    withScope(`/api/tax-return/forms/${key}?year=${year}${download ? "&download=1" : ""}`, scope);

  return (
    <SectionCard
      title="申告書（転記用 PDF）"
      lead="入力した値を、申告書の欄の番号・名前の順に並べた下書きです。確定申告書等作成コーナーや紙の様式に書き写すときに使います。"
      actions={
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          要らない申告書も表示
        </label>
      }
    >
      {dirty && (
        <Notice tone="warn" className="mb-3">
          保存していない変更があります。PDF は保存した入力で作るので、先に「保存」してください。
        </Notice>
      )}
      {isLoading ? (
        <p className="text-sm text-slate-500">読み込み中…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{(error as Error).message}</p>
      ) : forms.length === 0 ? (
        <p className="text-sm text-slate-500">今の入力では、要る申告書はありません。</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {forms.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800">
                  <span className="mr-2 text-xs text-slate-500">{f.group}</span>
                  {f.title}
                  {f.pageCount > 1 && (
                    <span className="ml-1 text-xs text-slate-500">（{f.pageCount} 枚）</span>
                  )}
                </div>
                <div className={`text-xs ${f.needed ? "text-slate-500" : "text-slate-400"}`}>
                  {f.why}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <a
                  href={url(f.key, false)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary btn-sm inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  確認
                </a>
                <a
                  href={url(f.key, true)}
                  className="btn-secondary btn-sm inline-flex items-center gap-1"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  ダウンロード
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
