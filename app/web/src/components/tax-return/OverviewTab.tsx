"use client";

// 概要: 所得・控除・税額・還付の見込み、ふるさと納税の残り枠、確定申告の要否、基本の考え方。

import { yen, yenAbs } from "@/lib/common/format";
import { TAX_BASICS, TAX_GUIDE_DISCLAIMER } from "@/lib/shared/tax-guide";
import { planNote, planSuffix } from "@/lib/shared/tax-estimate";
import { Notice } from "@/components/ui";
import { SectionCard } from "@/components/SectionCard";
import { StatTile } from "./fields";
import type { TabProps } from "./types";

export function OverviewTab({ year, ledger, estimate: e }: TabProps) {
  const note = planNote(year, ledger.plan);
  const refund = e.refund.amount;
  // 給与があるのに源泉徴収税額が入っていなければ、還付・追加納付は出さない（年末調整済みなら差はほぼ 0）
  const withheldUnknown = e.income.salary > 0 && e.refund.salaryWithheld === 0;
  return (
    <>
      {note && (
        <Notice tone="info" className="mb-4">
          {note}
          税額・還付・ふるさと納税の上限は、予定を含めた見込みです。
        </Notice>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label={`合計所得${planSuffix(ledger.plan)}`}
          value={yen(e.income.total)}
          sub={`給与所得 ${yen(e.income.salaryIncome)}`}
        />
        <StatTile
          label="所得控除（所得税）"
          value={yen(e.deductionTotal.income)}
          sub={`住民税 ${yen(e.deductionTotal.resident)}`}
        />
        <StatTile
          label="課税所得（所得税）"
          value={yen(e.taxable.income)}
          sub={`税率 ${Math.round(e.incomeTax.rate * 100)}%`}
        />
        <StatTile
          label={`${year} 年分の所得税（見込み）`}
          value={yen(e.incomeTax.total)}
          sub="復興特別所得税を含む"
        />
        {withheldUnknown ? (
          <StatTile
            label="還付の見込み"
            value="—"
            sub="源泉徴収された所得税を入れると出ます（家族と所得のタブ）"
          />
        ) : (
          <StatTile
            label={refund >= 0 ? "還付の見込み" : "追加で納める見込み"}
            value={yenAbs(refund)}
            tone={refund >= 0 ? "green" : "red"}
            sub={
              e.refund.prepaid > 0
                ? `源泉徴収済み ${yen(e.refund.withheld)}・予定納税 ${yen(e.refund.prepaid)}`
                : `源泉徴収済み ${yen(e.refund.withheld)}`
            }
          />
        )}
        <StatTile
          label={`${year + 1} 年度の住民税（見込み）`}
          value={yen(e.resident.total)}
          sub={
            e.resident.nonTaxable
              ? "非課税の見込み"
              : e.payroll && e.payroll.resident.withheldThisYear > 0
                ? `月額の目安 ${yen(e.payroll.resident.nextMonthly)}（今年の天引き ${yen(e.payroll.resident.withheldThisYear)}）`
                : `均等割 ${yen(e.resident.perCapita)} を含む`
          }
        />
        <StatTile
          label="ふるさと納税の残り枠"
          value={yen(e.furusato.remaining)}
          tone="indigo"
          sub={`上限の目安 ${yen(e.furusato.limit)}`}
        />
      </div>

      <SectionCard
        title="確定申告"
        badge={
          e.filing.willFile ? (
            <span className="badge badge-amber">申告する</span>
          ) : (
            <span className="badge badge-green">申告不要の見込み</span>
          )
        }
      >
        {e.filing.required.length > 0 && (
          <div className="mb-3">
            <div className="text-sm font-medium text-slate-700">申告が必要な理由</div>
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
              {e.filing.required.map((r) => (
                <li key={r.key}>{r.label}</li>
              ))}
            </ul>
          </div>
        )}
        {e.filing.beneficial.length > 0 && (
          <div className="mb-3">
            <div className="text-sm font-medium text-slate-700">
              申告すると税金が戻る（減る）もの
            </div>
            <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
              {e.filing.beneficial.map((r) => (
                <li key={r.key}>{r.label}</li>
              ))}
            </ul>
          </div>
        )}
        {!e.filing.willFile && (
          <p className="text-sm text-slate-700">
            {e.income.salary > 0
              ? "年末調整で済む見込みです。ふるさと納税は、寄付先が 5 自治体以内ならワンストップ特例を使えます。"
              : "確定申告は要らない見込みです。"}
          </p>
        )}
        {e.notes.map((n) => (
          <Notice key={n} tone="warn" className="mt-3">
            {n}
          </Notice>
        ))}
      </SectionCard>

      <SectionCard title="基本の考え方">
        <dl className="space-y-3 text-sm text-slate-700">
          {TAX_BASICS.map((b) => (
            <div key={b.title}>
              <dt className="font-medium text-slate-800">{b.title}</dt>
              <dd className="mt-0.5">{b.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-slate-500">{TAX_GUIDE_DISCLAIMER}</p>
      </SectionCard>
    </>
  );
}
