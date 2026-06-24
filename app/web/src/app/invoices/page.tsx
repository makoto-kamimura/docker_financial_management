"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

type InvoiceLine = { description: string; quantity: string; unitPrice: string; taxRate: string; amount: string };
type Invoice = {
  id: number; invoiceNumber: string; customerName: string; customerAddress: string | null;
  issueDate: string; dueDate: string; status: string;
  subtotal: string; taxAmount: string; total: string; note: string | null;
  lines: InvoiceLine[];
};

const STATUS: Record<string, { label: string; color: string }> = {
  draft:  { label: "下書き",   color: "bg-slate-100 text-slate-600" },
  issued: { label: "発行済み", color: "bg-blue-100 text-blue-700" },
  paid:   { label: "入金済み", color: "bg-green-100 text-green-700" },
};

export default function InvoicesPage() {
  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [preview, setPreview]     = useState<Invoice | null>(null);
  const [form, setForm] = useState({
    customerName: "", customerAddress: "",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: "", note: "",
    lines: [{ description: "", quantity: "1", unitPrice: "", taxRate: "0.10" }],
  });

  const load = () => {
    setLoading(true);
    fetch("/api/invoices").then(r => r.json()).then(j => { setInvoices(j.data ?? []); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { description: "", quantity: "1", unitPrice: "", taxRate: "0.10" }] }));
  const removeLine = (i: number) => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }));
  const setLine = (i: number, k: string, v: string) => setForm(f => ({
    ...f, lines: f.lines.map((l, j) => j === i ? { ...l, [k]: v } : l),
  }));

  const save = async () => {
    const r = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        lines: form.lines.map(l => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })),
      }),
    });
    if (r.ok) { setShowForm(false); load(); }
  };

  const updateStatus = async (id: number, status: string) => {
    await fetch(`/api/invoices/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    load();
  };

  const del = async (id: number) => {
    if (!confirm("削除しますか？")) return;
    await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    load();
  };

  const totalDraft  = invoices.filter(i => i.status === "draft").reduce((s, i) => s + Number(i.total), 0);
  const totalIssued = invoices.filter(i => i.status === "issued").reduce((s, i) => s + Number(i.total), 0);
  const totalPaid   = invoices.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.total), 0);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">インボイス（適格請求書）発行</h1>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          新規作成
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[["下書き", totalDraft, "text-slate-600"], ["発行済み", totalIssued, "text-blue-600"], ["入金済み", totalPaid, "text-green-600"]].map(([l, v, c]) => (
          <div key={String(l)} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-1">{l}</p>
            <p className={`text-xl font-bold ${c}`}>¥{Number(v).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {loading ? <p className="text-slate-400">読み込み中…</p> : invoices.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">📄</p>
          <p>インボイスがありません。</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {["請求番号","取引先","発行日","支払期限","金額（税込）","状態","操作"].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 font-medium">{inv.customerName}</td>
                  <td className="px-4 py-3">{inv.issueDate.slice(0, 10)}</td>
                  <td className="px-4 py-3">{inv.dueDate.slice(0, 10)}</td>
                  <td className="px-4 py-3 font-semibold">¥{Number(inv.total).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[inv.status]?.color}`}>{STATUS[inv.status]?.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setPreview(inv)} className="text-xs text-indigo-600 hover:underline">詳細</button>
                      {inv.status === "draft"  && <button onClick={() => updateStatus(inv.id, "issued")} className="text-xs text-blue-600 hover:underline">発行</button>}
                      {inv.status === "issued" && <button onClick={() => updateStatus(inv.id, "paid")}   className="text-xs text-green-600 hover:underline">入金</button>}
                      {inv.status === "draft"  && <button onClick={() => del(inv.id)} className="text-xs text-red-500 hover:underline">削除</button>}
                      <button onClick={() => window.open(`/invoices/print?id=${inv.id}`, "_blank")} className="text-xs text-slate-500 hover:underline">印刷</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新規作成フォーム */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-2xl mx-4">
            <h2 className="text-lg font-bold text-slate-800 mb-4">インボイス新規作成</h2>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">取引先名 *</label>
                <input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">取引先住所</label>
                <input value={form.customerAddress} onChange={e => setForm(f => ({ ...f, customerAddress: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">発行日 *</label>
                <input type="date" value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">支払期限 *</label>
                <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="space-y-2 mb-3">
              <p className="text-sm font-medium text-slate-600">明細行</p>
              {form.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={l.description} onChange={e => setLine(i, "description", e.target.value)}
                    placeholder="品目・内容" className="col-span-4 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                  <input type="number" value={l.quantity} onChange={e => setLine(i, "quantity", e.target.value)}
                    placeholder="数量" className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                  <input type="number" value={l.unitPrice} onChange={e => setLine(i, "unitPrice", e.target.value)}
                    placeholder="単価" className="col-span-3 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                  <select value={l.taxRate} onChange={e => setLine(i, "taxRate", e.target.value)}
                    className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                    <option value="0.10">10%</option>
                    <option value="0.08">8%</option>
                    <option value="0">非課税</option>
                  </select>
                  <button onClick={() => removeLine(i)} className="col-span-1 text-red-400 hover:text-red-600 text-lg">×</button>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="text-sm text-indigo-600 hover:underline mb-4">+ 行追加</button>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-600 mb-1">備考</label>
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">キャンセル</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">作成</button>
            </div>
          </div>
        </div>
      )}

      {/* 詳細プレビュー */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4">
            <div className="flex justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">請求書詳細</h2>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="text-sm space-y-1 mb-4">
              <p><span className="text-slate-500">番号:</span> {preview.invoiceNumber}</p>
              <p><span className="text-slate-500">取引先:</span> {preview.customerName}</p>
              {preview.customerAddress && <p><span className="text-slate-500">住所:</span> {preview.customerAddress}</p>}
              <p><span className="text-slate-500">発行日:</span> {preview.issueDate.slice(0, 10)} / 支払期限: {preview.dueDate.slice(0, 10)}</p>
            </div>
            <table className="w-full text-sm mb-4">
              <thead className="text-xs text-slate-500 border-b">
                <tr><th className="text-left pb-2">品目</th><th className="text-right pb-2">数量</th><th className="text-right pb-2">単価</th><th className="text-right pb-2">税率</th><th className="text-right pb-2">金額</th></tr>
              </thead>
              <tbody>
                {preview.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1.5">{l.description}</td>
                    <td className="text-right">{Number(l.quantity)}</td>
                    <td className="text-right">¥{Number(l.unitPrice).toLocaleString()}</td>
                    <td className="text-right">{(Number(l.taxRate) * 100).toFixed(0)}%</td>
                    <td className="text-right font-medium">¥{Number(l.amount).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right space-y-1 text-sm">
              <p>小計: ¥{Number(preview.subtotal).toLocaleString()}</p>
              <p>消費税: ¥{Number(preview.taxAmount).toLocaleString()}</p>
              <p className="text-base font-bold">合計: ¥{Number(preview.total).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
