"use client";

// 住宅・税額控除: 住宅ローン控除の計算、その他の税額控除、計算しない制度の説明。

import { yen } from "@/lib/common/format";
import { DEDUCTION_GUIDES, NOT_COVERED } from "@/lib/shared/tax-guide";
import type { HousingLoanInput } from "@/lib/shared/tax-estimate";
import { Notice } from "@/components/ui";
import { SectionCard } from "@/components/SectionCard";
import {
  AmountField,
  Check,
  Field,
  LedgerAmountField,
  SelectField,
  StatTile,
  YenInput,
} from "./fields";
import { GuideDetails } from "./GuideDetails";
import type { TabProps } from "./types";

const HOUSING_GUIDE = DEDUCTION_GUIDES.find((g) => g.key === "housingLoan")!;
const OTHER_CREDIT_GUIDE = DEDUCTION_GUIDES.find((g) => g.key === "otherTaxCredit")!;

export function HousingTab({ ledger, draft, estimate: e, update }: TabProps) {
  const h = draft.housingLoan;
  const setLoan = (patch: Partial<HousingLoanInput>) => update({ housingLoan: { ...h, ...patch } });
  const r = e.housing;
  return (
    <>
      <SectionCard
        title={HOUSING_GUIDE.title}
        lead="住宅ローンの年末残高の 0.7% を、所得税（引ききれない分は住民税）から差し引きます。"
      >
        <Check
          label="住宅ローン控除を受ける"
          checked={h.enabled}
          onChange={(v) => setLoan({ enabled: v })}
        />
        {h.enabled && (
          <>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="入居した年">
                <input
                  type="number"
                  className="input-field"
                  min={1990}
                  max={2100}
                  value={h.movedInYear}
                  onChange={(ev) =>
                    setLoan({ movedInYear: Number(ev.target.value) || h.movedInYear })
                  }
                />
              </Field>
              <SelectField
                label="新築か既存（中古）か"
                value={h.build}
                options={[
                  ["new", "新築・買取再販"],
                  ["used", "既存住宅"],
                ]}
                onChange={(v) => setLoan({ build: v })}
              />
              <SelectField
                label="省エネ性能"
                value={h.energy}
                options={[
                  ["certified", "認定住宅（長期優良・低炭素）"],
                  ["zeh", "ZEH 水準省エネ住宅"],
                  ["energy", "省エネ基準適合住宅"],
                  ["other", "その他"],
                ]}
                onChange={(v) => setLoan({ energy: v })}
              />
              <LedgerAmountField
                label="年末残高"
                value={h.balance}
                ledger={ledger.housingBalance}
                onChange={(v) => setLoan({ balance: v })}
                hint={
                  ledger.housingBalance === null
                    ? "借入金管理に住宅ローンを登録すると、年末の残高を自動で入れます"
                    : "借入金管理の住宅ローンの 12/31 時点の見込み。年末残高等証明書の額で上書きしてください"
                }
              />
              <Field label="控除額を直接入れる" hint="2021 年以前の入居など、表で出せない場合だけ">
                <YenInput
                  value={h.creditOverride}
                  placeholder="表から計算"
                  onChange={(v) => setLoan({ creditOverride: v })}
                />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-6">
              <Check
                label="今年が入居した年の分（初年度）"
                checked={h.firstYear}
                onChange={(v) => setLoan({ firstYear: v })}
                hint="初年度は確定申告が必要です"
              />
              <Check
                label="床面積 40㎡ 以上 50㎡ 未満"
                checked={h.smallFloor}
                onChange={(v) => setLoan({ smallFloor: v })}
              />
            </div>
            {r && (
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile
                  label="控除額（所得税の分）"
                  value={yen(r.credit)}
                  tone={r.eligible ? "green" : "slate"}
                />
                <StatTile
                  label="借入限度額"
                  value={r.limit > 0 ? yen(r.limit) : "—"}
                  sub={r.special ? "子育て・若者夫婦世帯" : undefined}
                />
                <StatTile
                  label="控除期間"
                  value={r.years > 0 ? `${r.yearIndex} / ${r.years} 年目` : "—"}
                />
                <StatTile
                  label="住民税から引く分"
                  value={yen(e.resident.housingCredit)}
                  sub="所得税から引ききれない分"
                />
              </div>
            )}
            {r?.reason && (
              <Notice tone="warn" className="mt-3">
                {r.reason}
              </Notice>
            )}
          </>
        )}
        <GuideDetails guide={HOUSING_GUIDE} />
      </SectionCard>

      <SectionCard title={OTHER_CREDIT_GUIDE.title}>
        <div className="grid gap-4 md:grid-cols-3">
          <AmountField
            label="税額控除の額"
            value={draft.otherTaxCredit}
            onChange={(v) => update({ otherTaxCredit: v })}
          />
        </div>
        <GuideDetails guide={OTHER_CREDIT_GUIDE} />
      </SectionCard>

      <SectionCard title="このページで計算しないもの">
        <dl className="space-y-3 text-sm text-slate-700">
          {NOT_COVERED.map((n) => (
            <div key={n.title}>
              <dt className="font-medium text-slate-800">{n.title}</dt>
              <dd className="mt-0.5">{n.body}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>
    </>
  );
}
