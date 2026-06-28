"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

type Tenant = {
  id: number;
  type: string;
  name: string;
  corporateNumber: string | null;
  capitalAmount: string | null;
  establishedOn: string | null;
  closingMonth: number;
};

export default function CorporatePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [form, setForm] = useState({
    type: "CORPORATION",
    name: "",
    corporateNumber: "",
    capitalAmount: "",
    establishedOn: "",
    closingMonth: "12",
  });

  const load = () => {
    setLoading(true);
    fetch("/api/tenants")
      .then((r) => r.json())
      .then((j) => {
        setTenants(j.data ?? []);
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({
      type: "CORPORATION",
      name: "",
      corporateNumber: "",
      capitalAmount: "",
      establishedOn: "",
      closingMonth: "12",
    });
    setShowForm(true);
  };

  const openEdit = (t: Tenant) => {
    setEditing(t);
    setForm({
      type: t.type,
      name: t.name,
      corporateNumber: t.corporateNumber ?? "",
      capitalAmount: t.capitalAmount ?? "",
      establishedOn: t.establishedOn ? t.establishedOn.slice(0, 10) : "",
      closingMonth: String(t.closingMonth),
    });
    setShowForm(true);
  };

  const save = async () => {
    const body = {
      type: form.type,
      name: form.name,
      corporateNumber: form.corporateNumber || undefined,
      capitalAmount: form.capitalAmount ? Number(form.capitalAmount) : undefined,
      establishedOn: form.establishedOn || undefined,
      closingMonth: Number(form.closingMonth),
    };
    const url = editing ? `/api/tenants/${editing.id}` : "/api/tenants";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setShowForm(false);
      load();
    }
  };

  const del = async (id: number) => {
    if (!confirm("削除しますか？")) return;
    await fetch(`/api/tenants/${id}`, { method: "DELETE" });
    load();
  };

  const typeLabel = (t: string) => (t === "CORPORATION" ? "法人" : "個人事業主");

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">法人・事業者情報管理</h1>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          新規登録
        </button>
      </div>

      {loading ? (
        <p className="text-slate-400">読み込み中…</p>
      ) : tenants.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🏢</p>
          <p>テナント情報が未登録です。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tenants.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${t.type === "CORPORATION" ? "bg-indigo-100 text-indigo-700" : "bg-green-100 text-green-700"}`}
                    >
                      {typeLabel(t.type)}
                    </span>
                    <h2 className="text-lg font-semibold text-slate-800">{t.name}</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-slate-600 mt-2">
                    {t.corporateNumber && <p>法人番号: {t.corporateNumber}</p>}
                    {t.capitalAmount && <p>資本金: ¥{Number(t.capitalAmount).toLocaleString()}</p>}
                    {t.establishedOn && <p>設立日: {t.establishedOn.slice(0, 10)}</p>}
                    <p>決算月: {t.closingMonth}月</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEdit(t)}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => del(t.id)}
                    className="text-sm text-red-500 hover:underline"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">
            <h2 className="text-lg font-bold text-slate-800 mb-4">
              {editing ? "編集" : "新規登録"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">種別</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="CORPORATION">法人</option>
                  <option value="SOLE_PROPRIETOR">個人事業主</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">名称 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="株式会社〇〇 / 〇〇商店"
                />
              </div>
              {form.type === "CORPORATION" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      法人番号（13桁）
                    </label>
                    <input
                      value={form.corporateNumber}
                      onChange={(e) => setForm((f) => ({ ...f, corporateNumber: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="1234567890123"
                      maxLength={13}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      資本金（円）
                    </label>
                    <input
                      type="number"
                      value={form.capitalAmount}
                      onChange={(e) => setForm((f) => ({ ...f, capitalAmount: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="10000000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">設立日</label>
                    <input
                      type="date"
                      value={form.establishedOn}
                      onChange={(e) => setForm((f) => ({ ...f, establishedOn: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">決算月</label>
                <select
                  value={form.closingMonth}
                  onChange={(e) => setForm((f) => ({ ...f, closingMonth: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {m}月
                    </option>
                  ))}
                </select>
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
                onClick={save}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
