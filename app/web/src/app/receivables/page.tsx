"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

type Receivable = {
  id: number;
  customerName: string;
  description: string;
  amount: number | string;
  taxAmount: number | string;
  issueDate: string;
  dueDate: string;
  status: string;
  paidOn: string | null;
  paidAmount: number | string | null;
  invoiceNumber: string | null;
  note: string | null;
};

const yen = (v: number | string | null) =>
  v == null ? "—" : Number(v).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  open: { label: "未入金", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "入金済", cls: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "延滞", cls: "bg-red-100 text-red-700" },
};

function isOverdue(r: Receivable) {
  return r.status === "open" && new Date(r.dueDate) < new Date();
}

// ── 新規登録モーダル ──────────────────────────────────────────────────────
function NewReceivableModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const due30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    customerName: "",
    description: "",
    amount: 0,
    taxAmount: 0,
    issueDate: today,
    dueDate: due30,
    invoiceNumber: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/receivables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["receivables"] });
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
        <h2 className="text-lg font-semibold text-slate-800 mb-4">売掛金 新規登録</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">得意先名 *</span>
              <input
                className="input-field mt-1 w-full"
                value={form.customerName}
                onChange={(e) => f("customerName", e.target.value)}
                placeholder="○○株式会社"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">請求書番号</span>
              <input
                className="input-field mt-1 w-full"
                value={form.invoiceNumber}
                onChange={(e) => f("invoiceNumber", e.target.value)}
                placeholder="INV-2026-001"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">件名・摘要 *</span>
            <input
              className="input-field mt-1 w-full"
              value={form.description}
              onChange={(e) => f("description", e.target.value)}
              placeholder="6月分コンサルティング費用"
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
              <span className="text-xs font-medium text-slate-600">請求日 *</span>
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

// ── 入金処理モーダル ──────────────────────────────────────────────────────
function PayModal({ receivable, onClose }: { receivable: Receivable; onClose: () => void }) {
  const qc = useQueryClient();
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [paidAmount, setPaidAmount] = useState(Number(receivable.amount));
  const [payCode, setPayCode] = useState("1100");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/receivables/${receivable.id}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidOn, paidAmount, paymentAccountCode: payCode }),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["receivables"] });
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
        <h2 className="text-lg font-semibold text-slate-800 mb-1">入金処理</h2>
        <p className="text-sm text-slate-500 mb-4">
          {receivable.customerName} — {receivable.description}
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">入金日 *</span>
            <input
              type="date"
              className="input-field mt-1 w-full"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">入金金額 *</span>
            <input
              type="number"
              className="input-field mt-1 w-full"
              value={paidAmount}
              onChange={(e) => setPaidAmount(Number(e.target.value))}
              min={0}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">入金先口座</span>
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
          仕訳自動作成: 借方 {payCode === "1100" ? "普通預金" : "現金"} / 貸方 売掛金
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
            {saving ? "処理中…" : "入金確定"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── メインページ ──────────────────────────────────────────────────────────
export default function ReceivablesPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [status, setStatus] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [paying, setPaying] = useState<Receivable | null>(null);
  const qc = useQueryClient();

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["receivables", year, status],
    queryFn: () =>
      fetch(`/api/receivables?year=${year}&status=${status}`)
        .then((r) => r.json())
        .then((r) => r.data as Receivable[]),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/receivables/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receivables"] }),
  });

  const totalOpen = list
    .filter((r) => r.status === "open")
    .reduce((s, r) => s + Number(r.amount), 0);

  const overdueList = list.filter((r) => isOverdue(r));

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title">売掛金管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">請求書発行・入金管理（F010）</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="btn-primary text-sm px-4 py-2"
        >
          + 売掛金 登録
        </button>
      </div>

      {/* サマリカード */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card">
          <p className="text-xs font-medium text-slate-500 mb-1">未入金合計</p>
          <p className="text-xl font-bold text-slate-800">{yen(totalOpen)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-slate-500 mb-1">未入金件数</p>
          <p className="text-xl font-bold text-slate-800">
            {list.filter((r) => r.status === "open").length} 件
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
            ["open", "未入金"],
            ["paid", "入金済"],
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
          <p className="text-sm">売掛金データがありません。</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left py-2.5 font-medium pl-1">得意先</th>
                <th className="text-left py-2.5 font-medium">件名</th>
                <th className="text-right py-2.5 font-medium">請求金額</th>
                <th className="text-left py-2.5 font-medium">請求日</th>
                <th className="text-left py-2.5 font-medium">支払期限</th>
                <th className="text-center py-2.5 font-medium">状態</th>
                <th className="text-right py-2.5 font-medium">入金日</th>
                <th className="w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {list.map((r) => {
                const overdue = isOverdue(r);
                const st = overdue ? "overdue" : r.status;
                const badge = STATUS_LABELS[st] ?? STATUS_LABELS.open;
                return (
                  <tr
                    key={r.id}
                    className={`hover:bg-slate-50/60 ${overdue ? "bg-red-50/20" : ""}`}
                  >
                    <td className="py-2.5 pl-1 font-medium text-slate-800">{r.customerName}</td>
                    <td className="py-2.5 text-slate-600 text-xs max-w-[160px] truncate">
                      {r.description}
                    </td>
                    <td className="py-2.5 text-right font-bold">{yen(r.amount)}</td>
                    <td className="py-2.5 text-slate-500 text-xs">
                      {new Date(r.issueDate).toLocaleDateString("ja-JP")}
                    </td>
                    <td
                      className={`py-2.5 text-xs ${overdue ? "text-red-600 font-semibold" : "text-slate-500"}`}
                    >
                      {new Date(r.dueDate).toLocaleDateString("ja-JP")}
                    </td>
                    <td className="py-2.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-xs text-slate-500">
                      {r.paidOn ? new Date(r.paidOn).toLocaleDateString("ja-JP") : "—"}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2 justify-end pr-1">
                        {r.status === "open" && (
                          <button
                            type="button"
                            onClick={() => setPaying(r)}
                            className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                          >
                            入金処理
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("削除しますか？")) delMut.mutate(r.id);
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

      {showNew && <NewReceivableModal onClose={() => setShowNew(false)} />}
      {paying && <PayModal receivable={paying} onClose={() => setPaying(null)} />}
    </AppShell>
  );
}
