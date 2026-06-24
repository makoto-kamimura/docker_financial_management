"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

type Tenant   = { id: number; name: string; type: string };
type FiscalYr = { id: number; tenantId: number; year: number; startDate: string; endDate: string; status: string; tenant: Tenant };

export default function FiscalYearsPage() {
  const [tenants, setTenants]     = useState<Tenant[]>([]);
  const [fiscalYears, setFY]      = useState<FiscalYr[]>([]);
  const [selectedTenant, setST]   = useState<number | "">("");
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm] = useState({ tenantId: "", year: String(new Date().getFullYear()), startDate: "", endDate: "" });

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/tenants").then(r => r.json()),
      fetch(`/api/fiscal-years${selectedTenant ? "?tenantId=" + selectedTenant : ""}`).then(r => r.json()),
    ]).then(([t, fy]) => {
      setTenants(t.data ?? []);
      setFY(fy.data ?? []);
      setLoading(false);
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, [selectedTenant]);

  const save = async () => {
    const r = await fetch("/api/fiscal-years", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: Number(form.tenantId), year: Number(form.year), startDate: form.startDate, endDate: form.endDate }),
    });
    if (r.ok) { setShowForm(false); loadAll(); }
  };

  const toggleStatus = async (fy: FiscalYr) => {
    const newStatus = fy.status === "open" ? "closed" : "open";
    await fetch(`/api/fiscal-years/${fy.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) });
    loadAll();
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">会計年度管理</h1>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          年度追加
        </button>
      </div>

      <div className="mb-4">
        <select value={selectedTenant} onChange={e => setST(e.target.value === "" ? "" : Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">全テナント</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {loading ? <p className="text-slate-400">読み込み中…</p> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {["テナント","年度","開始日","終了日","状態","操作"].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fiscalYears.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">データなし</td></tr>
              ) : fiscalYears.map(fy => (
                <tr key={fy.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{fy.tenant.name}</td>
                  <td className="px-4 py-3 font-medium">{fy.year}年度</td>
                  <td className="px-4 py-3">{fy.startDate.slice(0, 10)}</td>
                  <td className="px-4 py-3">{fy.endDate.slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${fy.status === "open" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {fy.status === "open" ? "オープン" : "締済"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleStatus(fy)}
                      className="text-xs text-indigo-600 hover:underline">
                      {fy.status === "open" ? "締める" : "再オープン"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-800 mb-4">会計年度追加</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">テナント *</label>
                <select value={form.tenantId} onChange={e => setForm(f => ({ ...f, tenantId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">選択してください</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">年度 *</label>
                <input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">開始日 *</label>
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">終了日 *</label>
                  <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">キャンセル</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">保存</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
