"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

type InventoryItem = {
  itemName: string;
  itemType: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
};
type Inventory = {
  id: number;
  name: string;
  inventoryDate: string;
  status: string;
  valuationMethod: string;
  totalAmount: number | string;
  items: (InventoryItem & { id: number })[];
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  product: "商品",
  material: "原材料",
  wip: "仕掛品",
  goods: "製品",
};
const VALUATION_LABELS: Record<string, string> = {
  last_purchase: "最終仕入原価法",
  average: "総平均法",
  moving_average: "移動平均法",
};

const yen = (v: number | string) =>
  Number(v).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const EMPTY_ITEM = (): InventoryItem => ({
  itemName: "",
  itemType: "product",
  quantity: 1,
  unit: "個",
  unitPrice: 0,
  totalAmount: 0,
});

function NewInventoryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [name, setName] = useState(`${currentYear}年度棚卸`);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [valuationMethod, setMethod] = useState("last_purchase");
  const [items, setItems] = useState<InventoryItem[]>([EMPTY_ITEM()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setItem(idx: number, field: keyof InventoryItem, val: string | number) {
    setItems((prev) => {
      const next = [...prev];
      const row = { ...next[idx], [field]: val };
      if (field === "quantity" || field === "unitPrice") {
        row.totalAmount = Number(row.quantity) * Number(row.unitPrice);
      }
      next[idx] = row;
      return next;
    });
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/inventories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        inventoryDate: date,
        valuationMethod,
        items: items.filter((i) => i.itemName),
      }),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["inventories"] });
      onClose();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? "保存に失敗しました");
    }
    setSaving(false);
  }

  const total = items.reduce((s, i) => s + Number(i.totalAmount), 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[700px] max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">棚卸入力</h2>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">棚卸名</span>
            <input
              className="input-field mt-1 w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">棚卸日</span>
            <input
              type="date"
              className="input-field mt-1 w-full"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <div className="mb-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">評価方法</span>
            <select
              className="input-field mt-1 w-64"
              value={valuationMethod}
              onChange={(e) => setMethod(e.target.value)}
            >
              {Object.entries(VALUATION_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <table className="w-full text-sm mb-2">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-100">
              <th className="text-left py-1.5 font-medium w-1/4">商品名</th>
              <th className="text-left py-1.5 font-medium w-20 pl-1">区分</th>
              <th className="text-right py-1.5 font-medium w-20">数量</th>
              <th className="text-left py-1.5 font-medium w-16 pl-1">単位</th>
              <th className="text-right py-1.5 font-medium w-28">単価（円）</th>
              <th className="text-right py-1.5 font-medium w-28">金額</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {items.map((item, idx) => (
              <tr key={idx}>
                <td className="py-1">
                  <input
                    className="input-field w-full text-sm py-1"
                    value={item.itemName}
                    onChange={(e) => setItem(idx, "itemName", e.target.value)}
                    placeholder="商品名"
                  />
                </td>
                <td className="py-1 pl-1">
                  <select
                    className="input-field w-full text-sm py-1"
                    value={item.itemType}
                    onChange={(e) => setItem(idx, "itemType", e.target.value)}
                  >
                    {Object.entries(ITEM_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pl-1">
                  <input
                    type="number"
                    className="input-field w-full text-sm py-1 text-right"
                    value={item.quantity}
                    onChange={(e) => setItem(idx, "quantity", Number(e.target.value))}
                    min={0}
                    step={0.001}
                  />
                </td>
                <td className="py-1 pl-1">
                  <input
                    className="input-field w-full text-sm py-1"
                    value={item.unit}
                    onChange={(e) => setItem(idx, "unit", e.target.value)}
                  />
                </td>
                <td className="py-1 pl-1">
                  <input
                    type="number"
                    className="input-field w-full text-sm py-1 text-right"
                    value={item.unitPrice}
                    onChange={(e) => setItem(idx, "unitPrice", Number(e.target.value))}
                    min={0}
                  />
                </td>
                <td className="py-1 pl-1 text-right text-slate-700 font-mono text-xs">
                  {yen(item.totalAmount)}
                </td>
                <td className="py-1 pl-1">
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-500 text-xs"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          type="button"
          onClick={() => setItems((p) => [...p, EMPTY_ITEM()])}
          className="text-xs text-indigo-600 hover:underline mb-4"
        >
          + 行を追加
        </button>

        <div className="border-t border-slate-100 pt-3 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">合計: {yen(total)}</span>
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
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InventoriesPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [showModal, setShowModal] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["inventories", year],
    queryFn: () =>
      fetch(`/api/inventories?year=${year}`)
        .then((r) => r.json())
        .then((r) => r.data as Inventory[]),
  });

  const closeMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/inventories/${id}/close`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventories"] }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/inventories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventories"] }),
  });

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title">棚卸管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">期末棚卸資産の記録・確定（F006）</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="btn-primary text-sm px-4 py-2"
        >
          + 棚卸入力
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-slate-600">年度:</label>
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
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : !data?.length ? (
        <div className="card text-center py-12 text-slate-400">
          <p className="text-sm">棚卸データがありません。「棚卸入力」から追加してください。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((inv) => (
            <div key={inv.id} className="card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-semibold text-slate-800">{inv.name}</span>
                  <span className="ml-3 text-sm text-slate-500">
                    {new Date(inv.inventoryDate).toLocaleDateString("ja-JP")}
                  </span>
                  <span
                    className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                      inv.status === "closed"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {inv.status === "closed" ? "確定済" : "入力中"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-700">{yen(inv.totalAmount)}</span>
                  {inv.status === "open" && (
                    <button
                      type="button"
                      onClick={() => closeMut.mutate(inv.id)}
                      className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                    >
                      確定
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("削除しますか？")) delMut.mutate(inv.id);
                    }}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    削除
                  </button>
                </div>
              </div>

              {inv.items.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="text-left pb-1 font-medium">商品名</th>
                      <th className="text-right pb-1 font-medium">数量</th>
                      <th className="text-right pb-1 font-medium">単価</th>
                      <th className="text-right pb-1 font-medium">金額</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {inv.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-1 text-slate-700">{item.itemName}</td>
                        <td className="py-1 text-right text-slate-600">
                          {item.quantity} {item.unit}
                        </td>
                        <td className="py-1 text-right text-slate-600">{yen(item.unitPrice)}</td>
                        <td className="py-1 text-right font-medium">{yen(item.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && <NewInventoryModal onClose={() => setShowModal(false)} />}
    </AppShell>
  );
}
