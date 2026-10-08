"use client";

// 借入金管理の、金利変更の登録と、改定後の返済額の入力のモーダル。

import { useState } from "react";
import { Modal } from "@/components/Modal";
import {
  ratePercent,
  referenceMonthly,
  pendingPaymentChoices,
  type Loan,
  type PaymentChoice,
} from "@/lib/shared/loan-schedule";
import { VariableRateHelp } from "@/components/HelpTip";
import { yen } from "@/lib/common/format";
import { type PendingChange } from "@/components/loans/types";

// 金利変更の登録。改定後の返済額（実額）は、通知が届いていれば一緒に入れる
export function RateChangeModal({
  loan,
  onClose,
  onSaved,
}: {
  loan: Loan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rateForm, setRateForm] = useState<{
    loanId: number | null;
    effectiveOn: string;
    interestRate: string;
    monthlyPayment: string;
    note: string;
  }>({
    loanId: loan.id,
    effectiveOn: new Date().toISOString().slice(0, 10),
    interestRate: loan.interestRate,
    monthlyPayment: "",
    note: "",
  });
  const [rateError, setRateError] = useState<string | null>(null);
  const ref =
    rateForm.interestRate !== ""
      ? referenceMonthly(loan, rateForm.effectiveOn, Number(rateForm.interestRate))
      : null;
  const current = loan.monthlyPayment ? Number(loan.monthlyPayment) : null;

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
      onSaved();
    } else {
      const j = await r.json().catch(() => null);
      setRateError(j?.error ?? "金利変更の登録に失敗しました");
    }
  };

  return (
    <Modal size="sm">
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
              onChange={(e) => setRateForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            {current !== null && (
              <button
                type="button"
                onClick={() => setRateForm((f) => ({ ...f, monthlyPayment: String(current) }))}
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
            {current !== null && <p className="text-slate-400">現在の返済額: {yen(current)}</p>}
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
          onClick={onClose}
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
    </Modal>
  );
}

// 金利改定後の実額を後から入力する（改定登録時に通知が届いていなかった場合）。
// 据え置き（5 年ルール）・再計算された額・通知額の入力から選ぶ（lib/shared/loan-schedule.ts の pendingPaymentChoices）
export function PendingPaymentModal({
  loan,
  change,
  onClose,
  onSaved,
}: {
  loan: Loan;
  change: PendingChange;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pendingForm, setPendingForm] = useState<{
    loanId: number | null;
    changeId: number | null;
    monthlyPayment: string;
    choices: PaymentChoice[];
    choice: PaymentChoice["key"];
  }>(() => {
    // 既定は先頭の選択肢（据え置きがあれば据え置き）
    const choices = pendingPaymentChoices(loan, change);
    const first = choices[0];
    return {
      loanId: loan.id,
      changeId: change.id,
      monthlyPayment: first.amount !== null ? String(first.amount) : "",
      choices,
      choice: first.key,
    };
  });

  const savePendingMonthly = async () => {
    const { loanId, changeId, monthlyPayment } = pendingForm;
    if (!loanId || !changeId || !monthlyPayment) return;
    const r = await fetch(`/api/loans/${loanId}/interest-rates/${changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyPayment: Number(monthlyPayment) }),
    });
    if (r.ok) onSaved();
  };

  return (
    <Modal size="sm">
      <h2 className="flex items-center gap-1.5 text-lg font-bold text-slate-800 mb-1">
        改定後の返済額を入力
        <VariableRateHelp />
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        金融機関の通知どおりの返済額を選んでください。5 年ルールなら「据え置き」のまま反映します。
        以降の残高・予算がこの額で計算されます。
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
          onClick={onClose}
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
    </Modal>
  );
}
