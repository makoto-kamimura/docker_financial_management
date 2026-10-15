"use client";

// ふるさと納税: 上限の目安・寄付済み・残り枠、ワンストップ特例が使えるか、制度の動き。

import { yen } from "@/lib/common/format";
import { yearGuideFor } from "@/lib/shared/tax-guide";
import { Notice } from "@/components/ui";
import { SectionCard } from "@/components/SectionCard";
import { Field, LedgerAmountField, StatTile } from "./fields";
import type { TabProps } from "./types";
import { DocumentUploads } from "./DocumentFiles";

export function FurusatoTab({ year, ledger, draft, estimate: e, update }: TabProps) {
  const f = e.furusato;
  const guide = yearGuideFor(year);
  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="上限の目安" value={yen(f.limit)} sub="自己負担 2,000 円で済む寄付額" />
        <StatTile label="寄付済み" value={yen(f.donated)} />
        <StatTile
          label="残り枠"
          value={yen(f.remaining)}
          tone="indigo"
          sub={`${year} 年 12 月 31 日まで`}
        />
      </div>

      <SectionCard
        title="寄付"
        lead="帳簿の「ふるさと納税」の科目に記帳すると自動で入ります。上限はこのページのすべての控除（住宅ローン控除・医療費控除など）を入れて計算しています。"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <LedgerAmountField
            label="今年の寄付額"
            value={draft.furusato}
            ledger={ledger.furusato}
            plan={ledger.plan}
            planned={ledger.planned.furusato}
            onChange={(v) => update({ furusato: v })}
          />
          <Field label="寄付先の自治体数" hint="同じ自治体への複数回の寄付は 1 と数えます">
            <input
              type="number"
              min={0}
              className="input-field"
              value={draft.furusatoMunicipalities}
              onChange={(ev) =>
                update({ furusatoMunicipalities: Math.max(0, Number(ev.target.value) || 0) })
              }
            />
          </Field>
        </div>
        <div className="mt-4 text-sm text-slate-700">
          {f.path === "oneStop" &&
            "ワンストップ特例を使う見込みです。控除は全額が翌年度の住民税から引かれます（所得税の還付はありません）。"}
          {f.path === "return" &&
            "確定申告で控除を受ける見込みです。所得税の還付と、翌年度の住民税からの控除に分かれます。"}
          {f.path === "none" &&
            (f.oneStopAvailable
              ? "確定申告をしなければ、寄付先が 5 自治体以内ならワンストップ特例を使えます。"
              : "")}
        </div>
        {f.warnings.map((w) => (
          <Notice key={w} tone="warn" className="mt-3">
            {w}
          </Notice>
        ))}
        <DocumentUploads year={year} place="deduction:donation" documents={e.documents} />
      </SectionCard>

      {guide && (
        <SectionCard
          title="制度の動き"
          lead={guide.year !== year ? `${guide.year} 年時点の内容です。` : undefined}
        >
          <dl className="space-y-3 text-sm text-slate-700">
            {guide.furusato.map((s) => (
              <div key={s.title}>
                <dt className="font-medium text-slate-800">{s.title}</dt>
                <dd className="mt-0.5">{s.body}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      )}
    </>
  );
}
