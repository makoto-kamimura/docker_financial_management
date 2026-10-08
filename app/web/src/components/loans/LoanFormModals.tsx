"use client";

// 借入金管理の、借入の追加・編集のモーダル。

import { useState } from "react";
import { Modal } from "@/components/Modal";
import {
  LOAN_TYPES,
  PERSONAL_ASSET_CATEGORY_LABEL,
  type PersonalAssetCategory,
} from "@/lib/labels";
import { type Loan } from "@/lib/loan-schedule";
import { VariableRateHelp } from "@/components/HelpTip";
import { LOANS_HELP } from "@/lib/help-texts";
import {
  assetCategoryForLoanType,
  type AccountRef,
  type AssetRef,
  type BankAccountRef,
} from "@/components/loans/types";

// 借入の追加（この借入で買った資産も、その場で作るか既存から選んでひも付けられる）
export function LoanAddModal({
  accounts,
  bankAccounts,
  assets,
  onClose,
  onSaved,
}: {
  accounts: AccountRef[];
  bankAccounts: BankAccountRef[];
  assets: AssetRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
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
    // 返済の引き落とし口座と日（入れると残高の推移の見込みに並ぶ）
    debitBankAccountId: "",
    debitDay: "",
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
        debitBankAccountId: newLoan.debitBankAccountId ? Number(newLoan.debitBankAccountId) : null,
        debitDay: newLoan.debitDay ? Number(newLoan.debitDay) : null,
        asset,
      }),
    });
    if (r.ok) onSaved();
  };

  return (
    <Modal size="md">
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
              onChange={(e) => setNewLoan((f) => ({ ...f, linkedAccountCode: e.target.value }))}
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">引き落とし口座</label>
            <select
              value={newLoan.debitBankAccountId}
              onChange={(e) => setNewLoan((f) => ({ ...f, debitBankAccountId: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">指定しない</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              引き落とし日（毎月）
            </label>
            <input
              type="number"
              min={1}
              max={31}
              placeholder="27"
              value={newLoan.debitDay}
              onChange={(e) => setNewLoan((f) => ({ ...f, debitDay: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 -mt-2">{LOANS_HELP.debit}</p>
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
          <legend className="px-1 text-sm font-medium text-slate-600">この借入で買った資産</legend>
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
                  onChange={(e) => setNewAsset((a) => ({ ...a, acquisitionCost: e.target.value }))}
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
                  onChange={(e) => setNewAsset((a) => ({ ...a, currentValue: e.target.value }))}
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
          onClick={onClose}
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
    </Modal>
  );
}

type EditForm = {
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
  debitBankAccountId: string;
  debitDay: string;
};

// 借入条件の編集（支払い完了年月・月々の返済額・予算連携先・引き落とし・資産）
export function LoanEditModal({
  loan,
  accounts,
  bankAccounts,
  assets,
  onClose,
  onSaved,
}: {
  loan: Loan;
  accounts: AccountRef[];
  bankAccounts: BankAccountRef[];
  assets: AssetRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editForm, setEditForm] = useState<EditForm>(() => ({
    loanId: loan.id,
    amount: loan.amount,
    borrowedOn: loan.borrowedOn.slice(0, 10),
    interestRate: loan.interestRate,
    rateEditable: loan.rateChanges.length === 0,
    assetId: loan.personalAsset ? String(loan.personalAsset.id) : "",
    debitBankAccountId: loan.debitBankAccountId ? String(loan.debitBankAccountId) : "",
    debitDay: loan.debitDay ? String(loan.debitDay) : "",
    repaymentDate: loan.repaymentDate.slice(0, 10),
    monthlyPayment: loan.monthlyPayment ?? "",
    residualValue: loan.residualValue ?? "",
    linkedAccountCode: loan.linkedAccount?.code ?? "",
  }));

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
        debitBankAccountId: editForm.debitBankAccountId
          ? Number(editForm.debitBankAccountId)
          : null,
        debitDay: editForm.debitDay ? Number(editForm.debitDay) : null,
      }),
    });
    if (r.ok) onSaved();
  };

  return (
    <Modal size="md">
      <h2 className="text-lg font-bold text-slate-800 mb-4">借入条件の編集</h2>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">借入金額（円）</label>
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
            onChange={(e) => setEditForm((f) => ({ ...f, linkedAccountCode: e.target.value }))}
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">引き落とし口座</label>
            <select
              value={editForm.debitBankAccountId}
              onChange={(e) => setEditForm((f) => ({ ...f, debitBankAccountId: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">指定しない</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              引き落とし日（毎月）
            </label>
            <input
              type="number"
              min={1}
              max={31}
              placeholder="27"
              value={editForm.debitDay}
              onChange={(e) => setEditForm((f) => ({ ...f, debitDay: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 -mt-2">{LOANS_HELP.debit}</p>
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
          onClick={onClose}
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
    </Modal>
  );
}
