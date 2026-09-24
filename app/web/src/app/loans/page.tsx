"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LOAN_TYPES, LOAN_TYPE_LABEL } from "@/lib/labels";
import {
  balanceKey,
  buildRateComparison,
  buildScheduleData,
  LOAN_COLORS as COLORS,
  pendingRateChange,
  ratePercent,
  rateForecastKey,
  rateKey,
  referenceMonthly,
  todayLabel,
  type Loan,
} from "@/lib/loan-schedule";
import { VariableRateHelp } from "@/components/HelpTip";

type AccountRef = { id: number; code: string; name: string; category: string };

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

// ── ページ ──────────────────────────────────────────────────────
export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<AccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // 返済スケジュールグラフに適用金利（右軸）を重ねるか
  const [showRates, setShowRates] = useState(true);
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
  });
  const [editForm, setEditForm] = useState<{
    loanId: number | null;
    repaymentDate: string;
    monthlyPayment: string;
    residualValue: string;
    linkedAccountCode: string;
  }>({
    loanId: null,
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
  // 改定後の実額を後から入力するフォーム（改定登録時に通知が届いていなかった場合）
  const [pendingForm, setPendingForm] = useState<{
    loanId: number | null;
    changeId: number | null;
    monthlyPayment: string;
  }>({ loanId: null, changeId: null, monthlyPayment: "" });

  const load = () => {
    setLoading(true);
    fetch("/api/loans")
      .then((r) => r.json())
      .then((j) => {
        setLoans(j.data ?? []);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((j) => setAccounts(j.data ?? []));
  }, []);

  const saveLoan = async () => {
    const r = await fetch("/api/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newLoan,
        amount: Number(newLoan.amount),
        interestRate: Number(newLoan.interestRate),
        linkedAccountCode: newLoan.linkedAccountCode || undefined,
        monthlyPayment: newLoan.monthlyPayment ? Number(newLoan.monthlyPayment) : undefined,
      }),
    });
    if (r.ok) {
      setShowForm(false);
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
      setPendingForm({ loanId: null, changeId: null, monthlyPayment: "" });
      load();
    }
  };

  const openEdit = (l: Loan) => {
    setEditForm({
      loanId: l.id,
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
        repaymentDate: editForm.repaymentDate,
        monthlyPayment: editForm.monthlyPayment ? Number(editForm.monthlyPayment) : null,
        residualValue: editForm.residualValue ? Number(editForm.residualValue) : null,
        linkedAccountCode: editForm.linkedAccountCode || null,
      }),
    });
    if (r.ok) {
      setEditForm((f) => ({ ...f, loanId: null }));
      load();
    }
  };

  const totalBorrowed = loans.reduce((s, l) => s + Number(l.amount), 0);
  const totalRemaining = loans
    .filter((l) => l.status === "active")
    .reduce((s, l) => s + Number(l.remainingAmount), 0);
  const scheduleData = buildScheduleData(loans);
  const activeLoans = loans.filter((l) => l.status === "active");

  return (
    <AppShell>
      <h1 className="page-title mb-6">借入金管理</h1>

      {/* KPI カード */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">借入残高合計</p>
          <p className="text-2xl font-bold text-red-600">{yen(totalRemaining)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">借入総額</p>
          <p className="text-2xl font-bold text-slate-800">{yen(totalBorrowed)}</p>
        </div>
      </div>

      {/* 返済スケジュールグラフ */}
      {!loading && scheduleData.length > 0 && (
        <div className="card mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="section-title">返済スケジュール</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                今日以降の残高は償還スケジュールからの予測です
              </span>
              {/* 金利は右軸に重ねる。ローンが多いと線が増えるため切り替えられるようにする */}
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRates}
                  onChange={(e) => setShowRates(e.target.checked)}
                  className="accent-indigo-600"
                />
                金利を重ねて表示
              </label>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={scheduleData} margin={{ top: 8, right: 24, bottom: 8, left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} />
              <YAxis
                yAxisId="balance"
                tickFormatter={(v) => `${Math.round(v / 10000)}万`}
                tick={{ fontSize: 10 }}
                width={48}
              />
              {/* 右軸: 適用金利（%）。残高（万円）と桁が違うため別軸にする */}
              {showRates && (
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  tickFormatter={(v) => `${Number(v).toFixed(2)}%`}
                  tick={{ fontSize: 10 }}
                  width={52}
                  domain={[0, "auto"]}
                />
              )}
              <Tooltip
                formatter={(v: number, name: string, item: { dataKey?: string | number }) =>
                  String(item?.dataKey ?? "").startsWith("l")
                    ? [yen(v), name]
                    : [`${Number(v).toFixed(3)}%`, name]
                }
                labelStyle={{ fontSize: 11 }}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              {/* 今日の基準線 */}
              <ReferenceLine
                x={todayLabel()}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                label={{ value: "今日", fontSize: 10, fill: "#94a3b8" }}
                yAxisId="balance"
              />
              {/* ゼロライン */}
              <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" yAxisId="balance" />
              {loans.map((loan, i) => (
                <Line
                  key={loan.id}
                  yAxisId="balance"
                  type="monotone"
                  dataKey={balanceKey(loan.id)}
                  name={loan.lenderName}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
              {/* 適用金利。今日までは履歴どおりの実績、今日以降は将来の改定と
                  履歴の傾向からの予測（破線）。残高と同じ色の細線で対応付ける。 */}
              {showRates &&
                loans.flatMap((loan, i) => [
                  <Line
                    key={`rate-${loan.id}`}
                    yAxisId="rate"
                    type="stepAfter"
                    dataKey={rateKey(loan.id)}
                    name={`${loan.lenderName} 金利`}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={1}
                    strokeOpacity={0.7}
                    dot={false}
                    connectNulls
                  />,
                  <Line
                    key={`rate-forecast-${loan.id}`}
                    yAxisId="rate"
                    type="stepAfter"
                    dataKey={rateForecastKey(loan.id)}
                    name={`${loan.lenderName} 金利（予測）`}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={1}
                    strokeOpacity={0.7}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                    legendType="none"
                  />,
                ])}
            </LineChart>
          </ResponsiveContainer>

          {showRates && (
            <p className="mt-2 text-xs text-slate-400">
              金利は右軸。今日以降の破線は、登録済みの将来の改定と
              「これまでと同じ間隔・同じ幅で改定が続いたら」という前提で履歴から外挿した予測です
              （金利変更履歴が 2 件以上あるローンのみ予測します）。
            </p>
          )}

          {/* 各ローンの返済期限サマリ */}
          {activeLoans.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {activeLoans.map((l, i) => {
                const progress = 1 - Number(l.remainingAmount) / Number(l.amount);
                return (
                  <div key={l.id} className="flex items-center gap-2 text-xs text-slate-600">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span>{l.lenderName}</span>
                    <span className="text-slate-400">返済期限 {l.repaymentDate.slice(0, 7)}</span>
                    <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-current rounded-full transition-all"
                        style={{
                          width: `${Math.round(progress * 100)}%`,
                          color: COLORS[i % COLORS.length],
                        }}
                      />
                    </div>
                    <span className="text-slate-400">{Math.round(progress * 100)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 借入追加。返済スケジュールの下・ローン一覧の直前に置く */}
      <div className="flex justify-end mb-3">
        <button onClick={() => setShowForm(true)} className="btn-primary px-4 py-2 text-sm">
          借入追加
        </button>
      </div>

      {/* ローン一覧 */}
      {loading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : loans.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🏦</p>
          <p>借入金の記録がありません。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {loans.map((l, i) => (
            <div key={l.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <h2 className="font-semibold text-slate-800">{l.lenderName}</h2>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${l.status === "active" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}
                    >
                      {l.status === "active" ? "返済中" : "完済"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                      {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-sm text-slate-600 mt-1 pl-4">
                    <span>借入額: {yen(Number(l.amount))}</span>
                    <span>金利: {(Number(l.interestRate) * 100).toFixed(2)}%</span>
                    <span>
                      残高:{" "}
                      <strong className="text-red-600">{yen(Number(l.remainingAmount))}</strong>
                    </span>
                    <span>支払い完了年月: {l.repaymentDate.slice(0, 7)}</span>
                  </div>
                  {(l.monthlyPayment || l.linkedAccount) && (
                    <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-indigo-600 mt-1 pl-4">
                      {l.monthlyPayment && (
                        <span>
                          月々の返済額: {yen(Number(l.monthlyPayment))}
                          <span className="ml-1 text-slate-400">
                            {l.monthlyPaymentIsManual ? "（実額）" : "（計算値）"}
                          </span>
                        </span>
                      )}
                      {Number(l.residualValue ?? 0) > 0 && (
                        <span>残価: {yen(Number(l.residualValue))}（最終回に一括）</span>
                      )}
                      {l.linkedAccount && (
                        <span>
                          予算連携先: {l.linkedAccount.code} {l.linkedAccount.name}（自動加算）
                        </span>
                      )}
                    </div>
                  )}
                  {/* 金利が改定されたが、改定後の実額返済額がまだ入力されていない */}
                  {(() => {
                    const pending = pendingRateChange(l);
                    if (!pending) return null;
                    const calc = pending.calculatedMonthlyPayment;
                    return (
                      <div className="mt-2 ml-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs font-semibold text-amber-800">
                            {pending.effectiveOn.slice(0, 7)} に金利が
                            {ratePercent(pending.interestRate).toFixed(2)}%
                            へ改定されました。改定後の返済額を入力してください
                          </span>
                          <VariableRateHelp />
                          <button
                            onClick={() =>
                              setPendingForm({
                                loanId: l.id,
                                changeId: pending.id,
                                monthlyPayment: calc ?? "",
                              })
                            }
                            className="ml-auto rounded-lg bg-amber-600 px-2.5 py-1 text-xs text-white hover:bg-amber-700"
                          >
                            入力する
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-amber-700">
                          現在は改定前の{l.monthlyPayment ? yen(Number(l.monthlyPayment)) : "—"}
                          で計算中です。
                          {calc && `計算上の目安は ${yen(Number(calc))} ですが、`}5
                          年ルールのローンでは返済額が据え置かれるため、
                          金融機関の通知額を入力してください。
                        </p>
                      </div>
                    );
                  })()}
                  {/* 返済進捗バー */}
                  {Number(l.amount) > 0 && (
                    <div className="mt-2 ml-4 flex items-center gap-2">
                      <div className="w-40 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.round((1 - Number(l.remainingAmount) / Number(l.amount)) * 100)}%`,
                            backgroundColor: COLORS[i % COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">
                        {Math.round((1 - Number(l.remainingAmount) / Number(l.amount)) * 100)}%
                        返済済
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(l)}
                    className="px-3 py-1.5 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
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
                    className="px-3 py-1.5 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200"
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
                      className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      返済登録
                    </button>
                  )}
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
                                      onClick={() =>
                                        setPendingForm({
                                          loanId: l.id,
                                          changeId: c.id,
                                          monthlyPayment: calc ?? "",
                                        })
                                      }
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
                      .filter((a) => a.category === "EXPENSE")
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
                    .filter((a) => a.category === "EXPENSE")
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
                    <input
                      type="number"
                      placeholder={ref ? `参考: ${ref.monthly}` : "金融機関の通知額"}
                      value={rateForm.monthlyPayment}
                      onChange={(e) =>
                        setRateForm((f) => ({ ...f, monthlyPayment: e.target.value }))
                      }
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
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
              金融機関から通知された、改定後の月々の返済額を入力してください。以降の残高・
              予算がこの額で計算されます。
            </p>
            <input
              type="number"
              autoFocus
              value={pendingForm.monthlyPayment}
              onChange={(e) => setPendingForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setPendingForm({ loanId: null, changeId: null, monthlyPayment: "" })}
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
