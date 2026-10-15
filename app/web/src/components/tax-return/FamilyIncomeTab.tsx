"use client";

// 家族と所得: 本人の情報、給与・事業・その他の所得、家族ごとの控除の判定と「年収の壁」までの残り。

import { Plus, Trash2 } from "lucide-react";
import { yen } from "@/lib/common/format";
import { FAMILY_KIND_LABEL, type Disability, type FamilyMember } from "@/lib/shared/tax-family";
import { planSuffix, yearTotalLabel } from "@/lib/shared/tax-estimate";
import { SectionCard } from "@/components/SectionCard";
import { AmountField, Check, Field, LedgerAmountField, SelectField, YenInput } from "./fields";
import { PayrollCard } from "./PayrollCard";
import { DocumentUploads } from "./DocumentFiles";
import type { TabProps } from "./types";

const DISABILITY_OPTIONS = [
  ["none", "なし"],
  ["general", "障害者"],
  ["special", "特別障害者"],
  ["livingSpecial", "同居特別障害者"],
] as const satisfies readonly (readonly [Disability, string])[];

const RELATION_OPTIONS = [
  ["spouse", "配偶者"],
  ["child", "子"],
  ["parent", "親・祖父母"],
  ["other", "その他の親族"],
] as const satisfies readonly (readonly [FamilyMember["relation"], string])[];

function newMember(year: number): FamilyMember {
  return {
    id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    relation: "child",
    birthDate: `${year - 10}-04-01`,
    salary: 0,
    otherIncome: 0,
    livingTogether: true,
    disability: "none",
    dependentOfOther: false,
  };
}

/** 「その他の所得」のヒントに並べる帳簿の収入（0 円のものは出さない） */
function otherIncomeHint(ledger: TabProps["ledger"]): string {
  const sources = [
    ["副業収入", ledger.sideIncome],
    ["年金収入", ledger.pensionIncome],
    ["不動産所得", ledger.realEstateIncome],
    ["事業所得", ledger.householdBusinessIncome],
    ["仮想通貨売却益", ledger.cryptoIncome],
  ] as const;
  const shown = sources.filter(([, v]) => v !== 0).map(([label, v]) => `${label} ${yen(v)}`);
  return `副業・年金・不動産などの所得（収入 − 経費・控除）。帳簿の収入: ${
    shown.length > 0 ? shown.join("・") : "なし"
  }`;
}

export function FamilyIncomeTab(props: TabProps) {
  const { year, ledger, draft, estimate, update } = props;
  // 予定納税・報酬の源泉は、事業や給与以外の所得がある人の欄。値が入っていれば常に出す
  const showPrepaid =
    ledger.businessIncome !== null ||
    draft.otherIncome > 0 ||
    draft.prepaidTax > 0 ||
    draft.businessWithheld > 0;
  const salaryHint = (base: string) =>
    estimate.income.salaryAdjustment > 0
      ? `${base}（所得金額調整控除 ${yen(estimate.income.salaryAdjustment)} を引いた後）`
      : base;
  const setMember = (id: string, patch: Partial<FamilyMember>) =>
    update({ family: draft.family.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  return (
    <>
      <SectionCard title="本人" lead="年齢はその年の 12 月 31 日の時点で判定します。">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="生年月日" hint="住宅ローン控除の若者夫婦世帯の判定に使います">
            <input
              type="date"
              className="input-field"
              value={draft.selfBirthDate ?? ""}
              onChange={(e) => update({ selfBirthDate: e.target.value || null })}
            />
          </Field>
          <SelectField
            label="障害者控除"
            value={draft.selfDisability}
            options={DISABILITY_OPTIONS.filter(([v]) => v !== "livingSpecial")}
            onChange={(v) => update({ selfDisability: v })}
          />
          <SelectField
            label="寡婦・ひとり親"
            value={draft.selfStatus}
            options={[
              ["none", "当てはまらない"],
              ["widow", "寡婦"],
              ["singleParent", "ひとり親"],
            ]}
            onChange={(v) => update({ selfStatus: v })}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-6">
          <Check
            label="勤め先で年末調整を受ける"
            checked={draft.yearEndAdjusted}
            onChange={(v) => update({ yearEndAdjusted: v })}
          />
          <Check
            label="勤労学生"
            checked={draft.workingStudent}
            onChange={(v) => update({ workingStudent: v })}
          />
        </div>
        <DocumentUploads year={year} place="disability" documents={estimate.documents} />
      </SectionCard>

      <PayrollCard {...props} />

      <SectionCard
        title="所得"
        lead={
          estimate.payroll
            ? "給与収入と源泉徴収された所得税は、給与明細から出しています。"
            : "給与は額面（総支給）です。源泉徴収票が届いたら、その額で上書きすると正確になります。"
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          {estimate.payroll ? (
            <>
              <Field
                label={`給与収入${planSuffix(ledger.plan)}`}
                hint={salaryHint(`給与所得 ${yen(estimate.income.salaryIncome)}`)}
              >
                <div className="py-2 text-right font-semibold tabular-nums text-slate-900">
                  {yen(estimate.values.salary.value)}
                </div>
              </Field>
              <Field
                label={`源泉徴収された所得税${planSuffix(ledger.plan)}`}
                hint={`給与明細の所得税の${yearTotalLabel(ledger.plan)}`}
              >
                <div className="py-2 text-right font-semibold tabular-nums text-slate-900">
                  {yen(estimate.refund.salaryWithheld)}
                </div>
              </Field>
            </>
          ) : (
            <>
              <LedgerAmountField
                label="給与収入"
                value={draft.salary}
                ledger={ledger.salary}
                plan={ledger.plan}
                planned={ledger.planned.salary}
                onChange={(v) => update({ salary: v })}
                hint={salaryHint(
                  `給与所得 ${yen(estimate.income.salaryIncome)}（通勤手当は含めません）`,
                )}
              />
              <LedgerAmountField
                label="源泉徴収された所得税"
                value={draft.withheldTax}
                ledger={ledger.withheldTax}
                plan={ledger.plan}
                planned={ledger.planned.withheldTax}
                onChange={(v) => update({ withheldTax: v })}
                hint="年末調整の後の額（源泉徴収票の「源泉徴収税額」）"
              />
            </>
          )}
          <AmountField
            label="従たる給与の収入（2 か所目）"
            value={draft.secondarySalary}
            onChange={(v) => update({ secondarySalary: v })}
            hint="年末調整を受けない勤め先の給与（額面）。帳簿の給与に振込が入っている場合は、二重にならないよう給与収入を直してください"
          />
          <AmountField
            label="従たる給与の源泉徴収税額"
            value={draft.secondaryWithheld}
            onChange={(v) => update({ secondaryWithheld: v })}
            hint="2 か所目の源泉徴収票の「源泉徴収税額」"
          />
          <AmountField
            label="その他の所得"
            value={draft.otherIncome}
            onChange={(v) => update({ otherIncome: v })}
            hint={otherIncomeHint(ledger)}
          />
          {ledger.businessIncome !== null && (
            <>
              <LedgerAmountField
                label="事業の利益（決算）"
                value={draft.businessIncome}
                ledger={ledger.businessIncome}
                plan={ledger.plan}
                planned={ledger.planned.businessIncome}
                allowNegative
                onChange={(v) => update({ businessIncome: v })}
              />
              <LedgerAmountField
                label="青色申告特別控除"
                value={draft.blueReturnDeduction}
                ledger={ledger.blueReturnDeduction}
                onChange={(v) => update({ blueReturnDeduction: v })}
                hint={`事業所得 ${yen(estimate.income.business)}`}
              />
            </>
          )}
          {showPrepaid && (
            <>
              <AmountField
                label="報酬から源泉徴収された所得税"
                value={draft.businessWithheld}
                onChange={(v) => update({ businessWithheld: v })}
                hint="原稿料・デザイン料などの報酬・料金から差し引かれた所得税（支払調書・入金額で確認）"
              />
              <AmountField
                label="予定納税額（7 月・11 月）"
                value={draft.prepaidTax}
                onChange={(v) => update({ prepaidTax: v })}
                hint="税務署の通知書の第 1 期・第 2 期の合計（実際に納めたかに関わらず通知書の額）"
              />
            </>
          )}
        </div>
        {/* 給与明細を使うときは、源泉徴収票は給与明細のカードに出す */}
        {!estimate.payroll && (
          <DocumentUploads year={year} place="income" documents={estimate.documents} />
        )}
        <DocumentUploads year={year} place="business" documents={estimate.documents} />
      </SectionCard>

      <SectionCard
        title="家族"
        lead="配偶者・子・親などを入れると、配偶者控除・扶養控除・特定親族特別控除を自動で判定します。収入は給与なら額面です。"
        actions={
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => update({ family: [...draft.family, newMember(year)] })}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            家族を追加
          </button>
        }
      >
        {draft.family.length === 0 && (
          <p className="text-sm text-slate-500">家族はまだいません。</p>
        )}
        <div className="space-y-4">
          {draft.family.map((m) => {
            const j = estimate.family.members.find((x) => x.member.id === m.id);
            return (
              <div key={m.id} className="rounded-lg border border-slate-200 p-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="呼び名">
                    <input
                      className="input-field"
                      value={m.name}
                      maxLength={40}
                      placeholder="例: 長男"
                      onChange={(e) => setMember(m.id, { name: e.target.value })}
                    />
                  </Field>
                  <SelectField
                    label="続柄"
                    value={m.relation}
                    options={RELATION_OPTIONS}
                    onChange={(v) => setMember(m.id, { relation: v })}
                  />
                  <Field label="生年月日">
                    <input
                      type="date"
                      className="input-field"
                      value={m.birthDate}
                      onChange={(e) =>
                        e.target.value && setMember(m.id, { birthDate: e.target.value })
                      }
                    />
                  </Field>
                  <SelectField
                    label="障害"
                    value={m.disability}
                    options={DISABILITY_OPTIONS}
                    onChange={(v) => setMember(m.id, { disability: v })}
                  />
                  <Field label="給与収入（額面）">
                    <YenInput
                      value={m.salary || null}
                      placeholder="0"
                      onChange={(v) => setMember(m.id, { salary: v ?? 0 })}
                    />
                  </Field>
                  <Field label="給与以外の所得">
                    <YenInput
                      value={m.otherIncome || null}
                      placeholder="0"
                      onChange={(v) => setMember(m.id, { otherIncome: v ?? 0 })}
                    />
                  </Field>
                  <div className="space-y-2 md:col-span-2 md:pt-5">
                    <Check
                      label="同居している"
                      checked={m.livingTogether}
                      onChange={(v) => setMember(m.id, { livingTogether: v })}
                    />
                    <Check
                      label="共働きの相手など、ほかの人の扶養に入れる"
                      checked={m.dependentOfOther}
                      onChange={(v) => setMember(m.id, { dependentOfOther: v })}
                    />
                  </div>
                </div>
                {j && (
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
                    <div>
                      <span className="font-medium text-slate-800">
                        {j.age} 歳・所得 {yen(j.income)} → {FAMILY_KIND_LABEL[j.kind]}
                      </span>
                      {(j.incomeDeduction > 0 || j.disabilityIncome > 0) && (
                        <span className="ml-2 text-slate-600">
                          所得税 {yen(j.incomeDeduction + j.disabilityIncome)}・住民税{" "}
                          {yen(j.residentDeduction + j.disabilityResident)}
                        </span>
                      )}
                      <ul className="mt-1 text-xs text-slate-500">
                        {j.walls
                          .filter((w) => w.room >= 0)
                          .slice(0, 2)
                          .map((w) => (
                            <li key={w.label}>
                              {w.label}: 年収 {yen(w.salaryLimit)} まで（あと {yen(w.room)}）
                            </li>
                          ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      className="btn-outline-danger btn-sm"
                      onClick={() => update({ family: draft.family.filter((x) => x.id !== m.id) })}
                    >
                      <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                      削除
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}
