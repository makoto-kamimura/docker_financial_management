"use client";

// 配分提案。収入額に予算配分ルール（予算管理の「設定」タブ）の割合を掛けた推奨額を出し、
// 予算が未設定の科目にだけ反映する（同じルールの科目に入っている予算を差し引いた残りを、
// 前の 3 か月の実績の比率で按分）。既定の「手入力」は入力額をそのまま振り分ける（ローン等の控除なし）。
// はじめての予算の確定（前月も当月も実績が無い）のときに、「予算の確定」タブ（BudgetConfirmPanel）で
// 予算の月に固定して使う。

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead } from "@/components/Explain";
import { BUDGET_HELP } from "@/lib/shared/help-texts";
import { planAllocationApply, type AssignmentSource } from "@/lib/shared/allocation-assign";
import { yen } from "@/lib/common/format";

// 配分ルールのメンバー科目（自動の振り分け＋手動の割り当てを解決したもの）
type MemberAccount = {
  id: number;
  code: string;
  name: string;
  category: string;
  source: AssignmentSource;
};

type AllocationRuleRef = {
  id: number;
  key: string;
  label: string;
  group: string;
  minPercent: number;
  maxPercent: number | null;
  sortOrder: number;
};
type SuggestAccount = MemberAccount & {
  /** 按分の重み（前の 3 か月の実績） */
  weight: number;
  /** 推奨額をこの科目に按分した額 */
  recommended: number;
  /** その月にすでに入っている予算（自動反映を含む。null = 未設定） */
  budget: number | null;
  /** その月の自動反映（ローン返済など） */
  overlay: number;
};
type AllocationItem = {
  rule: AllocationRuleRef;
  min: number;
  max: number | null;
  recommended: number;
  /** このルールに入っている自動反映の合計 */
  overlay: number;
  accounts: SuggestAccount[];
};
type AllocationSuggestion = {
  year: number;
  month: number;
  basis: AllocationBasis;
  basisAmount: number;
  available: number;
  items: AllocationItem[];
  totalRecommended: number;
  overRecommended: boolean;
  summary503020: { needs: number; wants: number; savings: number };
};
type AllocationBasis = "budget" | "actual" | "manual";

export function AllocationSuggestSection({
  year,
  month,
  onApplied,
}: {
  /** 予算の月（予算の確定で選んでいる月に固定する） */
  year: number;
  month: number;
  /** 予算への反映後に呼ぶ */
  onApplied?: () => void;
}) {
  const qc = useQueryClient();
  // 既定は「手入力」。予算・実績の入力状況に左右されず、入れた金額をそのまま振り分けられる
  const [basis, setBasis] = useState<AllocationBasis>("manual");
  // 手入力の収入額。「配分を算出」を押したときだけ committedIncome に反映して問い合わせる
  const [incomeInput, setIncomeInput] = useState("");
  const [committedIncome, setCommittedIncome] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["allocation-suggest", year, month, basis, committedIncome],
    queryFn: async (): Promise<AllocationSuggestion> => {
      const amountParam = basis === "manual" ? `&amount=${committedIncome ?? 0}` : "";
      const res = await fetch(
        `/api/budgets/allocation-suggest?year=${year}&month=${month}&basis=${basis}${amountParam}`,
      );
      return (await res.json()).data;
    },
    // 手入力は「配分を算出」を押すまで問い合わせない（打鍵のたびに再計算しない）
    enabled: basis !== "manual" || committedIncome !== null,
  });

  useEffect(() => {
    if (!data) return;
    const next: Record<number, string> = {};
    for (const item of data.items) next[item.rule.id] = String(item.recommended);
    setAmounts(next);
  }, [data]);

  // ルールごとの反映の計画（予算が入っている科目は残し、残りを未設定の科目へ按分）
  const plans = new Map(
    (data?.items ?? []).map((item) => [
      item.rule.id,
      planAllocationApply({
        amount: Number(amounts[item.rule.id] ?? item.recommended) || 0,
        accountIds: item.accounts.map((a) => a.id),
        existingBudgets: new Map(
          item.accounts.filter((a) => a.budget !== null).map((a) => [a.id, a.budget!]),
        ),
        weights: new Map(item.accounts.map((a) => [a.id, a.weight])),
      }),
    ]),
  );

  async function apply() {
    if (!data) return;
    const items = [...plans.values()]
      .flatMap((p) => p.added)
      .filter((a) => a.amount > 0)
      .map((a) => ({ accountId: a.accountId, month, amount: a.amount }));
    if (items.length === 0) {
      setMessage(
        "反映する科目がありません（予算が未設定の科目が無いか、入っている予算で推奨額に届いています）",
      );
      return;
    }
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/budgets/allocation-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, items, onlyUnset: true }),
      });
      if (res.ok) {
        const { data: result } = await res.json();
        setMessage(
          `${result.applied} 件の科目に予算を入れました。` +
            (result.skipped > 0
              ? `（その間に予算が入った ${result.skipped} 件はそのままにしました）`
              : ""),
        );
        qc.invalidateQueries({ queryKey: ["allocation-suggest"] });
        qc.invalidateQueries({ queryKey: ["budgets"] });
        qc.invalidateQueries({ queryKey: ["budget-history"] });
        qc.invalidateQueries({ queryKey: ["allocation-guide"] });
        // 予算が入ったら、予算の確定の「そのまま確定」を出せるように状況を取り直す
        qc.invalidateQueries({ queryKey: ["budget-variance"] });
        qc.invalidateQueries({ queryKey: ["cycle-status"] });
        onApplied?.();
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage(`エラー: ${err.error ?? "反映に失敗しました"}`);
      }
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title mb-1">{month}月の配分提案</h2>
      <SectionLead className="mb-4">
        {BUDGET_HELP.allocationProposal}
        {basis === "manual" ? (
          <>
            {" "}
            手入力では、入力した金額だけを純粋に割合で振り分けます（予算・実績やローン返済などは
            考慮しません）。
          </>
        ) : (
          <>
            {" "}
            実績・予算では、その月の収入からローン返済・実物資産の負債分を差し引いた
            「配分可能額」をもとに算出します。
          </>
        )}
      </SectionLead>

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div className="flex flex-col gap-1 w-36">
          <label className="text-xs font-medium text-slate-600">収入基準額</label>
          <select
            value={basis}
            onChange={(e) => {
              setBasis(e.target.value as AllocationBasis);
              setCommittedIncome(null);
            }}
            className="input-field"
          >
            <option value="manual">手入力</option>
            <option value="actual">実績（収入）</option>
            <option value="budget">予算（収入）</option>
          </select>
        </div>
        {basis === "manual" && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1 w-40">
              <label className="text-xs font-medium text-slate-600">収入金額（円）</label>
              <input
                type="number"
                min={0}
                value={incomeInput}
                placeholder="例: 450000"
                onChange={(e) => setIncomeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && incomeInput !== "")
                    setCommittedIncome(Number(incomeInput));
                }}
                className="input-field"
              />
            </div>
            <button
              type="button"
              onClick={() => setCommittedIncome(Number(incomeInput))}
              disabled={incomeInput === ""}
              className="btn-primary whitespace-nowrap"
            >
              配分を算出
            </button>
          </div>
        )}
        {data && (
          <div className="text-sm text-slate-600 ml-auto text-right">
            <div>
              収入基準額: <span className="font-semibold">{yen(data.basisAmount)}</span>
            </div>
            {/* 手入力は控除しないので基準額＝配分額。二重表示を避けて振り分け対象額だけ出す */}
            <div>
              {data.basis === "manual" ? "配分対象額" : "配分可能額（目安の外のローン等を控除後）"}:{" "}
              <span className="font-semibold text-indigo-700">{yen(data.available)}</span>
            </div>
          </div>
        )}
      </div>

      {basis === "manual" && committedIncome === null && (
        <p className="text-sm text-slate-400">
          収入金額を入力して「配分を算出」を押すと、その金額をもとに各項目の割当額を計算します。
        </p>
      )}

      {isLoading && <LoadingSpinner />}

      {data && data.overRecommended && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          ⚠ 推奨額の合計（{yen(data.totalRecommended)}）が
          {data.basis === "manual" ? "配分対象額" : "配分可能額"}（{yen(data.available)}
          ）を超えています。金額を調整してください。
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {(
              [
                ["固定費", data.summary503020.needs],
                ["生活費", data.summary503020.wants],
                ["その他・貯蓄", data.summary503020.savings],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-sm font-semibold text-slate-700">{yen(value)}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">項目</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                    科目（入っている予算 → 新しく入れる額）
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    目安（下限〜上限）
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    反映額
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((item) => {
                  const plan = plans.get(item.rule.id);
                  const addedById = new Map(
                    (plan?.added ?? []).map((a) => [a.accountId, a.amount]),
                  );
                  const noAccounts = item.accounts.length === 0;
                  return (
                    <tr key={item.rule.id}>
                      <td className="px-3 py-2">
                        {item.rule.label}
                        <span className="ml-1.5 text-[10px] text-slate-400">{item.rule.group}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {noAccounts ? (
                          "—入っている科目なし—"
                        ) : (
                          <ul className="space-y-0.5">
                            {item.accounts.map((a) => (
                              <li key={a.id} className="flex justify-between gap-3">
                                <span>{a.name}</span>
                                <span className="tabular-nums">
                                  {a.budget !== null ? (
                                    <span className="text-slate-400">
                                      予算 {yen(a.budget)}
                                      {a.overlay > 0
                                        ? `（返済の自動反映 ${yen(a.overlay)} を含む）`
                                        : "（そのまま）"}
                                    </span>
                                  ) : addedById.has(a.id) ? (
                                    <span className="text-indigo-700">
                                      → {yen(addedById.get(a.id)!)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {yen(item.min)}
                        {item.max !== null ? ` 〜 ${yen(item.max)}` : " 〜"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          value={amounts[item.rule.id] ?? ""}
                          onChange={(e) =>
                            setAmounts({ ...amounts, [item.rule.id]: e.target.value })
                          }
                          disabled={noAccounts}
                          title={
                            noAccounts
                              ? "入っている科目が無いため反映できません（上の表で科目を移してください）"
                              : "このルール全体の金額。入っている予算を差し引いた残りを、予算が未設定の科目へ按分します"
                          }
                          className="w-28 text-right border border-slate-300 rounded px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button onClick={apply} disabled={applying} className="btn-primary">
              {applying ? "反映中…" : `${month}月の予算が未設定の科目へ反映`}
            </button>
            {message && <span className="text-sm text-slate-600">{message}</span>}
          </div>
        </>
      )}
    </div>
  );
}
