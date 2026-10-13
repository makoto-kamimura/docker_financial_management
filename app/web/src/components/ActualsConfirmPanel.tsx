"use client";

// 実績管理の「実績の確定」タブ。月ごとの流れ ① → ② → ③（順番は API が強制）のうち ② を受け持つ。
//   銀行・カード・電子マネーの明細の最終日が月末日までそろうと「実績入力済み」になるので、
//   ボタンで実績を確定する（POST /api/actuals/confirm。判定は lib/ledger/actuals-coverage.ts）。
//   科目が付いていない（未割り当ての）明細が残っている月は確定できない。下の一覧で行ごとに科目を付ける。
//   明細が月末まで届かない口座・カードは、行ごとの「当月末まで変動なし」で、そろったものとして扱える。
//   その印と確定時点の最終日は、確定の記録として残す（確定後はその記録を表示する）。
//   前提の ① と、あとに続く ③ は予算管理の「予算の確定」タブ（components/BudgetConfirmPanel.tsx）で行う。
//   年は左のメニュー、月は上のボタンで選ぶ（lib/client/use-cycle-month.ts）。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead, TermDetails } from "@/components/Explain";
import {
  budgetConfirmHref,
  CycleSteps,
  formatYmd,
  type ActualsSource,
  type CycleStatus,
} from "@/components/CycleSteps";
import { MonthPicker } from "@/components/MonthPicker";
import { useCycleMonth } from "@/lib/client/use-cycle-month";
import { ENTRY_HELP, LEARNING_RULE_TERMS, textFor } from "@/lib/shared/help-texts";
import { displayName, type ViewMode } from "@/lib/shared/display-name";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { Notice } from "@/components/ui";
import { DirectedAmount } from "@/components/DirectedAmount";
import { BUSINESS_USE_LABEL, isValidBusinessRatio } from "@/lib/shared/business-use";

export function ActualsConfirmPanel({
  mode,
  initialMonth,
}: {
  mode: ViewMode;
  /** 対象月の初期値（YYYY-MM）。省略時は最後に実績を確定した月の翌月 */
  initialMonth?: string;
}) {
  const qc = useQueryClient();
  const { year, month, setMonth } = useCycleMonth("actuals", initialMonth);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // 「当月末まで変動なし」を付けた口座・カード（"kind:id"）。確定を押したときにまとめて送る
  const [noChange, setNoChange] = useState<Set<string>>(new Set());

  // 月を変えたら、変動なしの印とメッセージを消す
  useEffect(() => {
    setNoChange(new Set());
    setMessage(null);
  }, [year, month]);

  const { data, isLoading } = useQuery({
    queryKey: ["cycle-status", year, month],
    queryFn: async (): Promise<CycleStatus> =>
      (await (await fetch(`/api/cycle-status?year=${year}&month=${month}`)).json()).data,
    enabled: month !== null,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["cycle-status"] });
    qc.invalidateQueries({ queryKey: ["cycle-latest"] });
    qc.invalidateQueries({ queryKey: ["budget-variance"] });
  }

  function toggleNoChange(key: string) {
    setNoChange((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function confirmActuals() {
    const label = `${year}年${month}月`;
    const ok = window.confirm(
      `${label}の実績を確定します。確定すると、${label}の明細は登録・削除や科目の変更ができなくなります。よろしいですか？`,
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/actuals/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          noChange: [...noChange].map((key) => {
            const [kind, id] = key.split(":");
            return { kind, id: Number(id) };
          }),
        }),
      });
      if (res.ok) {
        setMessage({ ok: true, text: `${label}の実績を確定しました。` });
        setNoChange(new Set());
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
      <SectionLead>{textFor(ENTRY_HELP.confirm, mode)}</SectionLead>

      {/* 対象月と確定状況（①③ は予算管理へのリンク） */}
      <div className="card flex flex-col gap-3">
        <MonthPicker year={year} month={month} onChange={setMonth} />
        {data && <CycleSteps status={data} links={{ budget: true }} />}
      </div>

      {data && month !== null && !data.confirmedAt && (
        <p className="text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-800">
          実績を確定する前に、{month}月の予算（①）を確定してください。{" "}
          <Link href={budgetConfirmHref(year, month) as never} className="underline">
            予算の確定へ
          </Link>
        </p>
      )}

      {message && <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice>}

      {isLoading && <LoadingSpinner />}

      {data && month !== null && (
        <ActualsCard
          year={year}
          month={month}
          actuals={data.actuals}
          budgetConfirmed={!!data.confirmedAt}
          nextConfirmed={!!data.nextConfirmedAt}
          busy={busy}
          noChange={noChange}
          onToggleNoChange={toggleNoChange}
          onConfirm={confirmActuals}
          onUnconfirm={unconfirmActuals}
        />
      )}

      {/* 未割り当ての明細（残っている間は確定できない）とまとめての処理 */}
      {data && month !== null && !data.actuals.confirmedAt && (
        <UnassignedCard year={year} month={month} mode={mode} onChanged={refresh} />
      )}

      {data?.actuals.confirmedAt && !data.nextConfirmedAt && (
        <p className="text-sm text-slate-600">
          次は、予算管理で{month}月の予算と実績を比べ、{data.next.month}月の予算を確定します（③）。{" "}
          <Link
            href={budgetConfirmHref(data.next.year, data.next.month) as never}
            className="underline"
          >
            予算の確定へ
          </Link>
        </p>
      )}
    </div>
  );
}

const sourceKey = (s: { kind: string; id: number }) => `${s.kind}:${s.id}`;

// ② 実績の確定。明細の最終日をソースごとに出し、全ソースが月末日まで届いたら確定できる。
// 届いていないソースは「当月末まで変動なし」を付ければ、そろったものとして確定できる。
// 確定済みの月は、確定時点の記録（最終日と変動なしの印）を出す（記録の無い古い確定は今の最終日）。
function ActualsCard({
  year,
  month,
  actuals,
  budgetConfirmed,
  nextConfirmed,
  busy,
  noChange,
  onToggleNoChange,
  onConfirm,
  onUnconfirm,
}: {
  year: number;
  month: number;
  actuals: CycleStatus["actuals"];
  budgetConfirmed: boolean;
  nextConfirmed: boolean;
  busy: boolean;
  noChange: Set<string>;
  onToggleNoChange: (key: string) => void;
  onConfirm: () => void;
  onUnconfirm: () => void;
}) {
  const locked = !!actuals.confirmedAt;
  const snapshot = locked ? actuals.confirmedCoverage : null;
  const rows: (ActualsSource & { noChange?: boolean })[] = snapshot
    ? snapshot.sources
    : actuals.sources;
  const lagging = new Set(
    snapshot
      ? snapshot.sources
          .filter((s) => s.lastDate !== null && s.lastDate < snapshot.monthEnd)
          .map(sourceKey)
      : actuals.lagging.map(sourceKey),
  );
  const remaining = actuals.lagging.filter((l) => !noChange.has(sourceKey(l)));
  const ready = actuals.coveredThrough !== null && remaining.length === 0;
  const blockedReason = !budgetConfirmed
    ? `先に${month}月の予算（①）を確定してください。`
    : actuals.coveredThrough === null
      ? "明細を取り込むと確定できます。"
      : !ready
        ? `明細が月末（${formatYmd(actuals.monthEnd)}）までそろうか、届いていないものに「当月末まで変動なし」を付けると確定できます。`
        : actuals.unassigned > 0
          ? `未割り当ての明細（${actuals.unassigned} 件）に科目を付けると確定できます。`
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
            {snapshot && "明細の最終日は、確定した時点の記録です。"}
          </SectionLead>
        )}
      </div>
      {rows.length === 0 ? (
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
              {rows.map((s) => {
                const key = sourceKey(s);
                const late = lagging.has(key);
                // 変動なし: 確定済みなら記録した印、未確定なら画面で付けた印
                const marked = locked ? !!s.noChange : noChange.has(key);
                return (
                  <tr key={key}>
                    <td className="px-4 py-2">{s.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{s.typeLabel}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${late && !marked ? "text-red-600 font-medium" : ""}`}
                    >
                      {s.lastDate ? formatYmd(s.lastDate) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        {s.lastDate === null ? (
                          <span className="text-slate-400">明細なし（判定に含めない）</span>
                        ) : late && marked ? (
                          <span className="text-emerald-700">
                            月末まで変動なし{locked ? "（確定時に記録）" : "（確定時に記録します）"}
                          </span>
                        ) : late ? (
                          <span className="text-red-600">月末まで届いていません</span>
                        ) : (
                          <span className="text-emerald-700">入力済み</span>
                        )}
                        {!locked && late && (
                          <button
                            type="button"
                            aria-pressed={marked}
                            disabled={busy}
                            onClick={() => onToggleNoChange(key)}
                            className={`btn-secondary btn-sm ${marked ? "border-emerald-400 bg-emerald-50 text-emerald-700" : ""}`}
                            title={
                              marked
                                ? "変動なしの印を外します"
                                : `${formatYmd(s.lastDate!)} のあと月末まで取引が無いとして、そろったものとして扱います`
                            }
                          >
                            {marked ? "変動なしを取り消す" : "当月末まで変動なし"}
                          </button>
                        )}
                      </div>
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
            className="btn-secondary"
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
            className="btn-primary"
          >
            {month}月の実績を確定
          </button>
        )}
        {!locked && blockedReason && (
          <span className="text-xs text-amber-700">{blockedReason}</span>
        )}
      </div>
    </div>
  );
}

type UnassignedEntry = {
  id: number;
  kind: "CASH" | "BANK" | "CARD";
  date: string;
  description: string;
  /** +入金 / −出金 */
  amount: number;
  sourceName: string;
  categoryAccountId: number | null;
  businessUse: boolean;
  businessRatio: number | null;
};
type UnassignedResponse = {
  data: UnassignedEntry[];
  unassignedCount: number;
  truncated: boolean;
};
type CategoryAccount = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};

// 明細の種別ごとの科目の変更先（付けた科目は学習し、同じ摘要の未割り当ての明細にも付く）
const CATEGORIZE_PATH: Record<UnassignedEntry["kind"], (id: number) => string> = {
  CASH: (id) => `/api/actuals/${id}/categorize`,
  BANK: (id) => `/api/bank-transactions/${id}/categorize`,
  CARD: (id) => `/api/card-transactions/${id}/categorize`,
};
const KIND_LABEL: Record<UnassignedEntry["kind"], string> = {
  CASH: "現金",
  BANK: "銀行",
  CARD: "カード",
};

// 未割り当て（科目が付いていない）の明細の一覧。行ごとに科目を選ぶと、その明細がそのまま実績になる。
// 残っている間は、その月の実績を確定できない。「割り当て済みも表示」で科目を付けた明細も出し、見直せる。
// 行ごとに事業利用と按分も付けられ、科目と一緒に学習ルールに覚える（lib/ledger/ledger-categorize.ts）。「まとめて自動処理」は、学習ルールで科目を付け、
// 同じ日・同じ金額の送金と受金を振替・チャージの組にする（全期間。確定済みの月は触らない）。
function UnassignedCard({
  year,
  month,
  mode,
  onChanged,
}: {
  year: number;
  month: number;
  mode: ViewMode;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showAssigned, setShowAssigned] = useState(false);
  const { data: list, isLoading } = useQuery({
    queryKey: ["ledger-unassigned", year, month, showAssigned],
    queryFn: async (): Promise<UnassignedResponse> =>
      await (
        await fetch(
          `/api/ledger/unassigned?year=${year}&month=${month}${showAssigned ? "&includeAssigned=1" : ""}`,
        )
      ).json(),
  });
  const entries = list?.data;
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<CategoryAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });
  const categorizable = (accounts ?? []).filter((a) =>
    ["REVENUE", "COGS", "EXPENSE"].includes(a.category),
  );

  function refresh() {
    qc.invalidateQueries({ queryKey: ["ledger-unassigned"] });
    qc.invalidateQueries({ queryKey: ["bank-txns"] });
    qc.invalidateQueries({ queryKey: ["card-txns"] });
    invalidateActuals(qc);
    onChanged();
  }

  // 科目・事業利用の変更。付けたものは学習ルールに覚える（科目の無い明細の事業利用は覚えない）
  async function categorize(
    e: UnassignedEntry,
    change: { categoryAccountId?: number; businessUse?: boolean; businessRatio?: number | null },
  ) {
    setMsg(null);
    const res = await fetch(CATEGORIZE_PATH[e.kind](e.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...change, learn: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const text = typeof json.error === "string" ? json.error : "エラー";
      setMsg({ ok: false, text: `変更に失敗しました: ${text}` });
    } else if ((json.updatedSiblingCount ?? 0) > 0)
      setMsg({
        ok: true,
        text: `同じ摘要の未割り当ての明細 ${json.updatedSiblingCount} 件にも同じ科目を付けました。`,
      });
    refresh();
  }

  // 科目を選んで、その月のその科目の明細をまとめて事業利用にする（按分を空けると科目の事業利用按分の割合）
  const [bulkAccountId, setBulkAccountId] = useState("");
  const [bulkRatio, setBulkRatio] = useState("");
  async function bulkBusiness() {
    const ratio = bulkRatio.trim() === "" ? null : Number(bulkRatio);
    if (ratio !== null && !isValidBusinessRatio(ratio)) {
      setMsg({ ok: false, text: "按分は 0 より大きく 100 以下で入れてください" });
      return;
    }
    setMsg(null);
    const res = await fetch("/api/ledger/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year,
        month,
        categoryAccountId: Number(bulkAccountId),
        businessUse: true,
        businessRatio: ratio,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ ok: false, text: `まとめての変更に失敗しました: ${json.error ?? "エラー"}` });
    } else {
      const r = json.data as { updated: number; locked: number };
      setMsg({
        ok: true,
        text:
          `${r.updated} 件の明細を事業利用にしました。` +
          (r.locked > 0 ? `（実績を確定済みの月の ${r.locked} 件はそのままです）` : ""),
      });
    }
    refresh();
  }

  // reset: 「科目を付け直す」（付いている科目も学習ルールで付け直し、当たらなければ未割り当てに戻す）
  async function autoProcess(reset: boolean) {
    if (
      reset &&
      !window.confirm(
        "実績を確定していない月のすべての明細の科目を、学習ルールで付け直します。ルールに当たらない明細は未割り当てに戻ります（手で選んだ科目も外れます）。よろしいですか？",
      )
    )
      return;
    setProcessing(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/ledger/auto-process?reset=${reset ? 1 : 0}`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: `自動処理に失敗しました: ${json.error ?? "エラー"}` });
      } else {
        const r = json.data as {
          categorized: number;
          cleared: number;
          offsetPairs: number;
          lockedSkipped: number;
        };
        setMsg({
          ok: true,
          text:
            `学習ルールで ${r.categorized} 件に科目を付け` +
            (reset ? `、${r.cleared} 件を未割り当てに戻し` : "") +
            `、${r.offsetPairs} 組を振替・チャージにしました。` +
            (r.lockedSkipped > 0
              ? `（実績を確定済みの月の明細 ${r.lockedSkipped} 件はそのままです）`
              : ""),
        });
      }
      refresh();
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 pt-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="section-title mb-1">
            {showAssigned ? "明細" : "未割り当ての明細"}（{month}月・未割り当て{" "}
            {list?.unassignedCount ?? 0} 件）
          </h3>
          <SectionLead className="mb-2">{ENTRY_HELP.unassigned}</SectionLead>
          <SectionLead className="mb-2">{ENTRY_HELP.businessUse}</SectionLead>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 mb-2">
            <input
              type="checkbox"
              checked={showAssigned}
              onChange={(ev) => setShowAssigned(ev.target.checked)}
            />
            割り当て済みも表示
          </label>
          <TermDetails terms={LEARNING_RULE_TERMS} summary="学習ルールのしくみ" className="mb-3" />
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            disabled={processing}
            onClick={() => autoProcess(false)}
            className="btn-secondary"
            title={ENTRY_HELP.autoProcess}
          >
            {processing ? "処理中…" : "まとめて自動処理"}
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => autoProcess(true)}
            className="btn-secondary"
            title={ENTRY_HELP.recategorize}
          >
            科目を付け直す
          </button>
        </div>
      </div>
      {msg && (
        <div className="px-4 pb-3">
          <Notice tone={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>
            {msg.text}
          </Notice>
        </div>
      )}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-2 text-xs text-slate-700">
        <span>{month}月の</span>
        <select
          value={bulkAccountId}
          onChange={(ev) => setBulkAccountId(ev.target.value)}
          aria-label="まとめて事業利用にする科目"
          className="border border-slate-200 rounded px-1.5 py-1 bg-white"
        >
          <option value="">科目を選ぶ</option>
          {categorizable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {displayName(a, mode)}
            </option>
          ))}
        </select>
        <span>の明細を、按分</span>
        <input
          type="number"
          min={0.01}
          max={100}
          step={0.01}
          value={bulkRatio}
          onChange={(ev) => setBulkRatio(ev.target.value)}
          placeholder="既定"
          aria-label="まとめて付ける按分（%）"
          className="w-20 border border-slate-200 rounded px-1.5 py-1"
        />
        <span>%で</span>
        <button
          type="button"
          disabled={bulkAccountId === ""}
          onClick={bulkBusiness}
          className="btn-secondary btn-sm"
        >
          まとめて{BUSINESS_USE_LABEL}にする
        </button>
      </div>
      {list?.truncated && (
        <p className="px-4 pb-2 text-xs text-amber-700">
          明細が多いため、先頭の 500 件だけを表示しています。
        </p>
      )}
      {isLoading ? (
        <LoadingSpinner />
      ) : (entries ?? []).length === 0 ? (
        <p className="px-4 pb-4 text-sm text-emerald-700">
          {showAssigned
            ? `${month}月の明細はありません。`
            : `${month}月の明細には、すべて科目が付いています。`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                <th className="px-4 py-2 text-left font-semibold">日付</th>
                <th className="px-3 py-2 text-left font-semibold">口座</th>
                <th className="px-3 py-2 text-left font-semibold min-w-44">摘要</th>
                <th className="px-3 py-2 text-right font-semibold">金額</th>
                <th className="px-3 py-2 text-left font-semibold">科目</th>
                <th className="px-3 py-2 text-left font-semibold">{BUSINESS_USE_LABEL}・按分</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(entries ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                    {new Date(e.date).toLocaleDateString("ja-JP")}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {KIND_LABEL[e.kind]}・{e.sourceName}
                  </td>
                  <td className="px-3 py-2">{e.description}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {/* 明細の金額は入金が正（カードの利用も出金として負） */}
                    <DirectedAmount kind="bank" amount={e.amount} />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={e.categoryAccountId ?? ""}
                      onChange={(ev) =>
                        ev.target.value &&
                        categorize(e, { categoryAccountId: Number(ev.target.value) })
                      }
                      aria-label={`${e.description} の科目`}
                      className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white min-w-40"
                    >
                      <option value="">科目を選ぶ</option>
                      {categorizable.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {displayName(a, mode)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <BusinessCell entry={e} onChange={(change) => categorize(e, change)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// 行の事業利用（印）と按分（%）。按分は入れ終えたとき（フォーカスを外したとき）に保存する。
// 空けて保存すると、科目の事業利用按分の割合（無ければ 100%）になる
function BusinessCell({
  entry,
  onChange,
}: {
  entry: UnassignedEntry;
  onChange: (change: { businessUse: boolean; businessRatio?: number | null }) => void;
}) {
  const [ratio, setRatio] = useState(entry.businessRatio?.toString() ?? "");
  useEffect(() => setRatio(entry.businessRatio?.toString() ?? ""), [entry.businessRatio]);
  const invalid = ratio.trim() !== "" && !isValidBusinessRatio(Number(ratio));

  function saveRatio() {
    const next = ratio.trim() === "" ? null : Number(ratio);
    if (invalid || next === entry.businessRatio) return;
    onChange({ businessUse: true, businessRatio: next });
  }

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <label className="inline-flex items-center gap-1 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={entry.businessUse}
          onChange={(ev) => onChange({ businessUse: ev.target.checked })}
          aria-label={`${entry.description} を${BUSINESS_USE_LABEL}にする`}
        />
        事業
      </label>
      {entry.businessUse && (
        <>
          <input
            type="number"
            min={0.01}
            max={100}
            step={0.01}
            value={ratio}
            onChange={(ev) => setRatio(ev.target.value)}
            onBlur={saveRatio}
            onKeyDown={(ev) => ev.key === "Enter" && saveRatio()}
            aria-label={`${entry.description} の按分（%）`}
            aria-invalid={invalid}
            className={`w-16 border rounded px-1.5 py-0.5 text-xs text-right ${
              invalid ? "border-red-400" : "border-slate-200"
            }`}
          />
          <span className="text-xs text-slate-500">%</span>
        </>
      )}
    </div>
  );
}
