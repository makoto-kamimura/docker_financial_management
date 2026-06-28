"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

type Payable = {
  id: number;
  supplierName: string;
  description: string;
  amount: number | string;
  taxAmount: number | string;
  issueDate: string;
  dueDate: string;
  status: string;
  paidOn: string | null;
  paidAmount: number | string | null;
  note: string | null;
};

const yen = (v: number | string | null) =>
  v == null ? "—" : Number(v).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  open: { label: "未払", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "支払済", cls: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "延滞", cls: "bg-red-100 text-red-700" },
};

function isOverdue(p: Payable) {
  return p.status === "open" && new Date(p.dueDate) < new Date();
}

// ── 新規登録モーダル ──────────────────────────────────────────────────────
function NewPayableModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const due30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    supplierName: "",
    description: "",
    amount: 0,
    taxAmount: 0,
    issueDate: today,
    dueDate: due30,
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/payables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["payables"] });
      onClose();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? "保存に失敗しました");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[560px] p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">買掛金 新規登録</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">仕入先名 *</span>
            <input
              className="input-field mt-1 w-full"
              value={form.supplierName}
              onChange={(e) => f("supplierName", e.target.value)}
              placeholder="△△卸売株式会社"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">件名・摘要 *</span>
            <input
              className="input-field mt-1 w-full"
              value={form.description}
              onChange={(e) => f("description", e.target.value)}
              placeholder="6月分仕入"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">請求金額（税込）*</span>
              <input
                type="number"
                className="input-field mt-1 w-full"
                value={form.amount}
                onChange={(e) => f("amount", Number(e.target.value))}
                min={0}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">うち消費税額</span>
              <input
                type="number"
                className="input-field mt-1 w-full"
                value={form.taxAmount}
                onChange={(e) => f("taxAmount", Number(e.target.value))}
                min={0}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">請求書受取日 *</span>
              <input
                type="date"
                className="input-field mt-1 w-full"
                value={form.issueDate}
                onChange={(e) => f("issueDate", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">支払期限 *</span>
              <input
                type="date"
                className="input-field mt-1 w-full"
                value={form.dueDate}
                onChange={(e) => f("dueDate", e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">メモ</span>
            <input
              className="input-field mt-1 w-full"
              value={form.note}
              onChange={(e) => f("note", e.target.value)}
            />
          </label>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="btn-primary text-sm px-5 py-2"
          >
            {saving ? "保存中…" : "登録"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 支払処理モーダル ──────────────────────────────────────────────────────
function PayModal({ payable, onClose }: { payable: Payable; onClose: () => void }) {
  const qc = useQueryClient();
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [paidAmount, setPaidAmount] = useState(Number(payable.amount));
  const [payCode, setPayCode] = useState("1100");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/payables/${payable.id}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidOn, paidAmount, paymentAccountCode: payCode }),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["payables"] });
      onClose();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? "処理に失敗しました");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[440px] p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">支払処理</h2>
        <p className="text-sm text-slate-500 mb-4">
          {payable.supplierName} — {payable.description}
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">支払日 *</span>
            <input
              type="date"
              className="input-field mt-1 w-full"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">支払金額 *</span>
            <input
              type="number"
              className="input-field mt-1 w-full"
              value={paidAmount}
              onChange={(e) => setPaidAmount(Number(e.target.value))}
              min={0}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">支払口座</span>
            <select
              className="input-field mt-1 w-full"
              value={payCode}
              onChange={(e) => setPayCode(e.target.value)}
            >
              <option value="1100">普通預金</option>
              <option value="1000">現金</option>
            </select>
          </label>
        </div>
        <div className="mt-3 p-3 bg-indigo-50 rounded-lg text-xs text-indigo-700">
          仕訳自動作成: 借方 買掛金 / 貸方 {payCode === "1100" ? "普通預金" : "現金"}
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="btn-primary text-sm px-5 py-2"
          >
            {saving ? "処理中…" : "支払確定"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── メインページ ──────────────────────────────────────────────────────────
export default function PayablesPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [status, setStatus] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [paying, setPaying] = useState<Payable | null>(null);
  const qc = useQueryClient();

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["payables", year, status],
    queryFn: () =>
      fetch(`/api/payables?year=${year}&status=${status}`)
        .then((r) => r.json())
        .then((r) => r.data as Payable[]),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/payables/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payables"] }),
  });

  const totalOpen = list
    .filter((p) => p.status === "open")
    .reduce((s, p) => s + Number(p.amount), 0);

  const overdueList = list.filter((p) => isOverdue(p));

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title">買掛金管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">仕入先請求書・支払管理（F011）</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="btn-primary text-sm px-4 py-2"
        >
          + 買掛金 登録
        </button>
      </div>

      {/* サマリカード */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card">
          <p className="text-xs font-medium text-slate-500 mb-1">未払合計</p>
          <p className="text-xl font-bold text-slate-800">{yen(totalOpen)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-slate-500 mb-1">未払件数</p>
          <p className="text-xl font-bold text-slate-800">
            {list.filter((p) => p.status === "open").length} 件
          </p>
        </div>
        <div className={`card ${overdueList.length > 0 ? "border-red-200 bg-red-50/50" : ""}`}>
          <p className="text-xs font-medium text-slate-500 mb-1">延滞件数</p>
          <p
            className={`text-xl font-bold ${overdueList.length > 0 ? "text-red-600" : "text-slate-800"}`}
          >
            {overdueList.length} 件
          </p>
        </div>
      </div>

      {/* フィルタ */}
      <div className="flex items-center gap-3 mb-4">
        <select
          className="input-field w-28 py-1 text-sm"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {[
            ["all", "全件"],
            ["open", "未払"],
            ["paid", "支払済"],
            ["overdue", "延滞"],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setStatus(v)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                status === v
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">{list.length} 件</span>
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : list.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">
          <p className="text-sm">買掛金データがありません。</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left py-2.5 font-medium pl-1">仕入先</th>
                <th className="text-left py-2.5 font-medium">件名</th>
                <th className="text-right py-2.5 font-medium">請求金額</th>
                <th className="text-left py-2.5 font-medium">受取日</th>
                <th className="text-left py-2.5 font-medium">支払期限</th>
                <th className="text-center py-2.5 font-medium">状態</th>
                <th className="text-right py-2.5 font-medium">支払日</th>
                <th className="w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {list.map((p) => {
                const overdue = isOverdue(p);
                const st = overdue ? "overdue" : p.status;
                const badge = STATUS_LABELS[st] ?? STATUS_LABELS.open;
                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-slate-50/60 ${overdue ? "bg-red-50/20" : ""}`}
                  >
                    <td className="py-2.5 pl-1 font-medium text-slate-800">{p.supplierName}</td>
                    <td className="py-2.5 text-slate-600 text-xs max-w-[160px] truncate">
                      {p.description}
                    </td>
                    <td className="py-2.5 text-right font-bold">{yen(p.amount)}</td>
                    <td className="py-2.5 text-slate-500 text-xs">
                      {new Date(p.issueDate).toLocaleDateString("ja-JP")}
                    </td>
                    <td
                      className={`py-2.5 text-xs ${overdue ? "text-red-600 font-semibold" : "text-slate-500"}`}
                    >
                      {new Date(p.dueDate).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="py-2.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-xs text-slate-500">
                      {p.paidOn ? new Date(p.paidOn).toLocaleDateString("ja-JP") : "—"}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2 justify-end pr-1">
                        {p.status === "open" && (
                          <button
                            type="button"
                            onClick={() => setPaying(p)}
                            className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                          >
                            支払処理
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("削除しますか？")) delMut.mutate(p.id);
                          }}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <NewPayableModal onClose={() => setShowNew(false)} />}
      {paying && <PayModal payable={paying} onClose={() => setPaying(null)} />}
    </AppShell>
  );
}
