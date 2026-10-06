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
import {
  LOAN_TYPES,
  LOAN_TYPE_LABEL,
  PERSONAL_ASSET_CATEGORY_LABEL,
  type PersonalAssetCategory,
} from "@/lib/labels";
import {
  buildRateComparison,
  pendingRateChange,
  ratePercent,
  referenceMonthly,
  pendingPaymentChoices,
  type Loan,
  type LoanRateChange,
  type PaymentChoice,
} from "@/lib/loan-schedule";
import { LoanTrendCharts, repaidPercent } from "@/components/LoanTrendCharts";
import { PageHeader } from "@/components/ui";
import { asOfDateLabel } from "@/lib/asset-valuation";
import { VariableRateHelp } from "@/components/HelpTip";
import { SectionLead } from "@/components/Explain";
import { LOANS_HELP } from "@/lib/help-texts";

type AccountRef = { id: number; code: string; name: string; category: string };
type AssetRef = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  loanId: number | null;
};

/** ローンの種別から、その場で作る資産の種別の既定を決める（住宅→建物、カー→車） */
const assetCategoryForLoanType = (loanType: string): PersonalAssetCategory =>
  loanType === "housing" ? "BUILDING" : loanType === "car" ? "VEHICLE" : "OTHER";

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

// ── ページ ──────────────────────────────────────────────────────
export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<AccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [payForm, setPayForm] = useState<{
    loanId: number | null;
    principal: string;
    interest: string;
    repaidOn: string;
  }>({
    loanId: null,
    principal: "",
    interest: "0",
    repaidOn: new Date().toISOString().slice(0, 10),
  });
  const [newLoan, setNewLoan] = useState({
    lenderName: "",
    amount: "",
    interestRate: "0",
    borrowedOn: "",
    repaymentDate: "",
    note: "",
    loanType: "business",
    linkedAccountCode: "",
    monthlyPayment: "",
    residualValue: "",
  });
  // この借入で買った資産（任意）。その場で作るか、ローンの無い既存の資産を選ぶ
  const [newAsset, setNewAsset] = useState<{
    mode: "none" | "new" | "link";
    name: string;
    category: PersonalAssetCategory;
    acquisitionCost: string;
    currentValue: string;
    assetId: string;
  }>({
    mode: "none",
    name: "",
    category: "OTHER",
    acquisitionCost: "",
    currentValue: "",
    assetId: "",
  });
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [editForm, setEditForm] = useState<{
    loanId: number | null;
    amount: string;
    borrowedOn: string;
    interestRate: string;
    /** 金利変更の履歴があるローンは、金利は「金利変更」で直す */
    rateEditable: boolean;
    repaymentDate: string;
    monthlyPayment: string;
    residualValue: string;
    linkedAccountCode: string;
    /** この借入で買った資産（"" = なし） */
    assetId: string;
  }>({
    loanId: null,
    amount: "",
    borrowedOn: "",
    interestRate: "",
    rateEditable: false,
    assetId: "",
    repaymentDate: "",
    monthlyPayment: "",
    residualValue: "",
    linkedAccountCode: "",
  });
  const [rateForm, setRateForm] = useState<{
    loanId: number | null;
    effectiveOn: string;
    interestRate: string;
    monthlyPayment: string;
    note: string;
  }>({
    loanId: null,
    effectiveOn: new Date().toISOString().slice(0, 10),
    interestRate: "",
    monthlyPayment: "",
    note: "",
  });
  const [rateError, setRateError] = useState<string | null>(null);
  // 改定後の実額を後から入力するフォーム（改定登録時に通知が届いていなかった場合）。
  // 据え置き（5 年ルール）・再計算された額・通知額の入力から選ぶ（lib/loan-schedule.ts の pendingPaymentChoices）
  const [pendingForm, setPendingForm] = useState<{
    loanId: number | null;
    changeId: number | null;
    monthlyPayment: string;
    choices: PaymentChoice[];
    choice: PaymentChoice["key"];
  }>({ loanId: null, changeId: null, monthlyPayment: "", choices: [], choice: "custom" });
  const closePending = () =>
    setPendingForm({
      loanId: null,
      changeId: null,
      monthlyPayment: "",
      choices: [],
      choice: "custom",
    });
  // 既定は先頭の選択肢（据え置きがあれば据え置き）
  const openPending = (
    loan: Loan,
    change: Pick<LoanRateChange, "id" | "previousMonthlyPayment" | "calculatedMonthlyPayment">,
  ) => {
    const choices = pendingPaymentChoices(loan, change);
    const first = choices[0];
    setPendingForm({
      loanId: loan.id,
      changeId: change.id,
      monthlyPayment: first.amount !== null ? String(first.amount) : "",
      choices,
      choice: first.key,
    });
  };

  const load = () => {
    setLoading(true);
    fetch("/api/loans")
      .then((r) => r.json())
      .then((j) => {
        setLoans(j.data ?? []);
        setLoading(false);
      });
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

  const saveLoan = async () => {
    // 資産の取得価格の既定は借入額、評価額の既定は取得価格、取得日の既定は借入日
    const cost = newAsset.acquisitionCost
      ? Number(newAsset.acquisitionCost)
      : Number(newLoan.amount);
    const asset =
      newAsset.mode === "new"
        ? {
            mode: "new",
            name: newAsset.name || newLoan.lenderName,
            category: newAsset.category,
            acquiredOn: newLoan.borrowedOn || undefined,
            acquisitionCost: cost,
            currentValue: newAsset.currentValue ? Number(newAsset.currentValue) : cost,
          }
        : newAsset.mode === "link" && newAsset.assetId
          ? { mode: "link", assetId: Number(newAsset.assetId) }
          : undefined;
    const r = await fetch("/api/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newLoan,
        amount: Number(newLoan.amount),
        interestRate: Number(newLoan.interestRate),
        linkedAccountCode: newLoan.linkedAccountCode || undefined,
        monthlyPayment: newLoan.monthlyPayment ? Number(newLoan.monthlyPayment) : undefined,
        residualValue: newLoan.residualValue ? Number(newLoan.residualValue) : undefined,
        asset,
      }),
    });
    if (r.ok) {
      setShowForm(false);
      setNewAsset({
        mode: "none",
        name: "",
        category: "OTHER",
        acquisitionCost: "",
        currentValue: "",
        assetId: "",
      });
      load();
    }
  };

  const repay = async () => {
    if (!payForm.loanId) return;
    const r = await fetch(`/api/loans/${payForm.loanId}/repay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repaidOn: payForm.repaidOn,
        principal: Number(payForm.principal),
        interest: Number(payForm.interest),
      }),
    });
    if (r.ok) {
      setPayForm((f) => ({ ...f, loanId: null }));
      load();
    }
  };

  // 金利変更の登録。履歴に1行積み、最新の変更なら現在金利も更新される（API 側）。
  // 月々の返済額は実額が入力されたときだけ反映される（未入力なら従来額を据え置き、後から入力可能）
  const saveRateChange = async () => {
    if (!rateForm.loanId) return;
    setRateError(null);
    const r = await fetch(`/api/loans/${rateForm.loanId}/interest-rates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        effectiveOn: rateForm.effectiveOn,
        interestRate: Number(rateForm.interestRate),
        monthlyPayment: rateForm.monthlyPayment ? Number(rateForm.monthlyPayment) : null,
        note: rateForm.note || undefined,
      }),
    });
    if (r.ok) {
      setRateForm((f) => ({ ...f, loanId: null, interestRate: "", monthlyPayment: "", note: "" }));
      load();
    } else {
      const j = await r.json().catch(() => null);
      setRateError(j?.error ?? "金利変更の登録に失敗しました");
    }
  };

  // 金利改定後の実額を後から入力する
  const savePendingMonthly = async () => {
    const { loanId, changeId, monthlyPayment } = pendingForm;
    if (!loanId || !changeId || !monthlyPayment) return;
    const r = await fetch(`/api/loans/${loanId}/interest-rates/${changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyPayment: Number(monthlyPayment) }),
    });
    if (r.ok) {
      closePending();
      load();
    }
  };

  const openEdit = (l: Loan) => {
    setEditForm({
      loanId: l.id,
      amount: l.amount,
      borrowedOn: l.borrowedOn.slice(0, 10),
      interestRate: l.interestRate,
      rateEditable: l.rateChanges.length === 0,
      assetId: l.personalAsset ? String(l.personalAsset.id) : "",
      repaymentDate: l.repaymentDate.slice(0, 10),
      monthlyPayment: l.monthlyPayment ?? "",
      residualValue: l.residualValue ?? "",
      linkedAccountCode: l.linkedAccount?.code ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editForm.loanId) return;
    const r = await fetch(`/api/loans/${editForm.loanId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(editForm.amount),
        borrowedOn: editForm.borrowedOn,
        ...(editForm.rateEditable && { interestRate: Number(editForm.interestRate) }),
        repaymentDate: editForm.repaymentDate,
        monthlyPayment: editForm.monthlyPayment ? Number(editForm.monthlyPayment) : null,
        residualValue: editForm.residualValue ? Number(editForm.residualValue) : null,
        linkedAccountCode: editForm.linkedAccountCode || null,
        assetId: editForm.assetId ? Number(editForm.assetId) : null,
      }),
    });
    if (r.ok) {
      setEditForm((f) => ({ ...f, loanId: null }));
      load();
    }
  };

  return (
    <AppShell>
      <PageHeader title="借入金管理" lead={LOANS_HELP.page} />

      {/* 借入残高の推移（合計とローンごとの残高・金利。資産管理の評価額の推移と同じ形） */}
      {!loading && <LoanTrendCharts loans={loans} />}

      {/* 借入追加。借入残高の推移の下・ローン一覧の直前に置く */}
      <div className="flex items-end justify-between gap-3 mb-3">
        {loans.length > 0 ? (
          <SectionLead className="mb-0">{LOANS_HELP.list}</SectionLead>
        ) : (
          <span />
        )}
        <button onClick={() => setShowForm(true)} className="btn-primary shrink-0">
          借入追加
        </button>
      </div>

      {/* ローン一覧 */}
      {loading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : loans.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🏦</p>
          <p className="text-sm max-w-md mx-auto">{LOANS_HELP.empty}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {loans.map((l) => (
            <div key={l.id} className="card">
              {/* 資産管理の一覧と同じ並び: 左に名前と条件、右に日付つきの残高と操作 */}
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType}
                    </span>
                    <h2 className="font-medium text-slate-800 text-sm">{l.lenderName}</h2>
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
                  {l.personalAsset && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      この借入で買った資産: {l.personalAsset.name} ・{" "}
                      <Link href={"/assets" as never} className="underline text-indigo-600">
                        資産管理で見る
                      </Link>
                    </div>
                  )}
                  {/* 金利が改定されたが、改定後の実額返済額がまだ入力されていない */}
                  {(() => {
                    const pending = pendingRateChange(l);
                    if (!pending) return null;
                    const calc = pending.calculatedMonthlyPayment;
                    return (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs font-semibold text-amber-800">
                            {pending.effectiveOn.slice(0, 7)} に金利が
                            {ratePercent(pending.interestRate).toFixed(2)}%
                            へ改定されました。改定後の返済額を入力してください
                          </span>
                          <VariableRateHelp />
                          <button
                            onClick={() => openPending(l, pending)}
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
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400">{asOfDateLabel(new Date())}の残高</p>
                    <p className="font-bold text-rose-600 text-sm tabular-nums">
                      {yen(Number(l.remainingAmount))}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={() => openEdit(l)}
                      className="text-xs text-indigo-500 hover:text-indigo-700"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => {
                        setRateError(null);
                        setRateForm({
                          loanId: l.id,
                          effectiveOn: new Date().toISOString().slice(0, 10),
                          interestRate: l.interestRate,
                          monthlyPayment: "",
                          note: "",
                        });
                      }}
                      className="text-xs text-amber-600 hover:text-amber-800"
                    >
                      金利変更
                    </button>
                    {l.status === "active" && (
                      <button
                        onClick={() =>
                          setPayForm({
                            loanId: l.id,
                            principal: "",
                            interest: "0",
                            repaidOn: new Date().toISOString().slice(0, 10),
                          })
                        }
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
                                      onClick={() => openPending(l, c)}
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
                            <div className="text-[10px] text-slate-500">総利息（変動前 → 後）</div>
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

      {/* 借入追加モーダル */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md my-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-4">借入追加</h2>
            <div className="space-y-3">
              {(
                [
                  ["lenderName", "借入先 *"],
                  ["amount", "借入金額（円）*"],
                  ["interestRate", "年利率（例: 0.03）"],
                  ["borrowedOn", "借入日 *", "date"],
                  ["repaymentDate", "支払い完了年月（完済予定日）*", "date"],
                ] as [keyof typeof newLoan, string, string?][]
              ).map(([k, label, type]) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                  <input
                    type={type ?? "text"}
                    value={newLoan[k]}
                    onChange={(e) => setNewLoan((f) => ({ ...f, [k]: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">借入種別</label>
                <select
                  value={newLoan.loanType}
                  onChange={(e) => setNewLoan((f) => ({ ...f, loanType: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  {LOAN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* 予算連携は住宅ローン以外（カーローン等）でも使えるよう常に表示する */}
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    予算連携先科目（例: 家賃・借入返済）
                  </label>
                  <select
                    value={newLoan.linkedAccountCode}
                    onChange={(e) =>
                      setNewLoan((f) => ({ ...f, linkedAccountCode: e.target.value }))
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">選択してください</option>
                    {accounts
                      .filter((a) => a.category === "EXPENSE" || a.category === "LIABILITY")
                      .map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} {a.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    月々の返済額（円）
                  </label>
                  <input
                    type="number"
                    value={newLoan.monthlyPayment}
                    onChange={(e) => setNewLoan((f) => ({ ...f, monthlyPayment: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    支払い完了年月まで、連携先科目の予算に毎月自動加算されます。
                  </p>
                </div>
              </>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">残価（円）</label>
                <input
                  type="number"
                  min={0}
                  placeholder="残価設定ローンのみ"
                  value={newLoan.residualValue}
                  onChange={(e) => setNewLoan((f) => ({ ...f, residualValue: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* この借入で買った資産（その場で作るか、ローンの無い既存の資産を選ぶ） */}
              <fieldset className="rounded-lg border border-slate-200 px-3 py-2">
                <legend className="px-1 text-sm font-medium text-slate-600">
                  この借入で買った資産
                </legend>
                <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                  {(
                    [
                      ["none", "なし"],
                      ["new", "新しく作る"],
                      ["link", "既存から選ぶ"],
                    ] as const
                  ).map(([mode, label]) => (
                    <label key={mode} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="new-loan-asset"
                        checked={newAsset.mode === mode}
                        onChange={() =>
                          setNewAsset((a) => ({
                            ...a,
                            mode,
                            // 新しく作るときの既定: 名前は借入先、種別はローンの種別から
                            ...(mode === "new" && {
                              name: a.name || newLoan.lenderName,
                              category: assetCategoryForLoanType(newLoan.loanType),
                            }),
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {newAsset.mode === "new" && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs text-slate-600">資産名</span>
                      <input
                        value={newAsset.name}
                        placeholder={newLoan.lenderName}
                        onChange={(e) => setNewAsset((a) => ({ ...a, name: e.target.value }))}
                        className="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-600">種別</span>
                      <select
                        value={newAsset.category}
                        onChange={(e) =>
                          setNewAsset((a) => ({
                            ...a,
                            category: e.target.value as PersonalAssetCategory,
                          }))
                        }
                        className="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                      >
                        {Object.entries(PERSONAL_ASSET_CATEGORY_LABEL).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-600">取得価格（円）</span>
                      <input
                        type="number"
                        min={0}
                        placeholder={newLoan.amount || "借入額"}
                        value={newAsset.acquisitionCost}
                        onChange={(e) =>
                          setNewAsset((a) => ({ ...a, acquisitionCost: e.target.value }))
                        }
                        className="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-600">評価額（円）</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="取得価格と同じ"
                        value={newAsset.currentValue}
                        onChange={(e) =>
                          setNewAsset((a) => ({ ...a, currentValue: e.target.value }))
                        }
                        className="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                )}
                {newAsset.mode === "link" && (
                  <select
                    value={newAsset.assetId}
                    onChange={(e) => setNewAsset((a) => ({ ...a, assetId: e.target.value }))}
                    className="mt-2 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">資産を選んでください</option>
                    {assets
                      .filter((a) => a.loanId === null)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}（{PERSONAL_ASSET_CATEGORY_LABEL[a.category] ?? a.category}）
                        </option>
                      ))}
                  </select>
                )}
                <p className="mt-1 text-[11px] text-slate-400">{LOANS_HELP.asset}</p>
              </fieldset>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">備考</label>
                <input
                  value={newLoan.note}
                  onChange={(e) => setNewLoan((f) => ({ ...f, note: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={saveLoan}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 借入編集モーダル（支払い完了年月・月々の返済額・予算連携先） */}
      {editForm.loanId && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md my-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-4">借入条件の編集</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    借入金額（円）
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.amount}
                    onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">借入日</label>
                  <input
                    type="date"
                    value={editForm.borrowedOn}
                    onChange={(e) => setEditForm((f) => ({ ...f, borrowedOn: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  年利率（例: 0.03）
                </label>
                <input
                  type="number"
                  step="0.0001"
                  disabled={!editForm.rateEditable}
                  value={editForm.interestRate}
                  onChange={(e) => setEditForm((f) => ({ ...f, interestRate: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                />
                {!editForm.rateEditable && (
                  <p className="text-xs text-slate-400 mt-1">
                    金利変更の履歴があるローンは、「金利変更」から登録してください。
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  支払い完了年月（完済予定日）*
                </label>
                <input
                  type="date"
                  value={editForm.repaymentDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, repaymentDate: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  予算連携先科目（例: 家賃）
                </label>
                <select
                  value={editForm.linkedAccountCode}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, linkedAccountCode: e.target.value }))
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">連携なし</option>
                  {accounts
                    .filter((a) => a.category === "EXPENSE" || a.category === "LIABILITY")
                    .map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600 mb-1">
                  月々の返済額（円）
                  <VariableRateHelp />
                </label>
                <input
                  type="number"
                  value={editForm.monthlyPayment}
                  onChange={(e) => setEditForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">
                  連携先科目を設定すると、支払い完了年月まで予算に毎月自動加算されます。
                  入力した金額は実額として扱われ、金利改定や資産の編集では上書きされません。
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">残価（円）</label>
                <input
                  type="number"
                  min={0}
                  placeholder="残価設定ローンのみ"
                  value={editForm.residualValue}
                  onChange={(e) => setEditForm((f) => ({ ...f, residualValue: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">
                  残価設定ローン（カーローン等）で最終回に一括して支払う据置額。
                  入力すると毎月はこの額を除いた分だけを償却し、最終回に残価が残る計算になります。
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  この借入で買った資産
                </label>
                <select
                  value={editForm.assetId}
                  onChange={(e) => setEditForm((f) => ({ ...f, assetId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">なし</option>
                  {assets
                    .filter((a) => a.loanId === null || a.loanId === editForm.loanId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}（{PERSONAL_ASSET_CATEGORY_LABEL[a.category] ?? a.category}）
                      </option>
                    ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">{LOANS_HELP.asset}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditForm((f) => ({ ...f, loanId: null }))}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={saveEdit}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 金利変更モーダル */}
      {rateForm.loanId &&
        (() => {
          const loan = loans.find((l) => l.id === rateForm.loanId);
          const ref =
            loan && rateForm.interestRate !== ""
              ? referenceMonthly(loan, rateForm.effectiveOn, Number(rateForm.interestRate))
              : null;
          const current = loan?.monthlyPayment ? Number(loan.monthlyPayment) : null;
          return (
            <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm my-auto">
                <h2 className="text-lg font-bold text-slate-800 mb-1">金利変更の登録</h2>
                <p className="text-xs text-slate-500 mb-4">
                  変更前の金利は履歴として残り、変動前後の返済スケジュールを比較できます。
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      金利変更日（適用開始）
                    </label>
                    <input
                      type="date"
                      value={rateForm.effectiveOn}
                      onChange={(e) => setRateForm((f) => ({ ...f, effectiveOn: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      変更後の年利率（例: 0.03 = 3%）
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={rateForm.interestRate}
                      onChange={(e) => setRateForm((f) => ({ ...f, interestRate: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      現在: {ratePercent(rateForm.interestRate || 0).toFixed(2)}%
                    </p>
                  </div>
                  <div className="border-t border-slate-100 pt-3">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600 mb-1">
                      改定後の月々の返済額（実額）
                      <VariableRateHelp />
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        placeholder={ref ? `参考: ${ref.monthly}` : "金融機関の通知額"}
                        value={rateForm.monthlyPayment}
                        onChange={(e) =>
                          setRateForm((f) => ({ ...f, monthlyPayment: e.target.value }))
                        }
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      />
                      {current !== null && (
                        <button
                          type="button"
                          onClick={() =>
                            setRateForm((f) => ({ ...f, monthlyPayment: String(current) }))
                          }
                          className="shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-600 hover:bg-slate-50"
                          title="5 年ルールで返済額が変わらないときに押します"
                        >
                          据え置き（{yen(current)}）
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 space-y-1 text-xs">
                      <p className="text-slate-500">
                        金融機関から通知された金額を入力してください。入力するとこの額で残高・
                        予算が再計算されます。
                      </p>
                      {current !== null && (
                        <p className="text-slate-400">現在の返済額: {yen(current)}</p>
                      )}
                      {ref && (
                        <p className="text-slate-400">
                          計算上の目安: {yen(ref.monthly)}（残高 {yen(ref.balance)} ÷ 残り{" "}
                          {ref.remainingMonths}回）
                        </p>
                      )}
                      {ref && current !== null && current !== ref.monthly && (
                        <p className="rounded bg-amber-50 px-2 py-1.5 text-amber-700">
                          5 年ルールのローンなら、金利が変わっても返済額は{yen(current)}
                          のまま据え置かれます。通知が届いていなければ空欄のままで構いません（後から
                          入力できます）。
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">メモ</label>
                    <input
                      type="text"
                      placeholder="例: 変動金利見直し"
                      value={rateForm.note}
                      onChange={(e) => setRateForm((f) => ({ ...f, note: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {rateError && <p className="text-xs text-red-600">{rateError}</p>}
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setRateForm((f) => ({ ...f, loanId: null }))}
                    className="px-4 py-2 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={saveRateChange}
                    disabled={rateForm.interestRate === ""}
                    className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40"
                  >
                    登録
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* 金利改定後の実額を後から入力するモーダル */}
      {pendingForm.changeId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="flex items-center gap-1.5 text-lg font-bold text-slate-800 mb-1">
              改定後の返済額を入力
              <VariableRateHelp />
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              金融機関の通知どおりの返済額を選んでください。5
              年ルールなら「据え置き」のまま反映します。 以降の残高・予算がこの額で計算されます。
            </p>
            <fieldset className="space-y-2">
              <legend className="sr-only">改定後の返済額</legend>
              {pendingForm.choices.map((c) => (
                <label
                  key={c.key}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${pendingForm.choice === c.key ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}
                >
                  <input
                    type="radio"
                    name="pending-payment"
                    className="mt-1"
                    checked={pendingForm.choice === c.key}
                    onChange={() =>
                      setPendingForm((f) => ({
                        ...f,
                        choice: c.key,
                        monthlyPayment: c.amount !== null ? String(c.amount) : "",
                      }))
                    }
                  />
                  <span className="text-sm text-slate-700">
                    {c.label}
                    {c.amount !== null && (
                      <span className="ml-1 font-semibold tabular-nums">{yen(c.amount)}</span>
                    )}
                    <span className="block text-[11px] text-slate-400">{c.note}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {pendingForm.choice === "custom" && (
              <input
                type="number"
                autoFocus
                aria-label="通知された返済額"
                placeholder="金融機関の通知額"
                value={pendingForm.monthlyPayment}
                onChange={(e) => setPendingForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
                className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={closePending}
                className="px-4 py-2 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
              >
                キャンセル
              </button>
              <button
                onClick={savePendingMonthly}
                disabled={pendingForm.monthlyPayment === ""}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-40"
              >
                反映
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 返済登録モーダル */}
      {payForm.loanId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-slate-800 mb-4">返済登録</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">返済日 *</label>
                <input
                  type="date"
                  value={payForm.repaidOn}
                  onChange={(e) => setPayForm((f) => ({ ...f, repaidOn: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">元金（円）*</label>
                <input
                  type="number"
                  value={payForm.principal}
                  onChange={(e) => setPayForm((f) => ({ ...f, principal: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">利息（円）</label>
                <input
                  type="number"
                  value={payForm.interest}
                  onChange={(e) => setPayForm((f) => ({ ...f, interest: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setPayForm((f) => ({ ...f, loanId: null }))}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={repay}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                登録
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
