"use client";

// 予算管理の「予算の確定」タブ。選んだ「予算の月」B の予算を確定する。
// 月ごとの流れ ① → ② → ③（順番は API が強制）のうち、予算の確定（① と ③）を受け持つ。
//   - 比べる月 C は B の前月。C の予算と実績の差（GET /api/budgets/variance）について、扱い（何もしない・
//     期ズレ・回し先へ）を選ぶと B の予算案ができる。「確定」で B の予算を確定する（POST /api/budgets/confirm）
//     （計算は lib/budget-cycle.ts。案の金額は手で直せる＝流用）。これが C から見た ③
//   - はじめて使うときなどは、B の予算をいま入っている金額のまま確定できる（B から見た ①）
//   - C の実績の確定（②）は実績管理の「実績の確定」タブ、C の予算と実績を見比べるのは「予実差確認」タブ
//   年は左のメニュー、月は上のボタンで選ぶ（lib/use-cycle-month.ts）。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lock, RotateCcw } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";
import { InfoNote, SectionLead, TermDetails } from "@/components/Explain";
import { actualsConfirmHref, CycleSteps, type CycleStatus } from "@/components/CycleSteps";
import { MonthPicker } from "@/components/MonthPicker";
import {
  diffClass,
  diffLabel,
  signedYen,
  yen,
  type VarianceResponse,
} from "@/components/BudgetVariancePanel";
import { BUDGET_HELP, textFor } from "@/lib/help-texts";
import { displayName, type ViewMode } from "@/lib/display-name";
import {
  defaultTreatment,
  isTreatmentAllowed,
  planNextBudget,
  prevYearMonth,
  type VarianceTreatment,
} from "@/lib/budget-cycle";
import { cycleKey } from "@/lib/cycle-month";
import { useCycleMonth } from "@/lib/use-cycle-month";
import { Notice } from "@/components/ui";

type AccountRef = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};

const TREATMENT_LABEL: Record<VarianceTreatment, string> = {
  none: "何もしない",
  timing: "期ズレとして翌月へ",
  transfer: "回し先へ",
};

export function BudgetConfirmPanel({
  mode,
  initialMonth,
  onOpenVariance,
}: {
  mode: ViewMode;
  /** 予算の月の初期値（YYYY-MM）。省略時は最後に実績を確定した月の翌月 */
  initialMonth?: string;
  /** 「予実差確認」タブを、指定した比べる月（YYYY-MM）で開く */
  onOpenVariance: (month: string) => void;
}) {
  const qc = useQueryClient();
  const household = mode === "household";
  const { year, month, setMonth } = useCycleMonth("budget", initialMonth);
  // 比べる月（予算の月の前月）
  const prev = month !== null ? prevYearMonth(year, month) : null;

  const [treatments, setTreatments] = useState<Map<number, VarianceTreatment>>(new Map());
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  // 予算案を手で直した金額（流用など）。科目 ID → 入力中の文字列
  const [overrides, setOverrides] = useState<Map<number, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setMessage(null), [year, month]);

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  // 比べる月の予算と実績（予算案の計算と、①②③ の状況に使う）
  const { data, isLoading } = useQuery({
    queryKey: ["budget-variance", prev?.year, prev?.month],
    queryFn: async (): Promise<VarianceResponse> =>
      (await (await fetch(`/api/budgets/variance?year=${prev!.year}&month=${prev!.month}`)).json())
        .data,
    enabled: prev !== null,
  });

  // 予算の月そのものの状況（その月の実績が確定済みか・前月の実績が未確定か）
  const { data: own } = useQuery({
    queryKey: ["cycle-status", year, month],
    queryFn: async (): Promise<CycleStatus> =>
      (await (await fetch(`/api/cycle-status?year=${year}&month=${month}`)).json()).data,
    enabled: month !== null,
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

  // 表の行: 比べる月の科目（差と扱い）と、予算案にだけある科目（回し先）を合わせる
  const tableIds = useMemo(() => {
    const ids = (data?.rows ?? []).map((r) => r.accountId);
    for (const item of plan) if (!ids.includes(item.accountId)) ids.push(item.accountId);
    return ids;
  }, [data, plan]);
  const planById = useMemo(() => new Map(plan.map((i) => [i.accountId, i])), [plan]);

  const finalAmount = (accountId: number, planned: number) => {
    const o = overrides.get(accountId);
    if (o === undefined || o.trim() === "") return planned;
    const n = Number(o);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : planned;
  };
  const invalidOverride = [...overrides.values()].some(
    (o) => o.trim() !== "" && !(Number.isFinite(Number(o)) && Number(o) >= 0),
  );

  const totals = plan.reduce(
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

  async function confirm(withPlan: boolean) {
    if (month === null) return;
    const label = `${year}年${month}月`;
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
        body: JSON.stringify({ year, month, items }),
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

  async function unconfirm() {
    if (month === null) return;
    const label = `${year}年${month}月`;
    if (!window.confirm(`${label}の予算の確定を解除します。予算の金額は変わりません。`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/budgets/confirm?year=${year}&month=${month}`, {
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

  const label = `${year}年${month}月`;
  const locked = !!data?.nextConfirmedAt;
  const ownActualsLocked = !!own?.actuals.confirmedAt;
  const hasOwnBudget = !!data?.rows.some((r) => r.nextBudget !== null);
  // 比べる月から作る予算案で確定できない理由（比べる月の ① ② が済んでいない）
  const planBlockedReason =
    !data || !prev
      ? null
      : !data.confirmedAt
        ? `この案で確定するには、先に${prev.month}月の予算（①）と実績（②）を確定してください。`
        : !data.actuals.confirmedAt
          ? `この案で確定するには、先に実績管理の「実績の確定」で${prev.month}月の実績（②）を確定してください。`
          : null;

  return (
    <div className="space-y-5 mb-6">
      <SectionLead className="-mb-2">{textFor(BUDGET_HELP.confirm, mode)}</SectionLead>

      {/* 予算の月と、比べる月から見た確定状況（① 比べる月の予算 → ② 実績 → ③ この月の予算） */}
      <div className="card flex flex-col gap-3">
        <MonthPicker year={year} month={month} onChange={setMonth} label="予算の月" />
        <div className="flex flex-wrap items-center gap-3">
          {data && <CycleSteps status={data} links={{ actuals: true }} />}
          {data && !locked && hasOwnBudget && (
            <button
              type="button"
              disabled={busy || !!own?.prevActualsPending}
              onClick={() => confirm(false)}
              className="btn-secondary btn-sm ml-auto"
              title={
                own?.prevActualsPending
                  ? "前月の実績が確定していないため、まだ確定できません。実績管理の「実績の確定」で前月の実績を確定してください"
                  : "この月の予算を、いま入っている金額のまま確定します（はじめて使うときなど）"
              }
            >
              {month}月の予算をそのまま確定
            </button>
          )}
        </div>
      </div>

      {message && <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice>}

      {isLoading && <LoadingSpinner />}

      {data && prev && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 pt-4">
            <h3 className="section-title mb-1 flex items-center gap-1.5">
              {locked && <Lock className="w-4 h-4 text-slate-500" aria-hidden="true" />}
              {label}の予算案
            </h3>
            <SectionLead>
              {locked
                ? `${label}の予算は確定済みです。${BUDGET_HELP.cycleLocked}`
                : `${prev.month}月の予算と実績の差について扱いを選ぶと、その分を反映した金額になります。科目の間で予算を移す（流用する）ときは、金額を直接書き換えてください。ローン返済などの自動反映は、ここには含めず表示のときに上乗せされます。`}{" "}
              <button
                type="button"
                onClick={() => onOpenVariance(cycleKey(prev.year, prev.month))}
                className="underline text-indigo-600"
              >
                {prev.month}月の予実差を見る
              </button>
            </SectionLead>
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
                disabled={locked}
                onChange={(e) => changeTransferTarget(e.target.value)}
                className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white max-w-64 disabled:opacity-50"
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
          {tableIds.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-400">
              {prev.month}月と{month}月には、予算も実績もまだありません。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                    <th className="px-4 py-2 text-left font-semibold min-w-44">勘定科目</th>
                    <th className="px-3 py-2 text-right font-semibold">{prev.month}月の差</th>
                    <th className="px-3 py-2 text-left font-semibold min-w-44">差額の扱い</th>
                    <th className="px-3 py-2 text-right font-semibold">基準</th>
                    <th className="px-3 py-2 text-right font-semibold">増減</th>
                    <th className="px-3 py-2 text-right font-semibold">予算案</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tableIds.map((id) => {
                    const row = data.rows.find((r) => r.accountId === id);
                    const item = planById.get(id);
                    const current = treatments.get(id) ?? "none";
                    const override = overrides.get(id);
                    const edited = override !== undefined;
                    return (
                      <tr key={id}>
                        <td className="px-4 py-2">
                          <span className="text-xs font-mono text-slate-400 mr-1.5">
                            {codeOf(id)}
                          </span>
                          {nameOf(id)}
                          {item && item.notes.length > 0 && (
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
                          {item?.clamped && (
                            <div className="text-[10px] text-amber-600">
                              差し引くと 0 円を下回るため 0 円にしました
                            </div>
                          )}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${row ? diffClass(row) : "text-slate-400"}`}
                        >
                          {row ? (
                            <>
                              {signedYen(row.difference)}
                              <div className="text-[10px]">{diffLabel(row)}</div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row ? (
                            <select
                              aria-label={`${nameOf(id)}の差額の扱い`}
                              value={current}
                              disabled={locked || row.difference === 0}
                              onChange={(e) =>
                                setTreatments((m) =>
                                  new Map(m).set(id, e.target.value as VarianceTreatment),
                                )
                              }
                              className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white disabled:opacity-50"
                            >
                              {(["none", "timing", "transfer"] as const)
                                .filter(
                                  (t) =>
                                    t === current || isTreatmentAllowed(row, t, transferTargetId),
                                )
                                .map((t) => (
                                  <option key={t} value={t}>
                                    {TREATMENT_LABEL[t]}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <span className="text-xs text-slate-400">回し先</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {item ? yen(item.base) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {!item || item.adjustment === 0 ? "—" : signedYen(item.adjustment)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {item ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                min={0}
                                aria-label={`${nameOf(id)}の${label}の予算`}
                                disabled={locked}
                                value={override ?? String(item.amount)}
                                onChange={(e) =>
                                  setOverrides((m) => new Map(m).set(id, e.target.value))
                                }
                                className={`w-28 text-right text-xs border rounded px-1.5 py-1 tabular-nums disabled:bg-slate-50 ${edited ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                              />
                              {edited && !locked && (
                                <button
                                  type="button"
                                  aria-label="計算した金額に戻す"
                                  title="計算した金額に戻す"
                                  onClick={() =>
                                    setOverrides((m) => {
                                      const n = new Map(m);
                                      n.delete(id);
                                      return n;
                                    })
                                  }
                                  className="text-slate-400 hover:text-indigo-600"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {plan.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50 text-xs">
                      <td colSpan={5} className="px-4 py-2 text-right text-slate-600">
                        {household ? "収入" : "売上・収入"} {yen(totals.revenue)} −{" "}
                        {household ? "支出" : "費用"} {yen(totals.expense)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums ${totals.revenue - totals.expense < 0 ? "text-red-600" : "text-slate-800"}`}
                      >
                        {signedYen(totals.revenue - totals.expense)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-100">
            {locked ? (
              <button
                type="button"
                disabled={busy || ownActualsLocked}
                onClick={unconfirm}
                className="btn-secondary"
                title={
                  ownActualsLocked
                    ? "この月の実績が確定済みのため、先に実績の確定を解除してください"
                    : undefined
                }
              >
                {label}の確定を解除
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || plan.length === 0 || invalidOverride || !!planBlockedReason}
                onClick={() => confirm(true)}
                className="btn-primary"
              >
                この予算で{label}を確定
              </button>
            )}
            {!locked && planBlockedReason && (
              <span className="text-xs text-amber-700">
                {planBlockedReason}{" "}
                <Link
                  href={actualsConfirmHref(prev.year, prev.month) as never}
                  className="underline"
                >
                  実績の確定へ
                </Link>
              </span>
            )}
            {invalidOverride && (
              <span className="text-xs text-red-600">金額は 0 以上の数で入れてください。</span>
            )}
          </div>
        </div>
      )}

      {data && (
        <InfoNote>
          確定した予算は、{month}月の実績と比べる基準になります。{month}
          月が終わって明細がそろったら、実績管理で{month}月の実績を確定（②）し、「予実差確認」で
          {month}月の予算と実績を見比べてから、ここで翌月を選んで同じ手順で進めます。
        </InfoNote>
      )}
    </div>
  );
}
