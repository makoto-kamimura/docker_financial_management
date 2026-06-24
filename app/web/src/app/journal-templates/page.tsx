"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

type Account  = { id: number; code: string; name: string };
type TplLine  = { side: string; account: Account; amount: string | null; note: string | null; sortOrder: number };
type Template = { id: number; name: string; description: string | null; lines: TplLine[] };

export default function JournalTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts]   = useState<Account[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm] = useState({ name: "", description: "", lines: [
    { side: "debit",  accountId: "", amount: "", note: "" },
    { side: "credit", accountId: "", amount: "", note: "" },
  ]});

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/journal-templates").then(r => r.json()),
      fetch("/api/masters/accounts").then(r => r.json()),
    ]).then(([t, a]) => {
      setTemplates(t.data ?? []);
      setAccounts(a.data ?? []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { side: "debit", accountId: "", amount: "", note: "" }] }));
  const removeLine = (i: number) => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }));
  const setLine = (i: number, k: string, v: string) => setForm(f => ({
    ...f, lines: f.lines.map((l, j) => j === i ? { ...l, [k]: v } : l),
  }));

  const save = async () => {
    const body = {
      name: form.name,
      description: form.description || undefined,
      lines: form.lines.map((l, i) => ({
        side: l.side,
        accountId: Number(l.accountId),
        amount: l.amount ? Number(l.amount) : undefined,
        note: l.note || undefined,
        sortOrder: i,
      })),
    };
    const r = await fetch("/api/journal-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { setShowForm(false); load(); }
  };

  const del = async (id: number) => {
    if (!confirm("削除しますか？")) return;
    await fetch(`/api/journal-templates/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">仕訳テンプレート</h1>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          テンプレート追加
        </button>
      </div>

      {loading ? <p className="text-slate-400">読み込み中…</p> : templates.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">📋</p>
          <p>よく使う仕訳をテンプレートとして登録できます。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-slate-800">{t.name}</h2>
                  {t.description && <p className="text-sm text-slate-500 mt-0.5">{t.description}</p>}
                </div>
                <button onClick={() => del(t.id)} className="text-sm text-red-500 hover:underline">削除</button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="text-left pb-1 w-16">区分</th>
                    <th className="text-left pb-1">勘定科目</th>
                    <th className="text-right pb-1">金額</th>
                    <th className="text-left pb-1 pl-4">備考</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {t.lines.map((l, i) => (
                    <tr key={i}>
                      <td className={`py-1 font-medium text-xs ${l.side === "debit" ? "text-blue-600" : "text-red-600"}`}>
                        {l.side === "debit" ? "借方" : "貸方"}
                      </td>
                      <td className="py-1">{l.account.code} {l.account.name}</td>
                      <td className="py-1 text-right">{l.amount ? `¥${Number(l.amount).toLocaleString()}` : "—"}</td>
                      <td className="py-1 pl-4 text-slate-500">{l.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-2xl mx-4">
            <h2 className="text-lg font-bold text-slate-800 mb-4">テンプレート追加</h2>
            <div className="space-y-3 mb-4">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="テンプレート名 *" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="説明（任意）" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="space-y-2 mb-3">
              {form.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <select value={l.side} onChange={e => setLine(i, "side", e.target.value)}
                    className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                    <option value="debit">借方</option>
                    <option value="credit">貸方</option>
                  </select>
                  <select value={l.accountId} onChange={e => setLine(i, "accountId", e.target.value)}
                    className="col-span-4 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                    <option value="">科目選択</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </select>
                  <input type="number" value={l.amount} onChange={e => setLine(i, "amount", e.target.value)}
                    placeholder="金額" className="col-span-3 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                  <input value={l.note} onChange={e => setLine(i, "note", e.target.value)}
                    placeholder="備考" className="col-span-2 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                  <button onClick={() => removeLine(i)} className="col-span-1 text-red-400 hover:text-red-600 text-lg">×</button>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="text-sm text-indigo-600 hover:underline mb-4">+ 行追加</button>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">キャンセル</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">保存</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
