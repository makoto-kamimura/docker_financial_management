"use client";

// 予算管理の「予算の確定」タブ。月ごとの流れ ① → ② → ③（順番は API が強制）のうち ①③ を受け持つ。
//   ① その月の予算を確定する（初回は「そのまま確定」。以降は前月の ③ で確定済みになっている）
//   ② 実績の確定は実績管理の「実績の確定」タブ（components/ActualsConfirmPanel.tsx）で行う
//   ③ 予算と実績を科目ごとに比べ（GET /api/budgets/variance）、差額の扱い（何もしない・期ズレ・
//      回し先へ）を選んで翌月の予算案を作り、「確定」で翌月の予算を確定する（POST /api/budgets/confirm）
//      （計算は lib/budget-cycle.ts。案の金額は手で直せる＝流用）
//   翌月になったら、その月を選んで ② から繰り返す。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lock, RotateCcw } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";
import { InfoNote, SectionLead, TermDetails } from "@/components/Explain";
import {
  actualsConfirmHref,
  CycleSteps,
  defaultCycleMonth,
  type CycleStatus,
} from "@/components/CycleSteps";
import { BUDGET_HELP, textFor } from "@/lib/help-texts";
import { displayName, type ViewMode } from "@/lib/display-name";
import {
  defaultTreatment,
  isExpenseCategory,
  isTreatmentAllowed,
  planNextBudget,
  type VarianceRow,
  type VarianceTreatment,
} from "@/lib/budget-cycle";

type Row = VarianceRow & { soleName: string | null; corporateName: string | null };
type VarianceResponse = CycleStatus & {
  transferTargetId: number | null;
  rows: Row[];
  summary: {
    revenue: { plan: number; actual: number };
    expense: { plan: number; actual: number };
    surplusTotal: number;
    overrunTotal: number;
  };
};
type AccountRef = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};

const yen = (v: number) => `¥${Math.round(v).toLocaleString("ja-JP")}`;
const signedYen = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${yen(Math.abs(v))}`;

const TREATMENT_LABEL: Record<VarianceTreatment, string> = {
  none: "何もしない",
  timing: "期ズレとして翌月へ",
  transfer: "回し先へ",
};

export function BudgetConfirmPanel({
  mode,
  initialMonth,
}: {
  mode: ViewMode;
  /** 比べる月の初期値（YYYY-MM）。省略時は前月 */
  initialMonth?: string;
}) {
  const qc = useQueryClient();
  const household = mode === "household";
  const [target, setTarget] = useState(() => initialMonth ?? defaultCycleMonth());
  const [year, month] = target.split("-").map(Number);

  const [treatments, setTreatments] = useState<Map<number, VarianceTreatment>>(new Map());
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  // 翌月の予算案を手で直した金額（流用など）。科目 ID → 入力中の文字列
  const [overrides, setOverrides] = useState<Map<number, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ["budget-variance", year, month],
    queryFn: async (): Promise<VarianceResponse> =>
      (await (await fetch(`/api/budgets/variance?year=${year}&month=${month}`)).json()).data,
    enabled: Number.isInteger(year) && Number.isInteger(month),
  });

  // 月・モードが変わったら、差額の扱いを既定に戻す
  useEffect(() => {
    if (!data) return;
    const target = data.transferTargetId;
    setTransferTargetId(target);
    setTreatments(
      new Map(
        data.rows.map((r) => [
          r.accountId,
          defaultTreatment(r, {
            household,
            hasTransferTarget: target !== null && target !== r.accountId,
          }),
        ]),
      ),
    );
    setOverrides(new Map());
  }, [data, household]);

  const accountById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts]);
  const nameOf = (id: number) => {
    const row = data?.rows.find((r) => r.accountId === id);
    if (row) return displayName(row, mode);
    const acct = accountById.get(id);
    return acct ? displayName(acct, mode) : `科目 ${id}`;
  };
  const codeOf = (id: number) =>
    data?.rows.find((r) => r.accountId === id)?.accountCode ?? accountById.get(id)?.code ?? "";
  const categoryOf = (id: number) =>
    data?.rows.find((r) => r.accountId === id)?.category ?? accountById.get(id)?.category ?? "";

  const plan = useMemo(() => {
    if (!data) return [];
    return planNextBudget({
      rows: data.rows,
      treatments,
      transferTargetId,
    });
  }, [data, treatments, transferTargetId]);

  const finalAmount = (accountId: number, planned: number) => {
    const o = overrides.get(accountId);
    if (o === undefined || o.trim() === "") return planned;
    const n = Number(o);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : planned;
  };
  const invalidOverride = [...overrides.values()].some(
    (o) => o.trim() !== "" && !(Number.isFinite(Number(o)) && Number(o) >= 0),
  );

  const nextTotals = plan.reduce(
    (acc, item) => {
      const amount = finalAmount(item.accountId, item.amount);
      if (categoryOf(item.accountId) === "REVENUE") acc.revenue += amount;
      else acc.expense += amount;
      return acc;
    },
    { revenue: 0, expense: 0 },
  );

  // 回し先の候補は費用の科目（家計の貯蓄・投資も費用として扱う）
  const transferCandidates = (accounts ?? []).filter(
    (a) => a.category === "EXPENSE" || a.category === "COGS",
  );

  // 回し先を変えたら、選べなくなった「回し先へ」は「何もしない」に戻す
  function changeTransferTarget(value: string) {
    const nextTarget = value === "" ? null : Number(value);
    setTransferTargetId(nextTarget);
    if (!data) return;
    setTreatments((m) => {
      const n = new Map(m);
      for (const r of data.rows) {
        if (n.get(r.accountId) === "transfer" && !isTreatmentAllowed(r, "transfer", nextTarget)) {
          n.set(r.accountId, "none");
        }
      }
      return n;
    });
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["budget-variance"] });
    qc.invalidateQueries({ queryKey: ["cycle-status"] });
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["budget-history"] });
  }

  async function confirm(targetYear: number, targetMonth: number, withPlan: boolean) {
    const label = `${targetYear}年${targetMonth}月`;
    const ok = window.confirm(
      withPlan
        ? `${label}の予算をこの案で確定します。確定すると、${label}の予算は変更できなくなります。よろしいですか？`
        : `${label}の予算を、いま入っている金額のまま確定します。よろしいですか？`,
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const items = withPlan
        ? plan.map((i) => ({ accountId: i.accountId, amount: finalAmount(i.accountId, i.amount) }))
        : [];
      const res = await fetch("/api/budgets/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: targetYear, month: targetMonth, items }),
      });
      if (res.ok) {
        setMessage({ ok: true, text: `${label}の予算を確定しました。` });
        refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ ok: false, text: `エラー: ${err.error ?? "確定に失敗しました"}` });
      }
    } finally {
      setBusy(false);
    }
  }

  async function unconfirm(targetYear: number, targetMonth: number) {
    const label = `${targetYear}年${targetMonth}月`;
    if (!window.confirm(`${label}の予算の確定を解除します。予算の金額は変わりません。`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/budgets/confirm?year=${targetYear}&month=${targetMonth}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessage({ ok: true, text: `${label}の確定を解除しました。` });
        refresh();
      } else if (res.status === 403) {
        setMessage({ ok: false, text: "確定の解除は管理者だけができます。" });
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ ok: false, text: `エラー: ${err.error ?? "解除に失敗しました"}` });
      }
    } finally {
      setBusy(false);
    }
  }

  const diffClass = (r: VarianceRow) =>
    r.favorable === null ? "text-slate-500" : r.favorable ? "text-emerald-700" : "text-red-600";
  const diffLabel = (r: VarianceRow) => {
    if (r.difference === 0) return "予算どおり";
    if (isExpenseCategory(r.category)) return r.difference < 0 ? "余り" : "超過";
    return r.difference > 0 ? "上振れ" : "不足";
  };

  const nextLabel = data ? `${data.next.year}年${data.next.month}月` : "翌月";
  const nextLocked = !!data?.nextConfirmedAt;
  const actualsLocked = !!data?.actuals.confirmedAt;
  // ③ 翌月の予算を確定できない理由（② が済んでいない）
  const nextBlockedReason = !data
    ? null
    : !data.confirmedAt
      ? `先に${month}月の予算（①）を確定し、実績管理で実績（②）を確定してください。`
      : !actualsLocked
        ? `先に実績管理の「実績の確定」で${month}月の実績（②）を確定してください。`
        : null;

  return (
    <div className="space-y-5 mb-6">
      <SectionLead className="-mb-2">{textFor(BUDGET_HELP.confirm, mode)}</SectionLead>

      {/* 対象月と確定状況 */}
      <div className="card flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="cycle-month" className="text-xs font-medium text-slate-600">
            比べる月
          </label>
          <input
            id="cycle-month"
            type="month"
            value={target}
            onChange={(e) => {
              if (!e.target.value) return;
              setTarget(e.target.value);
              setMessage(null);
            }}
            className="input-field w-40"
          />
        </div>
        {data && <CycleSteps status={data} links={{ actuals: true }} />}
        {data && !data.confirmedAt && data.rows.some((r) => r.budget !== null) && (
          <button
            type="button"
            disabled={busy || data.prevActualsPending}
            onClick={() => confirm(year, month, false)}
            className="btn-secondary text-xs px-3 py-1.5 ml-auto disabled:opacity-40"
            title={
              data.prevActualsPending
                ? "前月の実績が確定していないため、まだ確定できません。実績管理の「実績の確定」で前月の実績を確定してください"
                : "この月の予算を、いま入っている金額のまま確定します（はじめて使うときなど）"
            }
          >
            {month}月の予算をそのまま確定
          </button>
        )}
        {data?.confirmedAt && (
          <button
            type="button"
            disabled={busy || actualsLocked}
            onClick={() => unconfirm(year, month)}
            className="btn-secondary text-xs px-3 py-1.5 ml-auto disabled:opacity-40"
            title={
              actualsLocked ? "実績が確定済みのため、先に実績の確定を解除してください" : undefined
            }
          >
            {month}月の予算の確定を解除
          </button>
        )}
      </div>

      {message && (
        <p
          role="status"
          className={`text-sm rounded-lg px-3 py-2 ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
        >
          {message.text}
        </p>
      )}

      {isLoading && <LoadingSpinner />}

      {data && data.rows.length === 0 && (
        <p className="text-sm text-slate-400">
          {year}年{month}月には、予算も実績もまだありません。
        </p>
      )}

      {data && data.rows.length > 0 && (
        <>
          {/* 合計 */}
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryTile
              title={household ? "収入" : "売上・収入"}
              main={yen(data.summary.revenue.actual)}
              sub={`予算 ${yen(data.summary.revenue.plan)}`}
            />
            <SummaryTile
              title={household ? "支出" : "費用"}
              main={yen(data.summary.expense.actual)}
              sub={`予算 ${yen(data.summary.expense.plan)}`}
            />
            <SummaryTile
              title="余った額"
              main={yen(data.summary.surplusTotal)}
              sub="予算より少なく済んだ費用の合計"
              tone="good"
            />
            <SummaryTile
              title="超えた額"
              main={yen(data.summary.overrunTotal)}
              sub="予算を超えた費用の合計"
              tone="bad"
            />
          </div>

          {/* 科目別の予実と差額の扱い */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 pt-4">
              <h3 className="section-title mb-1">
                {year}年{month}月の予算と実績
              </h3>
              <TermDetails
                terms={BUDGET_HELP.cycleTreatments}
                summary="差額の扱いの説明"
                className="mb-3"
              />
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <label htmlFor="transfer-target" className="text-xs font-medium text-slate-600">
                  {household ? "余りの回し先（貯蓄など）" : "余りの回し先（流用先）"}
                </label>
                <select
                  id="transfer-target"
                  value={transferTargetId ?? ""}
                  onChange={(e) => changeTransferTarget(e.target.value)}
                  className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white max-w-64"
                >
                  <option value="">指定しない</option>
                  {transferCandidates.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {displayName(a, mode)}
                    </option>
                  ))}
                </select>
                {data.transferTargetId === null && household && (
                  <span className="text-[11px] text-slate-400">
                    予算配分の「貯蓄・投資」に入る科目（科目名に「貯蓄」「積立」などを含む科目）が、ここの既定になります。
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                    <th className="px-4 py-2 text-left font-semibold min-w-44">勘定科目</th>
                    <th className="px-3 py-2 text-right font-semibold">予算</th>
                    <th className="px-3 py-2 text-right font-semibold">実績</th>
                    <th className="px-3 py-2 text-right font-semibold">差（実績−予算）</th>
                    <th className="px-3 py-2 text-left font-semibold min-w-44">差額の扱い</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r) => {
                    const current = treatments.get(r.accountId) ?? "none";
                    return (
                      <tr key={r.accountId}>
                        <td className="px-4 py-2">
                          <span className="text-xs font-mono text-slate-400 mr-1.5">
                            {r.accountCode}
                          </span>
                          {displayName(r, mode)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.budget === null && r.overlay === 0 ? "—" : yen(r.plan)}
                          {r.overlay > 0 && (
                            <div className="text-[10px] text-indigo-500">
                              内 自動反映 {yen(r.overlay)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{yen(r.actual)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${diffClass(r)}`}>
                          {signedYen(r.difference)}
                          <div className="text-[10px]">{diffLabel(r)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`${displayName(r, mode)}の差額の扱い`}
                            value={current}
                            disabled={nextLocked || r.difference === 0}
                            onChange={(e) =>
                              setTreatments((m) =>
                                new Map(m).set(r.accountId, e.target.value as VarianceTreatment),
                              )
                            }
                            className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white disabled:opacity-50"
                          >
                            {(["none", "timing", "transfer"] as const)
                              .filter(
                                (t) => t === current || isTreatmentAllowed(r, t, transferTargetId),
                              )
                              .map((t) => (
                                <option key={t} value={t}>
                                  {TREATMENT_LABEL[t]}
                                </option>
                              ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 翌月の予算案と確定 */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 pt-4">
              <h3 className="section-title mb-1 flex items-center gap-1.5">
                {nextLocked && <Lock className="w-4 h-4 text-slate-500" aria-hidden="true" />}
                {nextLabel}の予算案
              </h3>
              <SectionLead>
                {nextLocked
                  ? `${nextLabel}の予算は確定済みです。${BUDGET_HELP.cycleLocked}`
                  : "上で選んだ扱いを反映した金額です。科目の間で予算を移す（流用する）ときは、金額を直接書き換えてください。ローン返済などの自動反映は、ここには含めず表示のときに上乗せされます。"}
              </SectionLead>
            </div>
            {plan.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-slate-400">翌月に引き継ぐ予算がありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                      <th className="px-4 py-2 text-left font-semibold min-w-44">勘定科目</th>
                      <th className="px-3 py-2 text-right font-semibold">基準</th>
                      <th className="px-3 py-2 text-right font-semibold">増減</th>
                      <th className="px-3 py-2 text-right font-semibold">予算案</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.map((item) => {
                      const override = overrides.get(item.accountId);
                      const edited = override !== undefined;
                      return (
                        <tr key={item.accountId}>
                          <td className="px-4 py-2">
                            <span className="text-xs font-mono text-slate-400 mr-1.5">
                              {codeOf(item.accountId)}
                            </span>
                            {nameOf(item.accountId)}
                            {item.notes.length > 0 && (
                              <div className="text-[10px] text-slate-500">
                                {item.notes
                                  .map((n) =>
                                    n.kind === "timing"
                                      ? `期ズレ ${signedYen(n.amount)}`
                                      : `${nameOf(n.fromAccountId)}の余り ${signedYen(n.amount)}`,
                                  )
                                  .join("、")}
                              </div>
                            )}
                            {item.clamped && (
                              <div className="text-[10px] text-amber-600">
                                差し引くと 0 円を下回るため 0 円にしました
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                            {yen(item.base)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {item.adjustment === 0 ? "—" : signedYen(item.adjustment)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                min={0}
                                aria-label={`${nameOf(item.accountId)}の${nextLabel}の予算`}
                                disabled={nextLocked}
                                value={override ?? String(item.amount)}
                                onChange={(e) =>
                                  setOverrides((m) =>
                                    new Map(m).set(item.accountId, e.target.value),
                                  )
                                }
                                className={`w-28 text-right text-xs border rounded px-1.5 py-1 tabular-nums disabled:bg-slate-50 ${edited ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                              />
                              {edited && !nextLocked && (
                                <button
                                  type="button"
                                  aria-label="計算した金額に戻す"
                                  title="計算した金額に戻す"
                                  onClick={() =>
                                    setOverrides((m) => {
                                      const n = new Map(m);
                                      n.delete(item.accountId);
                                      return n;
                                    })
                                  }
                                  className="text-slate-400 hover:text-indigo-600"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50 text-xs">
                      <td colSpan={3} className="px-4 py-2 text-right text-slate-600">
                        {household ? "収入" : "売上・収入"} {yen(nextTotals.revenue)} −{" "}
                        {household ? "支出" : "費用"} {yen(nextTotals.expense)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums ${nextTotals.revenue - nextTotals.expense < 0 ? "text-red-600" : "text-slate-800"}`}
                      >
                        {signedYen(nextTotals.revenue - nextTotals.expense)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-100">
              {nextLocked ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => unconfirm(data.next.year, data.next.month)}
                  className="btn-secondary text-sm disabled:opacity-40"
                >
                  {nextLabel}の確定を解除
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || plan.length === 0 || invalidOverride || !!nextBlockedReason}
                  onClick={() => confirm(data.next.year, data.next.month, true)}
                  className="btn-primary text-sm disabled:opacity-40"
                >
                  この予算で{nextLabel}を確定
                </button>
              )}
              {!nextLocked && nextBlockedReason && (
                <span className="text-xs text-amber-700">
                  {nextBlockedReason}{" "}
                  <Link href={actualsConfirmHref(year, month) as never} className="underline">
                    実績の確定へ
                  </Link>
                </span>
              )}
              {invalidOverride && (
                <span className="text-xs text-red-600">金額は 0 以上の数で入れてください。</span>
              )}
            </div>
          </div>

          <InfoNote>
            確定した予算は、{nextLabel}の実績と比べる基準になります。{nextLabel}
            が終わって明細がそろったら、実績管理で{nextLabel}の実績を確定（②）し、ここで
            {nextLabel}を選んで同じ手順で進めます。
          </InfoNote>
        </>
      )}
    </div>
  );
}

function SummaryTile({
  title,
  main,
  sub,
  tone,
}: {
  title: string;
  main: string;
  sub: string;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-600" : "text-slate-800";
  return (
    <div className="card py-3">
      <p className="text-xs text-slate-500">{title}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{main}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}
