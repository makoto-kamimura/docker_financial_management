"use client";

// 給与明細: 口座には手取りしか入らないので、総支給と天引き（社会保険料・所得税・住民税など）を入れて、
// 額面・社会保険料控除・源泉徴収税額を出す。項目ごとに「月額 × 月数 ＋ 賞与」、年合計を直接入れてもよい。
// 確定申告の見込みは予定を含むので、入力月以降を含む年は「予定年合計」「（予定）」と書く。

import { yen } from "@/lib/common/format";
import {
  payrollTotal,
  planNote,
  planSuffix,
  yearTotalLabel,
  type PayrollInput,
  type PayrollItem,
  type PayrollItemKey,
} from "@/lib/shared/tax-estimate";
import { Notice } from "@/components/ui";
import { SectionCard } from "@/components/SectionCard";
import { Check, LedgerAmountField, SelectField, YenInput } from "./fields";
import type { TabProps } from "./types";

const ROWS: readonly { key: PayrollItemKey; label: string; hint?: string }[] = [
  { key: "gross", label: "総支給額", hint: "空欄なら手取り ＋ 天引きの合計で出します" },
  { key: "commute", label: "通勤手当", hint: "非課税なので給与収入から除きます" },
  { key: "health", label: "健康保険料" },
  { key: "care", label: "介護保険料", hint: "40〜64 歳" },
  {
    key: "childSupport",
    label: "子ども・子育て支援金",
    hint: "2026 年 4 月分（5 月の給与）から。2026 年は 8 か月",
  },
  { key: "pension", label: "厚生年金保険料" },
  { key: "employment", label: "雇用保険料" },
  {
    key: "incomeTax",
    label: "所得税",
    hint: "年末調整の後は源泉徴収票の「源泉徴収税額」で年合計を上書き",
  },
  { key: "residentTax", label: "住民税", hint: "前年の所得の分（6 月〜翌 5 月）" },
  {
    key: "other",
    label: "その他の天引き",
    hint: "財形・組合費・社員持株会など（控除になりません）",
  },
];

const DEDUCTION_START = 2;

export function PayrollCard({ year, ledger, draft, estimate: e, update }: TabProps) {
  const p = draft.payroll;
  const r = e.payroll;
  const totalLabel = yearTotalLabel(ledger.plan);
  const sfx = planSuffix(ledger.plan);
  const note = planNote(year, ledger.plan);
  const set = (patch: Partial<PayrollInput>) => update({ payroll: { ...p, ...patch } });
  const setItem = (key: PayrollItemKey, patch: Partial<PayrollItem>) =>
    set({ [key]: { ...p[key], ...patch } });

  return (
    <SectionCard
      title={`給与明細（${totalLabel}）`}
      lead="口座には手取りしか入らないため、給与明細の天引きを入れると額面・社会保険料控除・源泉徴収税額を出します。賞与は年の合計です。"
    >
      <Check
        label="給与明細の内訳から計算する"
        checked={p.enabled}
        onChange={(v) => set({ enabled: v })}
        hint="使う間は、所得の「給与収入」「源泉徴収された所得税」と所得控除の「社会保険料」をここから出します"
      />
      {p.enabled && r && (
        <>
          {note && (
            <Notice tone="info" className="mt-4">
              {note}
              月額 × 月数・賞与もまだ支給されていない月の分を含めて入れてください。
            </Notice>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <SelectField
              label="帳簿の給与（口座への振込）は"
              value={p.ledgerSalaryIs}
              options={[
                ["takeHome", "手取り"],
                ["gross", "額面（給与明細の内訳も帳簿に入れている）"],
              ]}
              onChange={(v) => set({ ledgerSalaryIs: v })}
            />
            {p.ledgerSalaryIs === "takeHome" && (
              <LedgerAmountField
                label={`手取りの振込額${sfx}`}
                value={p.takeHome}
                ledger={ledger.salaryDeposit}
                plan={ledger.plan}
                planned={ledger.planned.salaryDeposit}
                onChange={(v) => set({ takeHome: v })}
                hint="給与・賞与・各種手当の科目の年合計"
              />
            )}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            賞与からの天引き（健康保険・厚生年金・雇用保険・所得税など）も、各行の「賞与」に入れてください。
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">項目</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    月額
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    月数
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    賞与
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    {totalLabel}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ROWS.map((row, i) => {
                  const item = p[row.key];
                  const computed = payrollTotal({ ...item, annual: null });
                  return (
                    <tr
                      key={row.key}
                      className={i === DEDUCTION_START ? "border-t-2 border-slate-200" : undefined}
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-slate-800">{row.label}</div>
                        {row.hint && <div className="text-xs text-slate-500">{row.hint}</div>}
                      </td>
                      <td className="w-36 px-3 py-2 align-top">
                        <YenInput
                          ariaLabel={`${row.label}の月額`}
                          value={item.monthly || null}
                          placeholder="0"
                          onChange={(v) => setItem(row.key, { monthly: v ?? 0 })}
                        />
                      </td>
                      <td className="w-20 px-3 py-2 align-top">
                        <input
                          type="number"
                          min={0}
                          max={12}
                          aria-label={`${row.label}の月数`}
                          className="input-field text-right tabular-nums"
                          value={item.months}
                          onChange={(ev) =>
                            setItem(row.key, {
                              months: Math.min(
                                12,
                                Math.max(0, Math.trunc(Number(ev.target.value) || 0)),
                              ),
                            })
                          }
                        />
                      </td>
                      <td className="w-36 px-3 py-2 align-top">
                        <YenInput
                          ariaLabel={`${row.label}の賞与`}
                          value={item.bonus || null}
                          placeholder="0"
                          onChange={(v) => setItem(row.key, { bonus: v ?? 0 })}
                        />
                      </td>
                      <td className="w-40 px-3 py-2 align-top">
                        <YenInput
                          ariaLabel={`${row.label}の${totalLabel}`}
                          value={item.annual}
                          placeholder={computed.toLocaleString("ja-JP")}
                          onChange={(v) => setItem(row.key, { annual: v })}
                        />
                        {item.annual !== null && (
                          <button
                            type="button"
                            className="mt-1 text-xs text-indigo-600 hover:underline"
                            onClick={() => setItem(row.key, { annual: null })}
                          >
                            月額から出す（{yen(computed)}）
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row
              label={`総支給額${sfx}`}
              value={yen(r.gross)}
              note={
                r.grossSource === "takeHome"
                  ? "手取り ＋ 天引きの合計"
                  : r.grossSource === "ledger"
                    ? "帳簿の給与 ＋ 通勤手当"
                    : undefined
              }
            />
            <Row label={`給与収入${sfx}`} value={yen(r.taxableSalary)} note="通勤手当を除く" />
            <Row label={`給与所得${sfx}`} value={yen(e.income.salaryIncome)} />
            <Row
              label={`社会保険料控除${sfx}`}
              value={yen(e.values.socialInsurance.value)}
              note={
                p.otherSocialInsurance > 0
                  ? `天引き ${yen(r.social)} ＋ 自分で払った分 ${yen(p.otherSocialInsurance)}`
                  : "天引きの分"
              }
            />
            <Row label={`源泉徴収された所得税${sfx}`} value={yen(r.totals.incomeTax)} />
            {r.diff !== null && r.diff !== 0 && (
              <Row
                label="総支給 − 天引き − 手取り"
                value={yen(r.diff)}
                note="年末調整の精算や、入れていない天引き・手当があると差が出ます"
              />
            )}
            <Row
              label={`今年天引きされる住民税${sfx}`}
              value={yen(r.resident.withheldThisYear)}
              note="前年の所得の分"
            />
            <Row
              label={`住民税（${e.year + 1} 年 6 月から）`}
              value={yen(r.resident.nextYear)}
              note={`この年の所得から出した見込み。月額の目安 ${yen(r.resident.nextMonthly)}`}
            />
          </dl>
        </>
      )}
    </SectionCard>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1">
      <dt className="text-slate-600">
        {label}
        {note && <span className="block text-xs text-slate-400">{note}</span>}
      </dt>
      <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
