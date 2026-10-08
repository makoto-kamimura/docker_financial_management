"use client";

// 借入金管理の、返済登録のモーダル。

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { type Loan } from "@/lib/loan-schedule";

// 返済の登録（元金・利息）
export function RepayModal({
  loan,
  onClose,
  onSaved,
}: {
  loan: Loan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [payForm, setPayForm] = useState<{
    loanId: number | null;
    principal: string;
    interest: string;
    repaidOn: string;
  }>({
    loanId: loan.id,
    principal: "",
    interest: "0",
    repaidOn: new Date().toISOString().slice(0, 10),
  });

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
    if (r.ok) onSaved();
  };

  return (
    <Modal size="sm">
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
          onClick={onClose}
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
    </Modal>
  );
}
