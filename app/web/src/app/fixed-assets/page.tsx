"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

type Depreciation = { id: number; fiscalYear: number; amount: number | string };
type FixedAsset = {
  id: number; name: string; category: string;
  acquiredOn: string; acquisitionCost: number | string;
  usefulLife: number; method: string; bookValue: number | string;
  disposedOn: string | null;
  depreciations: Depreciation[];
};

const yen = (v: number | string) =>
  Number(v).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const CATEGORY_LABELS: Record<string, string> = {
  tangible: "有形固定資産", intangible: "無形固定資産",
};
const METHOD_LABELS: Record<string, string> = {
  straight: "定額法", declining: "定率法",
};

function NewAssetModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "", category: "tangible",
    acquiredOn: new Date().toISOString().slice(0, 10),
    acquisitionCost: 0, usefulLife: 5, method: "straight", residualRate: 0.1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const f = (k: string, v: string | number) => setForm(p => ({ ...p, [k]: v }));

  async function submit() {
    setSaving(true); setError(null);
    const res = await fetch("/api/fixed-assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      onClose();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? "保存に失敗しました");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[540px] p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">固定資産 登録</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2">
              <span className="text-xs font-medium text-slate-600">資産名 *</span>
              <input className="input-field mt-1 w-full" value={form.name}
                onChange={e => f("name", e.target.value)} placeholder="業務用PC" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">種別</span>
              <select className="input-field mt-1 w-full" value={form.category}
                onChange={e => f("category", e.target.value)}>
                <option value="tangible">有形固定資産</option>
                <option value="intangible">無形固定資産</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">取得日 *</span>
              <input type="date" className="input-field mt-1 w-full" value={form.acquiredOn}
                onChange={e => f("acquiredOn", e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">取得金額 *</span>
              <input type="number" className="input-field mt-1 w-full" value={form.acquisitionCost}
                onChange={e => f("acquisitionCost", Number(e.target.value))} min={0} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">耐用年数（年） *</span>
              <input type="number" className="input-field mt-1 w-full" value={form.usefulLife}
                onChange={e => f("usefulLife", Number(e.target.value))} min={1} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">償却方法</span>
              <select className="input-field mt-1 w-full" value={form.method}
                onChange={e => f("method", e.target.value)}>
                <option value="straight">定額法</option>
                <option value="declining">定率法</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">残存率</span>
              <input type="number" className="input-field mt-1 w-full" value={form.residualRate}
                onChange={e => f("residualRate", Number(e.target.value))}
                min={0} max={1} step={0.01} />
            </label>
          </div>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
            キャンセル
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="btn-primary text-sm px-5 py-2">
            {saving ? "保存中…" : "登録"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FixedAssetsPage() {
  const currentYear = new Date().getFullYear();
  const [showModal, setShowModal] = useState(false);
  const [deprYear, setDeprYear]   = useState(currentYear);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["fixed-assets"],
    queryFn: () => fetch("/api/fixed-assets").then(r => r.json()).then(r => r.data as FixedAsset[]),
  });

  const deprMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/fixed-assets/${id}/depreciate?year=${deprYear}`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fixed-assets"] }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/fixed-assets/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fixed-assets"] }),
  });

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title">固定資産管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">固定資産台帳・減価償却計算（F007/F008）</p>
        </div>
        <button type="button" onClick={() => setShowModal(true)} className="btn-primary text-sm px-4 py-2">
          + 固定資産 登録
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-slate-600">償却計上年度:</label>
        <select className="input-field w-28 py-1 text-sm" value={deprYear}
          onChange={e => setDeprYear(Number(e.target.value))}>
          {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map(y => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
        <span className="text-xs text-slate-400">を選択して各資産の「償却計上」を押す</span>
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : !data?.length ? (
        <div className="card text-center py-12 text-slate-400">
          <p className="text-sm">固定資産がありません。「固定資産 登録」から追加してください。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.map(asset => {
            const alreadyDepr = asset.depreciations.some(d => d.fiscalYear === deprYear);
            const totalDepr   = asset.depreciations.reduce((s, d) => s + Number(d.amount), 0);
            return (
              <div key={asset.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-800">{asset.name}</span>
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        {CATEGORY_LABELS[asset.category] ?? asset.category}
                      </span>
                      {asset.disposedOn && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">除却済</span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-xs text-slate-500 mb-2">
                      <span>取得日: {new Date(asset.acquiredOn).toLocaleDateString("ja-JP")}</span>
                      <span>取得金額: {yen(asset.acquisitionCost)}</span>
                      <span>耐用年数: {asset.usefulLife}年</span>
                      <span>償却方法: {METHOD_LABELS[asset.method] ?? asset.method}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-slate-600">帳簿価額:
                        <span className="font-bold text-slate-800 ml-1">{yen(asset.bookValue)}</span>
                      </span>
                      <span className="text-slate-500">累計償却額: {yen(totalDepr)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {!asset.disposedOn && (
                      <button type="button"
                        onClick={() => {
                          if (alreadyDepr) return alert(`${deprYear}年度は既に計上済みです`);
                          deprMut.mutate(asset.id);
                        }}
                        disabled={alreadyDepr}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                          alreadyDepr
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                        }`}>
                        {alreadyDepr ? `${deprYear}年 計上済` : `${deprYear}年 償却計上`}
                      </button>
                    )}
                    <button type="button"
                      onClick={() => { if (confirm("削除しますか？")) delMut.mutate(asset.id); }}
                      className="text-xs text-red-400 hover:text-red-600">削除</button>
                  </div>
                </div>

                {asset.depreciations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-50">
                    <p className="text-xs text-slate-400 mb-1.5">償却履歴</p>
                    <div className="flex gap-3 flex-wrap">
                      {asset.depreciations.map(d => (
                        <span key={d.id} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                          {d.fiscalYear}年: {yen(d.amount)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showModal && <NewAssetModal onClose={() => setShowModal(false)} />}
    </AppShell>
  );
}
