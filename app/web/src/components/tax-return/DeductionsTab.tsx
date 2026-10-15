"use client";

// 所得控除: 控除ごとのカード（所得税・住民税の控除額、入力欄、説明）。

import type { ReactNode } from "react";
import { yen } from "@/lib/common/format";
import { DEDUCTION_GUIDES, type DeductionGuide } from "@/lib/shared/tax-guide";
import { planSuffix } from "@/lib/shared/tax-estimate";
import { Notice } from "@/components/ui";
import { SectionCard } from "@/components/SectionCard";
import { AmountField, Check, Field, LedgerAmountField, TwoAmounts } from "./fields";
import { GuideDetails } from "./GuideDetails";
import { DocumentUploads, SelfMedicationReceiptsSection } from "./DocumentFiles";
import type { TaxDocumentPlace } from "@/lib/shared/tax-documents";
import type { TabProps } from "./types";

const FAMILY_KEYS = new Set([
  "spouse",
  "dependents",
  "specifiedRelative",
  "disability",
  "widow",
  "singleParent",
  "workingStudent",
]);

export function DeductionsTab(props: TabProps) {
  const { estimate: e } = props;
  const guides = DEDUCTION_GUIDES.filter((g) => g.type === "所得控除");
  return (
    <>
      <SectionCard title="所得控除の合計">
        <TwoAmounts income={e.deductionTotal.income} resident={e.deductionTotal.resident} />
        <p className="mt-2 text-xs text-slate-500">
          配偶者・扶養・障害者・寡婦・ひとり親・勤労学生は「家族と所得」のタブの入力から判定します。
        </p>
      </SectionCard>
      {guides.map((g) => {
        const line = e.deductions.find((d) => d.key === g.key);
        return (
          <SectionCard
            key={g.key}
            title={g.title}
            badge={line ? <span className="badge badge-green">対象</span> : undefined}
          >
            <TwoAmounts income={line?.income ?? 0} resident={line?.resident ?? 0} />
            <Inputs guide={g} {...props} />
            <DocumentUploads
              year={props.year}
              place={`deduction:${g.key}` as TaxDocumentPlace}
              documents={e.documents}
            />
            {g.key === "medical" && (
              <SelfMedicationReceiptsSection
                year={props.year}
                show={props.draft.selfMedicationEligible}
                onUseTotal={(total) => props.update({ selfMedication: total })}
              />
            )}
            {FAMILY_KEYS.has(g.key) && (
              <p className="mt-3 text-xs text-slate-500">入力は「家族と所得」のタブです。</p>
            )}
            <GuideDetails guide={g} />
          </SectionCard>
        );
      })}
    </>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="mt-4 grid gap-4 md:grid-cols-3">{children}</div>;
}

function Inputs({
  guide,
  ledger,
  draft,
  estimate: e,
  update,
}: TabProps & { guide: DeductionGuide }) {
  switch (guide.key) {
    case "socialInsurance":
      if (e.payroll) {
        const payroll = e.payroll;
        return (
          <Grid>
            <Field
              label={`給与からの天引き${planSuffix(ledger.plan)}`}
              hint="給与明細（家族と所得のタブ）の健康保険・介護保険・子ども・子育て支援金・厚生年金・雇用保険"
            >
              <div className="py-2 text-right font-semibold tabular-nums text-slate-900">
                {yen(payroll.social)}
              </div>
            </Field>
            <AmountField
              label="自分で払った社会保険料"
              value={draft.payroll.otherSocialInsurance}
              onChange={(v) => update({ payroll: { ...draft.payroll, otherSocialInsurance: v } })}
              hint="国民年金・国民健康保険、家族の分を払った場合など"
            />
          </Grid>
        );
      }
      return (
        <Grid>
          <LedgerAmountField
            label="支払った社会保険料"
            value={draft.socialInsurance}
            ledger={ledger.socialInsurance}
            plan={ledger.plan}
            planned={ledger.planned.socialInsurance}
            onChange={(v) => update({ socialInsurance: v })}
          />
        </Grid>
      );
    case "smallBusinessMutualAid":
      return (
        <Grid>
          <AmountField
            label="iDeCo・小規模企業共済の掛金"
            value={draft.smallBusinessMutualAid}
            onChange={(v) => update({ smallBusinessMutualAid: v })}
          />
        </Grid>
      );
    case "lifeInsurance":
      return (
        <>
          {e.family.hasDependentUnder23 && (
            <Notice tone="info" className="mt-3">
              23
              歳未満の扶養親族がいるため、一般生命保険料（新契約）の所得税の上限が広がる特例を当てています（制度がある年だけ）。
            </Notice>
          )}
          <Grid>
            <LedgerAmountField
              label="一般（新契約）"
              value={draft.lifeGeneralNew}
              ledger={ledger.lifeGeneral}
              plan={ledger.plan}
              planned={ledger.planned.lifeGeneral}
              onChange={(v) => update({ lifeGeneralNew: v })}
              hint={
                ledger.insuranceRefund > 0
                  ? `生命保険・学資保険から保険割戻金 ${yen(ledger.insuranceRefund)} を差し引いた額`
                  : undefined
              }
            />
            <AmountField
              label="一般（旧契約）"
              value={draft.lifeGeneralOld}
              onChange={(v) => update({ lifeGeneralOld: v })}
              hint="2011 年以前の契約"
            />
            <LedgerAmountField
              label="介護医療"
              value={draft.lifeCare}
              ledger={ledger.lifeCare}
              plan={ledger.plan}
              planned={ledger.planned.lifeCare}
              onChange={(v) => update({ lifeCare: v })}
            />
            <AmountField
              label="個人年金（新契約）"
              value={draft.lifePensionNew}
              onChange={(v) => update({ lifePensionNew: v })}
            />
            <AmountField
              label="個人年金（旧契約）"
              value={draft.lifePensionOld}
              onChange={(v) => update({ lifePensionOld: v })}
            />
          </Grid>
        </>
      );
    case "earthquake":
      return (
        <Grid>
          <AmountField
            label="地震保険料"
            value={draft.earthquake}
            onChange={(v) => update({ earthquake: v })}
            hint={`帳簿の火災保険・地震保険: ${yen(ledger.fireEarthquake)}（地震保険の分だけを入れてください）`}
          />
        </Grid>
      );
    case "medical":
      return (
        <>
          <Grid>
            <LedgerAmountField
              label="支払った医療費（家族の分も）"
              value={draft.medicalPaid}
              ledger={ledger.medical}
              plan={ledger.plan}
              planned={ledger.planned.medical}
              onChange={(v) => update({ medicalPaid: v })}
              hint="医療費＋医薬品費。治療のための市販薬は対象、ビタミン剤・予防の薬は除いてください"
            />
            <AmountField
              label="保険などで補填された額"
              value={draft.medicalReimbursed}
              onChange={(v) => update({ medicalReimbursed: v })}
            />
            <LedgerAmountField
              label="対象の市販薬の購入額"
              value={draft.selfMedication}
              ledger={ledger.selfMedication}
              plan={ledger.plan}
              planned={ledger.planned.selfMedication}
              onChange={(v) => update({ selfMedication: v })}
              hint="帳簿の医薬品費が下書きです。セルフメディケーション税制の対象（レシートに印があるもの）だけに直してください"
            />
          </Grid>
          <div className="mt-3">
            <Check
              label="健康診断・予防接種などを受けている（セルフメディケーション税制の条件）"
              checked={draft.selfMedicationEligible}
              onChange={(v) => update({ selfMedicationEligible: v })}
            />
          </div>
          <p className="mt-3 text-sm text-slate-700">
            医療費控除 {yen(e.medicalChoice.medical)}・セルフメディケーション税制{" "}
            {yen(e.medicalChoice.selfMedication)} →{" "}
            {e.medicalChoice.chosen === "none"
              ? "どちらも対象外です"
              : e.medicalChoice.chosen === "medical"
                ? "医療費控除が有利です"
                : "セルフメディケーション税制が有利です"}
          </p>
        </>
      );
    case "casualty":
      return (
        <Grid>
          <AmountField
            label="損害額"
            value={draft.casualtyLoss}
            onChange={(v) => update({ casualtyLoss: v })}
          />
          <AmountField
            label="保険などで補填された額"
            value={draft.casualtyReimbursed}
            onChange={(v) => update({ casualtyReimbursed: v })}
          />
          <AmountField
            label="うち災害関連支出"
            value={draft.casualtyDisaster}
            onChange={(v) => update({ casualtyDisaster: v })}
            hint="災害で壊れた住宅の取り壊し・除去の費用など"
          />
        </Grid>
      );
    case "donation":
      return (
        <Grid>
          <LedgerAmountField
            label="ふるさと納税"
            value={draft.furusato}
            ledger={ledger.furusato}
            plan={ledger.plan}
            planned={ledger.planned.furusato}
            onChange={(v) => update({ furusato: v })}
            hint="上限と残り枠は「ふるさと納税」のタブで"
          />
          <AmountField
            label="ふるさと納税以外の寄附（控除の対象）"
            value={draft.otherDonation}
            onChange={(v) => update({ otherDonation: v })}
            hint={`認定 NPO・公益法人・政党など。帳簿の寄付・募金: ${yen(ledger.otherDonation)}`}
          />
        </Grid>
      );
    default:
      return null;
  }
}
