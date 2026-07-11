"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, EmptyState } from "@/components/StateViews";

type PersonalAssetCategory = "LAND" | "BUILDING" | "VEHICLE" | "GOLD" | "OTHER";
type PersonalAsset = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  acquiredOn: string | null;
  acquisitionCost: number | string | null;
  currentValue: number | string;
  note: string | null;
};

const PERSONAL_ASSET_CATEGORY_LABEL: Record<PersonalAssetCategory, string> = {
  LAND: "土地",
  BUILDING: "建物",
  VEHICLE: "車",
  GOLD: "金・貴金属",
  OTHER: "その他",
};

function NewPersonalAssetModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    category: "LAND" as PersonalAssetCategory,
    acquiredOn: "",
    acquisitionCost: "",
    currentValue: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!form.name || !form.currentValue) {
      setError("資産名と現在評価額は必須です。");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/personal-assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        acquiredOn: form.acquiredOn || undefined,
        acquisitionCost: form.acquisitionCost ? Number(form.acquisitionCost) : undefined,
        currentValue: Number(form.currentValue),
        note: form.note || undefined,
      }),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["personal-assets"] });
      onClose();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? "保存に失敗しました");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-[480px] p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">実物資産 登録</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">資産名 *</span>
            <input
              className="input-field mt-1 w-full"
              value={form.name}
              onChange={(e) => f("name", e.target.value)}
              placeholder="自宅土地"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">種別</span>
              <select
                className="input-field mt-1 w-full"
                value={form.category}
                onChange={(e) => f("category", e.target.value)}
              >
                {Object.entries(PERSONAL_ASSET_CATEGORY_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">取得日</span>
              <input
                type="date"
                className="input-field mt-1 w-full"
                value={form.acquiredOn}
                onChange={(e) => f("acquiredOn", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">取得価格（円）</span>
              <input
                type="number"
                className="input-field mt-1 w-full"
                value={form.acquisitionCost}
                onChange={(e) => f("acquisitionCost", e.target.value)}
                min={0}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">現在評価額（円） *</span>
              <input
                type="number"
                className="input-field mt-1 w-full"
                value={form.currentValue}
                onChange={(e) => f("currentValue", e.target.value)}
                min={0}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">備考</span>
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

function PersonalAssetsSection() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["personal-assets"],
    queryFn: () =>
      fetch("/api/personal-assets")
        .then((r) => r.json())
        .then((r) => (r.data ?? []) as PersonalAsset[]),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: number; currentValue: number }) =>
      fetch(`/api/personal-assets/${vars.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentValue: vars.currentValue }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personal-assets"] }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/personal-assets/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personal-assets"] }),
  });

  const assets = data ?? [];
  const total = assets.reduce((s, a) => s + Number(a.currentValue), 0);

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="section-title">実物資産（土地・建物・車・金など）</h2>
          <p className="text-xs text-slate-400 mt-0.5">合計評価額: {yen(total)}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="btn-primary text-sm px-4 py-2"
        >
          + 資産を登録
        </button>
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : assets.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">登録済みの実物資産がありません。</p>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                    {PERSONAL_ASSET_CATEGORY_LABEL[a.category]}
                  </span>
                  <span className="font-medium text-slate-800 text-sm">{a.name}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {a.acquiredOn && <span>取得日: {a.acquiredOn.slice(0, 10)} ・ </span>}
                  {a.acquisitionCost !== null && <span>取得価格: {yen(Number(a.acquisitionCost))}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {editId === a.id ? (
                  <>
                    <input
                      type="number"
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          updateMut.mutate({ id: a.id, currentValue: Number(editValue) });
                          setEditId(null);
                        }
                        if (e.key === "Escape") setEditId(null);
                      }}
                      className="w-28 text-right text-sm border border-indigo-400 rounded px-2 py-1"
                    />
                    <button
                      onClick={() => {
                        updateMut.mutate({ id: a.id, currentValue: Number(editValue) });
                        setEditId(null);
                      }}
                      className="text-xs text-indigo-600"
                    >
                      ✓
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(a.id);
                      setEditValue(String(a.currentValue));
                    }}
                    className="font-bold text-slate-800 text-sm hover:text-indigo-600"
                    title="クリックして評価額を更新"
                  >
                    {yen(Number(a.currentValue))}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("削除しますか？")) delMut.mutate(a.id);
                  }}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <NewPersonalAssetModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

type AccountBalance = {
  id: number;
  code: string;
  name: string;
  category: "ASSET" | "LIABILITY";
  parentId: number | null;
  parent: { id: number; code: string; name: string } | null;
  balances: { fiscalYear: number; month: number; amount: number }[];
};

type AssetsResponse = {
  years: number[];
  accounts: AccountBalance[];
};

const yen = (v: number) =>
  v >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";

function latestBalance(balances: AccountBalance["balances"], year: number): number {
  const ys = balances.filter((b) => b.fiscalYear === year);
  if (!ys.length) return 0;
  return ys.reduce((best, b) => (b.month > best.month ? b : best)).amount;
}

function leafOf(accounts: AccountBalance[], cat: "ASSET" | "LIABILITY"): AccountBalance[] {
  return accounts.filter(
    (a): a is AccountBalance => a.category === cat && !accounts.some((c) => c.parentId === a.id),
  );
}

function buildTrendData(accounts: AccountBalance[], years: number[]) {
  const assetLeaves = leafOf(accounts, "ASSET");
  const liabLeaves = leafOf(accounts, "LIABILITY");
  return years.map((year) => {
    const totalAsset = assetLeaves.reduce((s, a) => s + latestBalance(a.balances, year), 0);
    const totalLiab = liabLeaves.reduce((s, a) => s + latestBalance(a.balances, year), 0);
    return {
      year: String(year),
      資産合計: Math.round(totalAsset / 1_0000),
      負債合計: Math.round(totalLiab / 1_0000),
      純資産: Math.round((totalAsset - totalLiab) / 1_0000),
    };
  });
}

async function fetchAssets(): Promise<AssetsResponse> {
  const res = await fetch("/api/assets");
  if (!res.ok) throw new Error("failed to load assets");
  return res.json() as Promise<AssetsResponse>;
}

export default function AssetsPage() {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const { data, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: fetchAssets,
  });

  const year = selectedYear ?? data?.years.at(-1) ?? new Date().getFullYear();
  const accounts = data?.accounts ?? [];
  const years = data?.years ?? [];

  const topAssets = accounts.filter((a) => a.category === "ASSET" && a.parentId === null);
  const topLiabs = accounts.filter((a) => a.category === "LIABILITY" && a.parentId === null);

  const totalAsset = leafOf(accounts, "ASSET").reduce(
    (s, a) => s + latestBalance(a.balances, year),
    0,
  );
  const totalLiab = leafOf(accounts, "LIABILITY").reduce(
    (s, a) => s + latestBalance(a.balances, year),
    0,
  );
  const netWorth = totalAsset - totalLiab;

  const trendData = buildTrendData(accounts, years);

  const childrenOf = (parentId: number): AccountBalance[] =>
    accounts.filter((a) => a.parentId === parentId);

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="page-title">資産管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">バランスシート・純資産推移</p>
        </div>
        {years.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">表示年</label>
            <select
              value={year}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <PersonalAssetsSection />

      {isLoading && <LoadingSpinner />}

      {!isLoading && accounts.length === 0 && (
        <EmptyState
          title="資産データがありません"
          description="ASSET / LIABILITY カテゴリの勘定科目を登録し assets_lifeplan.csv をインポートしてください。"
        />
      )}

      {accounts.length > 0 && (
        <>
          {/* KPI カード */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="card text-center">
              <p className="text-xs text-slate-500 mb-1">資産合計</p>
              <p className="text-2xl font-bold text-emerald-600">{yen(totalAsset)}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs text-slate-500 mb-1">負債合計</p>
              <p className="text-2xl font-bold text-rose-600">{yen(totalLiab)}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs text-slate-500 mb-1">純資産</p>
              <p
                className={`text-2xl font-bold ${netWorth >= 0 ? "text-indigo-600" : "text-red-600"}`}
              >
                {yen(netWorth)}
              </p>
            </div>
          </div>

          {/* 純資産推移グラフ */}
          {trendData.length > 0 && (
            <div className="card mb-6">
              <h2 className="section-title mb-4">純資産推移（万円）</h2>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `${v.toLocaleString()}万円`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="資産合計"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="負債合計"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="純資産"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* バランスシート詳細テーブル */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* 資産の部 */}
            <div className="card">
              <h2 className="section-title">資産の部</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-100">
                    <th className="text-left py-1.5 font-medium">勘定科目</th>
                    <th className="text-right py-1.5 font-medium">{year}年末残高</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {topAssets.map((a) => {
                    const children = childrenOf(a.id);
                    const subtotal = children.reduce(
                      (s, c) => s + latestBalance(c.balances, year),
                      0,
                    );
                    const open = expandedIds.has(a.id);
                    return (
                      <>
                        <tr
                          key={a.id}
                          className="font-medium bg-slate-50/60 cursor-pointer select-none hover:bg-slate-100/80"
                          onClick={() => toggle(a.id)}
                        >
                          <td className="py-2 text-slate-800">
                            <span className="inline-flex items-center gap-1">
                              <svg
                                className="w-3 h-3 text-slate-400 shrink-0 transition-transform"
                                style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              <span className="text-xs font-mono text-slate-400 mr-1">
                                {a.code}
                              </span>
                              {a.name}
                            </span>
                          </td>
                          <td className="py-2 text-right text-emerald-700">{yen(subtotal)}</td>
                        </tr>
                        {open &&
                          children.map((c) => (
                            <tr key={c.id} className="text-slate-600">
                              <td className="py-1.5 pl-6">
                                <span className="text-xs font-mono text-slate-300 mr-2">
                                  {c.code}
                                </span>
                                {c.name}
                              </td>
                              <td className="py-1.5 text-right">
                                {yen(latestBalance(c.balances, year))}
                              </td>
                            </tr>
                          ))}
                      </>
                    );
                  })}
                  <tr className="font-bold border-t border-slate-200">
                    <td className="py-2.5 text-slate-800">資産合計</td>
                    <td className="py-2.5 text-right text-emerald-700">{yen(totalAsset)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 負債・純資産の部 */}
            <div className="card">
              <h2 className="section-title">負債・純資産の部</h2>
              {topLiabs.length > 0 && (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-100">
                      <th className="text-left py-1.5 font-medium">勘定科目</th>
                      <th className="text-right py-1.5 font-medium">{year}年末残高</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {topLiabs.map((a) => {
                      const children = childrenOf(a.id);
                      const subtotal = children.reduce(
                        (s, c) => s + latestBalance(c.balances, year),
                        0,
                      );
                      const open = expandedIds.has(a.id);
                      return (
                        <>
                          <tr
                            key={a.id}
                            className="font-medium bg-slate-50/60 cursor-pointer select-none hover:bg-slate-100/80"
                            onClick={() => toggle(a.id)}
                          >
                            <td className="py-2 text-slate-800">
                              <span className="inline-flex items-center gap-1">
                                <svg
                                  className="w-3 h-3 text-slate-400 shrink-0 transition-transform"
                                  style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                                <span className="text-xs font-mono text-slate-400 mr-1">
                                  {a.code}
                                </span>
                                {a.name}
                              </span>
                            </td>
                            <td className="py-2 text-right text-rose-700">{yen(subtotal)}</td>
                          </tr>
                          {open &&
                            children.map((c) => (
                              <tr key={c.id} className="text-slate-600">
                                <td className="py-1.5 pl-6">
                                  <span className="text-xs font-mono text-slate-300 mr-2">
                                    {c.code}
                                  </span>
                                  {c.name}
                                </td>
                                <td className="py-1.5 text-right">
                                  {yen(latestBalance(c.balances, year))}
                                </td>
                              </tr>
                            ))}
                        </>
                      );
                    })}
                    <tr className="font-bold border-t border-slate-200">
                      <td className="py-2 text-slate-800">負債合計</td>
                      <td className="py-2 text-right text-rose-700">{yen(totalLiab)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {topLiabs.length === 0 && (
                <p className="text-xs text-slate-400 mt-2 mb-4">負債データなし</p>
              )}
              <div className="pt-3 border-t border-slate-200 flex justify-between font-bold text-sm">
                <span className="text-slate-800">純資産</span>
                <span className={netWorth >= 0 ? "text-indigo-700" : "text-red-700"}>
                  {yen(netWorth)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
