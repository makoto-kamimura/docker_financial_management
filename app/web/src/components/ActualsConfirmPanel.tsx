"use client";

// 実績管理の「実績の確定」タブ。月ごとの流れ ① → ② → ③（順番は API が強制）のうち ② を受け持つ。
//   銀行・カード・電子マネーの明細の最終日が月末日までそろうと「実績入力済み」になるので、
//   ボタンで実績を確定する（POST /api/actuals/confirm。判定は lib/actuals-coverage.ts）。
//   前提の ① と、あとに続く ③ は予算管理の「予算の確定」タブ（components/BudgetConfirmPanel.tsx）で行う。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead } from "@/components/Explain";
import {
  budgetConfirmHref,
  CycleSteps,
  defaultCycleMonth,
  formatYmd,
  type CycleStatus,
} from "@/components/CycleSteps";
import { ENTRY_HELP, textFor } from "@/lib/help-texts";
import type { ViewMode } from "@/lib/display-name";

export function ActualsConfirmPanel({
  mode,
  initialMonth,
}: {
  mode: ViewMode;
  /** 対象月の初期値（YYYY-MM）。省略時は前月 */
  initialMonth?: string;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(() => initialMonth ?? defaultCycleMonth());
  const [year, month] = target.split("-").map(Number);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["cycle-status", year, month],
    queryFn: async (): Promise<CycleStatus> =>
      (await (await fetch(`/api/cycle-status?year=${year}&month=${month}`)).json()).data,
    enabled: Number.isInteger(year) && Number.isInteger(month),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["cycle-status"] });
    qc.invalidateQueries({ queryKey: ["budget-variance"] });
  }

  async function confirmActuals() {
    const label = `${year}年${month}月`;
    const ok = window.confirm(
      `${label}の実績を確定します。確定すると、${label}の実績は登録・変更・削除や明細の転記ができなくなります。よろしいですか？`,
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/actuals/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month }),
      });
      if (res.ok) {
        setMessage({ ok: true, text: `${label}の実績を確定しました。` });
        refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage({ ok: false, text: `エラー: ${err.error ?? "確定に失敗しました"}` });
      }
    } finally {
      setBusy(false);
    }
  }

  async function unconfirmActuals() {
    const label = `${year}年${month}月`;
    if (!window.confirm(`${label}の実績の確定を解除します。実績の金額は変わりません。`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/actuals/confirm?year=${year}&month=${month}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessage({ ok: true, text: `${label}の実績の確定を解除しました。` });
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

  return (
    <div className="space-y-5 mb-6">
      <SectionLead className="-mb-2">{textFor(ENTRY_HELP.confirm, mode)}</SectionLead>

      {/* 対象月と確定状況（①③ は予算管理へのリンク） */}
      <div className="card flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="actuals-confirm-month" className="text-xs font-medium text-slate-600">
            対象月
          </label>
          <input
            id="actuals-confirm-month"
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
        {data && <CycleSteps status={data} links={{ budget: true }} />}
      </div>

      {data && !data.confirmedAt && (
        <p className="text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-800">
          実績を確定する前に、{month}月の予算（①）を確定してください。{" "}
          <Link href={budgetConfirmHref(year, month) as never} className="underline">
            予算の確定へ
          </Link>
        </p>
      )}

      {message && (
        <p
          role="status"
          className={`text-sm rounded-lg px-3 py-2 ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
        >
          {message.text}
        </p>
      )}

      {isLoading && <LoadingSpinner />}

      {data && (
        <ActualsCard
          year={year}
          month={month}
          actuals={data.actuals}
          budgetConfirmed={!!data.confirmedAt}
          nextConfirmed={!!data.nextConfirmedAt}
          busy={busy}
          onConfirm={confirmActuals}
          onUnconfirm={unconfirmActuals}
        />
      )}

      {data?.actuals.confirmedAt && !data.nextConfirmedAt && (
        <p className="text-sm text-slate-600">
          次は、予算管理で{month}月の予算と実績を比べ、{data.next.month}月の予算を確定します（③）。{" "}
          <Link href={budgetConfirmHref(year, month) as never} className="underline">
            予算の確定へ
          </Link>
        </p>
      )}
    </div>
  );
}

// ② 実績の確定。明細の最終日をソースごとに出し、全ソースが月末日まで届いたら確定できる
function ActualsCard({
  year,
  month,
  actuals,
  budgetConfirmed,
  nextConfirmed,
  busy,
  onConfirm,
  onUnconfirm,
}: {
  year: number;
  month: number;
  actuals: CycleStatus["actuals"];
  budgetConfirmed: boolean;
  nextConfirmed: boolean;
  busy: boolean;
  onConfirm: () => void;
  onUnconfirm: () => void;
}) {
  const locked = !!actuals.confirmedAt;
  const lagging = new Set(actuals.lagging.map((l) => `${l.kind}:${l.id}`));
  const blockedReason = !budgetConfirmed
    ? `先に${month}月の予算（①）を確定してください。`
    : !actuals.entered
      ? actuals.coveredThrough
        ? `明細が月末（${formatYmd(actuals.monthEnd)}）までそろうと確定できます。`
        : "明細を取り込むと確定できます。"
      : null;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 pt-4">
        <h3 className="section-title mb-1 flex items-center gap-1.5">
          {locked && <Lock className="w-4 h-4 text-slate-500" aria-hidden="true" />}② {year}年
          {month}月の実績
        </h3>
        {locked && (
          <SectionLead>
            {month}月の実績は確定済みです。{ENTRY_HELP.actualsLocked}
          </SectionLead>
        )}
      </div>
      {actuals.sources.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-slate-400">
          銀行口座・カード・電子マネーが登録されていません。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                <th className="px-4 py-2 text-left font-semibold min-w-44">口座・カード</th>
                <th className="px-3 py-2 text-left font-semibold">種別</th>
                <th className="px-3 py-2 text-right font-semibold">明細の最終日</th>
                <th className="px-3 py-2 text-left font-semibold">状況</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {actuals.sources.map((s) => {
                const late = lagging.has(`${s.kind}:${s.id}`);
                return (
                  <tr key={`${s.kind}:${s.id}`}>
                    <td className="px-4 py-2">{s.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{s.typeLabel}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${late ? "text-red-600 font-medium" : ""}`}
                    >
                      {s.lastDate ? formatYmd(s.lastDate) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.lastDate === null ? (
                        <span className="text-slate-400">明細なし（判定に含めない）</span>
                      ) : late ? (
                        <span className="text-red-600">月末まで届いていません</span>
                      ) : (
                        <span className="text-emerald-700">入力済み</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-100">
        {locked ? (
          <button
            type="button"
            disabled={busy || nextConfirmed}
            onClick={onUnconfirm}
            className="btn-secondary text-sm disabled:opacity-40"
            title={
              nextConfirmed
                ? "翌月の予算が確定済みのため、先に翌月の予算の確定を解除してください"
                : undefined
            }
          >
            {month}月の実績の確定を解除
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !!blockedReason}
            onClick={onConfirm}
            className="btn-primary text-sm disabled:opacity-40"
          >
            {month}月の実績を確定
          </button>
        )}
        {!locked && blockedReason && (
          <span className="text-xs text-amber-700">{blockedReason}</span>
        )}
        {!locked && actuals.unposted > 0 && (
          <span className="text-xs text-slate-500">
            {month}月の明細のうち {actuals.unposted} 件がまだ実績に転記されていません。
          </span>
        )}
      </div>
    </div>
  );
}
