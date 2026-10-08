"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LOAN_TYPE_LABEL } from "@/lib/shared/labels";
import {
  buildRateComparison,
  pendingRateChange,
  ratePercent,
  type Loan,
} from "@/lib/shared/loan-schedule";
import { LoanTrendCharts, repaidPercent } from "@/components/LoanTrendCharts";
import { PageHeader } from "@/components/ui";
import { asOfDateLabel } from "@/lib/shared/asset-valuation";
import { VariableRateHelp } from "@/components/HelpTip";
import { SectionLead } from "@/components/Explain";
import { LOANS_HELP } from "@/lib/shared/help-texts";
import { yen } from "@/lib/common/format";
import { LoanAddModal, LoanEditModal } from "@/components/loans/LoanFormModals";
import { PendingPaymentModal, RateChangeModal } from "@/components/loans/LoanRateModals";
import { RepayModal } from "@/components/loans/RepayModal";
import type { AccountRef, AssetRef, BankAccountRef, PendingChange } from "@/components/loans/types";

// ── ページ ──────────────────────────────────────────────────────
export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<AccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRef[]>([]);
  // 開いているモーダル（各モーダルは components/loans/ に置き、入力の状態と保存はモーダル側が持つ）
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [rateLoan, setRateLoan] = useState<Loan | null>(null);
  const [payLoan, setPayLoan] = useState<Loan | null>(null);
  const [pendingTarget, setPendingTarget] = useState<{ loan: Loan; change: PendingChange } | null>(
    null,
  );

  const load = () => {
    setLoading(true);
    fetch("/api/loans")
      .then((r) => r.json())
      .then((j) => {
        setLoans(j.data ?? []);
        setLoading(false);
      });
    // 引き落とし口座の候補
    fetch("/api/bank-accounts")
      .then((r) => r.json())
      .then((j) => setBankAccounts(j.data ?? []))
      .catch(() => setBankAccounts([]));
    // ひも付ける資産の候補（ローンの無い資産）
    fetch("/api/personal-assets")
      .then((r) => r.json())
      .then((j) => setAssets(j.data ?? []))
      .catch(() => setAssets([]));
  };

  useEffect(() => {
    load();
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((j) => setAccounts(j.data ?? []));
  }, []);

  return (
    <AppShell>
      <PageHeader title="借入金管理" lead={LOANS_HELP.page} />

      {/* 改定後の返済額が未入力の借入があれば、上で 1 行だけ知らせる（カードまで下りなくても気づけるように） */}
      {(() => {
        const pendingLoans = loans.filter((l) => pendingRateChange(l) !== null);
        if (pendingLoans.length === 0) return null;
        return (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            金利が改定され、改定後の返済額が未入力の借入があります（
            {pendingLoans.map((l) => l.lenderName).join("、")}
            ）。下の一覧の「入力する」から反映してください。
          </div>
        );
      })()}

      {/* 借入残高の推移（合計とローンごとの残高・金利。資産管理の評価額の推移と同じ形） */}
      {!loading && <LoanTrendCharts loans={loans} />}

      {/* ── 借入金（資産管理の「実物資産」と同じく 1 枚のカードにまとめ、ローンは枠線つきの行で並べる）── */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="section-title mb-1">借入金（住宅ローン・カーローンなど）</h2>
            <SectionLead className="mb-1">{LOANS_HELP.list}</SectionLead>
            {loans.length > 0 && (
              <p className="text-xs text-slate-400 mt-0.5">
                {asOfDateLabel(new Date())}の残高合計:{" "}
                {yen(
                  loans
                    .filter((l) => l.status === "active")
                    .reduce((sum, l) => sum + Number(l.remainingAmount), 0),
                )}{" "}
                ・ {loans.length} 件
              </p>
            )}
          </div>
          <button onClick={() => setAdding(true)} className="btn-primary shrink-0">
            借入追加
          </button>
        </div>

        {/* ローン一覧 */}
        {loading ? (
          <p className="text-slate-400 text-sm">読み込み中…</p>
        ) : loans.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <p className="text-4xl mb-3">🏦</p>
            <p className="text-sm max-w-md mx-auto">{LOANS_HELP.empty}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {loans.map((l) => (
              <div key={l.id} className="border border-slate-100 rounded-lg px-3 py-3">
                {/* 金利が改定されたが、改定後の実額返済額がまだ入力されていない（カードのいちばん上に横幅いっぱいで出す） */}
                {(() => {
                  const pending = pendingRateChange(l);
                  if (!pending) return null;
                  const calc = pending.calculatedMonthlyPayment;
                  return (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs font-semibold text-amber-800">
                          {pending.effectiveOn.slice(0, 7)} に金利が
                          {ratePercent(pending.interestRate).toFixed(2)}%
                          へ改定されました。改定後の返済額を入力してください
                        </span>
                        <VariableRateHelp />
                        <button
                          onClick={() => setPendingTarget({ loan: l, change: pending })}
                          className="ml-auto rounded-lg bg-amber-600 px-2.5 py-1 text-xs text-white hover:bg-amber-700"
                        >
                          入力する
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-amber-700">
                        現在は改定前の{l.monthlyPayment ? yen(Number(l.monthlyPayment)) : "—"}
                        で計算中です。
                        {calc && `計算上の目安は ${yen(Number(calc))} です。`}5
                        年ルールなら「据え置き」を選ぶだけで反映できます（通知額が違うときは入力してください）。
                      </p>
                    </div>
                  );
                })()}
                {/* 資産管理の一覧と同じ並び: 左に名前と条件、右に日付つきの残高と操作 */}
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType}
                      </span>
                      <h3 className="font-medium text-slate-800 text-sm">{l.lenderName}</h3>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${l.status === "active" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}
                      >
                        {l.status === "active" ? "返済中" : "完済"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      借入額: {yen(Number(l.amount))} ・ 金利:{" "}
                      {(Number(l.interestRate) * 100).toFixed(3)}% ・ 借入日:{" "}
                      {l.borrowedOn.slice(0, 7)} ・ 完済予定: {l.repaymentDate.slice(0, 7)} ・{" "}
                      {repaidPercent(l)}% 返済済
                    </div>
                    {(l.monthlyPayment || l.linkedAccount || Number(l.residualValue ?? 0) > 0) && (
                      <div className="text-xs text-indigo-600 mt-0.5">
                        {l.monthlyPayment && (
                          <span>
                            月々の返済額: {yen(Number(l.monthlyPayment))}
                            <span className="ml-1 text-slate-400">
                              {l.monthlyPaymentIsManual ? "（実額）" : "（計算値）"}
                            </span>
                          </span>
                        )}
                        {Number(l.residualValue ?? 0) > 0 && (
                          <span> ・ 残価: {yen(Number(l.residualValue))}（最終回に一括）</span>
                        )}
                        {l.linkedAccount && (
                          <span>
                            {" "}
                            ・ 予算連携先: {l.linkedAccount.code} {l.linkedAccount.name}（自動加算）
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-slate-500 mt-0.5">
                      {l.debitBankAccount && l.debitDay ? (
                        <>
                          引き落とし: {l.debitBankAccount.name} ・ 毎月{l.debitDay}日
                          {l.debitCoveredByRule
                            ? "（同じ返済の資金移動ルールがあるため、資金繰りにはそちらを使っています）"
                            : "（資金繰りに自動で入ります）"}
                        </>
                      ) : (
                        <span className="text-slate-400">
                          引き落とし口座と日を入れると、返済が資金繰りに自動で入ります（「編集」から）
                        </span>
                      )}
                    </div>
                    {l.personalAsset && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        この借入で買った資産: {l.personalAsset.name} ・{" "}
                        <Link href={"/assets" as never} className="underline text-indigo-600">
                          資産管理で見る
                        </Link>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400">
                        {asOfDateLabel(new Date())}の残高
                      </p>
                      <p className="font-bold text-rose-600 text-sm tabular-nums">
                        {yen(Number(l.remainingAmount))}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={() => setEditing(l)}
                        className="text-xs text-indigo-500 hover:text-indigo-700"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => setRateLoan(l)}
                        className="text-xs text-amber-600 hover:text-amber-800"
                      >
                        金利変更
                      </button>
                      {l.status === "active" && (
                        <button
                          onClick={() => setPayLoan(l)}
                          className="text-xs text-emerald-600 hover:text-emerald-800"
                        >
                          返済登録
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {l.repayments.length > 0 && (
                  <details className="text-sm">
                    <summary className="text-indigo-600 cursor-pointer hover:underline text-xs">
                      返済履歴 ({l.repayments.length}件)
                    </summary>
                    <table className="mt-2 w-full text-xs">
                      <thead className="text-slate-500">
                        <tr>
                          {["返済日", "元金", "利息", "合計"].map((h) => (
                            <th key={h} className="text-left pb-1 pr-4">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {l.repayments.map((r) => (
                          <tr key={r.id}>
                            <td className="pr-4 py-0.5">{r.repaidOn.slice(0, 10)}</td>
                            <td className="pr-4">{yen(Number(r.principal))}</td>
                            <td className="pr-4">{yen(Number(r.interest))}</td>
                            <td>{yen(Number(r.totalAmount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}

                {/* 金利変更履歴と、変動前後の比較 */}
                {l.rateChanges.length > 0 && (
                  <details className="text-sm mt-2">
                    <summary className="text-amber-700 cursor-pointer hover:underline text-xs">
                      金利変更履歴 ({l.rateChanges.length}件) と 変動前後の比較
                    </summary>
                    <div className="overflow-x-auto">
                      <table className="mt-2 w-full min-w-[560px] text-xs">
                        <thead className="text-slate-500">
                          <tr>
                            {["適用日", "金利", "増減", "返済額（改定前 → 改定後）", "メモ"].map(
                              (h) => (
                                <th key={h} className="text-left pb-1 pr-4 whitespace-nowrap">
                                  {h}
                                  {h.startsWith("返済額") && <VariableRateHelp className="ml-1" />}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {l.rateChanges.map((c) => {
                            const diff = ratePercent(c.interestRate) - ratePercent(c.previousRate);
                            const before = c.previousMonthlyPayment;
                            const after = c.monthlyPayment;
                            const calc = c.calculatedMonthlyPayment;
                            return (
                              <tr key={c.id} className="align-top">
                                <td className="pr-4 py-0.5 whitespace-nowrap">
                                  {c.effectiveOn.slice(0, 10)}
                                </td>
                                <td className="pr-4 whitespace-nowrap">
                                  {ratePercent(c.previousRate).toFixed(2)}% →{" "}
                                  <span className="font-medium">
                                    {ratePercent(c.interestRate).toFixed(2)}%
                                  </span>
                                </td>
                                <td
                                  className={`pr-4 whitespace-nowrap ${diff > 0 ? "text-red-600" : diff < 0 ? "text-green-600" : "text-slate-400"}`}
                                >
                                  {diff > 0 ? "+" : ""}
                                  {diff.toFixed(2)}pt
                                </td>
                                <td className="pr-4">
                                  <span className="whitespace-nowrap">
                                    {before ? yen(Number(before)) : "—"} →{" "}
                                    {after ? (
                                      <span className="font-medium text-slate-700">
                                        {yen(Number(after))}
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => setPendingTarget({ loan: l, change: c })}
                                        className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 hover:bg-amber-200"
                                      >
                                        未入力
                                      </button>
                                    )}
                                  </span>
                                  {calc && (
                                    <span className="block text-[10px] text-slate-400">
                                      計算上の目安 {yen(Number(calc))}
                                    </span>
                                  )}
                                </td>
                                <td className="text-slate-500">{c.note ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {(() => {
                      const cmp = buildRateComparison(l);
                      if (!cmp) return null;
                      const diffTotal = cmp.afterTotal - cmp.beforeTotal;
                      return (
                        <div className="mt-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-[10px] text-slate-500">総支払額（変動前）</div>
                              <div className="text-xs font-semibold text-slate-700">
                                {yen(cmp.beforeTotal)}
                              </div>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-[10px] text-slate-500">総支払額（変動後）</div>
                              <div className="text-xs font-semibold text-slate-700">
                                {yen(cmp.afterTotal)}
                              </div>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-3 py-2">
                              <div className="text-[10px] text-slate-500">
                                総利息（変動前 → 後）
                              </div>
                              <div className="text-xs font-semibold text-slate-700">
                                {yen(cmp.beforeInterest)} → {yen(cmp.afterInterest)}
                              </div>
                            </div>
                            <div
                              className={`rounded-lg px-3 py-2 ${diffTotal > 0 ? "bg-red-50" : "bg-green-50"}`}
                            >
                              <div className="text-[10px] text-slate-500">総支払額の差</div>
                              <div
                                className={`text-xs font-semibold ${diffTotal > 0 ? "text-red-600" : "text-green-600"}`}
                              >
                                {diffTotal > 0 ? "+" : ""}
                                {yen(diffTotal)}
                              </div>
                            </div>
                          </div>
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart
                              data={cmp.points}
                              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={28} />
                              <YAxis
                                tickFormatter={(v) => `${Math.round(v / 10000)}万`}
                                tick={{ fontSize: 9 }}
                                width={44}
                              />
                              <Tooltip
                                formatter={(v: number, name: string) => [yen(v), name]}
                                contentStyle={{ fontSize: 12 }}
                              />
                              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                              <Line
                                type="monotone"
                                dataKey="before"
                                name="変動前（当初金利のまま）"
                                stroke="#94a3b8"
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                dot={false}
                              />
                              <Line
                                type="monotone"
                                dataKey="after"
                                name="変動後（金利変更を反映）"
                                stroke="#dc2626"
                                strokeWidth={2}
                                dot={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                          <p className="text-[10px] text-slate-400 mt-1">
                            借入額 {yen(Number(l.amount))} を借入日〜支払い完了年月で償還した場合の
                            残高推移。
                            {l.monthlyPayment
                              ? `月々の返済額は${l.monthlyPaymentIsManual ? "入力された実額" : "登録済みの金額"}で据え置き（金利上昇分は元本充当が減ります）。`
                              : "金利変更月に残高と残回数から月額を再計算しています。"}
                          </p>
                        </div>
                      );
                    })()}
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && (
        <LoanAddModal
          accounts={accounts}
          bankAccounts={bankAccounts}
          assets={assets}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {editing && (
        <LoanEditModal
          loan={editing}
          accounts={accounts}
          bankAccounts={bankAccounts}
          assets={assets}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {rateLoan && (
        <RateChangeModal
          loan={rateLoan}
          onClose={() => setRateLoan(null)}
          onSaved={() => {
            setRateLoan(null);
            load();
          }}
        />
      )}
      {pendingTarget && (
        <PendingPaymentModal
          loan={pendingTarget.loan}
          change={pendingTarget.change}
          onClose={() => setPendingTarget(null)}
          onSaved={() => {
            setPendingTarget(null);
            load();
          }}
        />
      )}
      {payLoan && (
        <RepayModal
          loan={payLoan}
          onClose={() => setPayLoan(null)}
          onSaved={() => {
            setPayLoan(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}
