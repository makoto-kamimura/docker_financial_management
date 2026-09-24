"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { isCountedAsAsset } from "@/lib/personal-asset";
import { useViewMode } from "@/lib/use-view-mode";
import { displayName } from "@/lib/display-name";
import { PERSONAL_ASSET_CATEGORY_LABEL, type PersonalAssetCategory } from "@/lib/labels";

type PersonalAsset = {
  id: number;
  name: string;
  category: PersonalAssetCategory;
  acquiredOn: string | null;
  acquisitionCost: number | string | null;
  currentValue: number | string;
  /** 純資産に評価額を計上するか。false = 負債のみ反映（ローンの諸費用等） */
  countAsAsset: boolean;
  note: string | null;
  linkedAccountId: number | null;
  debtStartOn: string | null;
  debtPayoffDue: string | null;
  debtInitialAmount: number | string | null;
  /** 年利（小数。0.0081 = 0.810%） */
  debtInterestRate: number | string | null;
  /** 残価設定ローンの据置額（最終回に一括支払い）。null / 0 = 通常ローン */
  debtResidualValue: number | string | null;
  debtMonthly: number | null;
  debtRemaining: number | null;
  debtRemainingMonths: number | null;
  createdAt: string;
  updatedAt: string;
};
type AccountRef = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};

const str = (v: number | string | null) => (v === null || v === undefined ? "" : String(v));

// 実物資産の登録・編集（asset を渡すと編集。モバイル版 AssetsScreen の登録・編集シートと同じ項目）
function PersonalAssetFormModal({
  asset,
  onClose,
}: {
  asset?: PersonalAsset;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const sysMode = useViewMode();
  const [form, setForm] = useState({
    name: asset?.name ?? "",
    category: (asset?.category ?? "LAND") as PersonalAssetCategory,
    acquiredOn: asset?.acquiredOn?.slice(0, 10) ?? "",
    acquisitionCost: str(asset?.acquisitionCost ?? null),
    currentValue: str(asset?.currentValue ?? null),
    countAsAsset: asset?.countAsAsset ?? true,
    note: asset?.note ?? "",
    linkedAccountId: str(asset?.linkedAccountId ?? null),
    debtStartOn: asset?.debtStartOn?.slice(0, 7) ?? "",
    debtPayoffDue: asset?.debtPayoffDue?.slice(0, 7) ?? "",
    debtInitialAmount: str(asset?.debtInitialAmount ?? null),
    // 画面は「％」で入力し、API へは小数（0.810 → 0.0081）に直して送る
    debtInterestPercent:
      asset?.debtInterestRate != null
        ? String(Number((Number(asset.debtInterestRate) * 100).toPrecision(6)))
        : "",
    // 残価設定ローン（カーローン等）の据置額。最終回に一括で支払う
    debtResidualValue: str(asset?.debtResidualValue ?? null),
  });
  const isEdit = asset !== undefined;

  const { data: liabilityAccounts } = useQuery({
    queryKey: ["accounts", "LIABILITY"],
    queryFn: async (): Promise<AccountRef[]> => {
      const json = await (await fetch("/api/accounts")).json();
      return ((json.data ?? []) as AccountRef[]).filter((a) => a.category === "LIABILITY");
    },
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = (k: keyof typeof form, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!form.name || !form.currentValue) {
      setError("資産名と現在評価額は必須です。");
      return;
    }
    if (form.debtStartOn && form.debtPayoffDue && form.debtStartOn > form.debtPayoffDue) {
      setError("支払い開始年月は解消予定年月以前にしてください。");
      return;
    }
    setSaving(true);
    setError(null);
    // 未入力の項目は、登録では送らず（サーバー既定値）、編集では null で送って消す
    const empty = isEdit ? null : undefined;
    const linked = form.linkedAccountId !== "";
    const res = await fetch(isEdit ? `/api/personal-assets/${asset.id}` : "/api/personal-assets", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        acquiredOn: form.acquiredOn || empty,
        acquisitionCost: form.acquisitionCost ? Number(form.acquisitionCost) : empty,
        currentValue: Number(form.currentValue),
        countAsAsset: form.countAsAsset,
        note: form.note || empty,
        linkedAccountId: linked ? Number(form.linkedAccountId) : empty,
        // 負債の項目は紐付け負債科目があるときだけ意味を持つ
        debtStartOn: (linked && form.debtStartOn) || empty,
        debtPayoffDue: (linked && form.debtPayoffDue) || empty,
        debtInitialAmount:
          linked && form.debtInitialAmount ? Number(form.debtInitialAmount) : empty,
        debtInterestRate:
          linked && form.debtInterestPercent ? Number(form.debtInterestPercent) / 100 : empty,
        debtResidualValue:
          linked && form.debtResidualValue ? Number(form.debtResidualValue) : empty,
      }),
    });
    if (res.ok) {
      // 評価額・負債は総資産サマリの元データでもあるので一緒に取り直す
      qc.invalidateQueries({ queryKey: ["personal-assets"] });
      qc.invalidateQueries({ queryKey: ["assets-summary"] });
      onClose();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: string }).error ?? "保存に失敗しました");
    }
    setSaving(false);
  }

  return (
    // 画面が低いと入力欄が枠外に出るため、オーバーレイ側で縦スクロールできるようにする
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-[480px] my-auto p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">
          {isEdit ? "実物資産 編集" : "実物資産 登録"}
        </h2>
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
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">紐付け負債科目（ローン等）</span>
              <select
                className="input-field mt-1 w-full"
                value={form.linkedAccountId}
                onChange={(e) => f("linkedAccountId", e.target.value)}
              >
                <option value="">なし</option>
                {(liabilityAccounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {displayName(a, sysMode)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">当初負債額（円）</span>
              <input
                type="number"
                className="input-field mt-1 w-full"
                value={form.debtInitialAmount}
                onChange={(e) => f("debtInitialAmount", e.target.value)}
                min={0}
                disabled={!form.linkedAccountId}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">年利（％）</span>
              <input
                type="number"
                step="0.001"
                min={0}
                placeholder="例: 0.810"
                className="input-field mt-1 w-full"
                value={form.debtInterestPercent}
                onChange={(e) => f("debtInterestPercent", e.target.value)}
                disabled={!form.linkedAccountId}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">支払い開始年月</span>
              <input
                type="month"
                className="input-field mt-1 w-full"
                value={form.debtStartOn}
                onChange={(e) => f("debtStartOn", e.target.value)}
                disabled={!form.linkedAccountId}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">残価（円）</span>
              <input
                type="number"
                min={0}
                placeholder="残価設定ローンのみ"
                className="input-field mt-1 w-full"
                value={form.debtResidualValue}
                onChange={(e) => f("debtResidualValue", e.target.value)}
                disabled={!form.linkedAccountId}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">負債解消（完済）予定年月</span>
              <input
                type="month"
                className="input-field mt-1 w-full"
                value={form.debtPayoffDue}
                onChange={(e) => f("debtPayoffDue", e.target.value)}
                disabled={!form.linkedAccountId}
              />
            </label>
          </div>
          <p className="text-[10px] text-slate-400">
            当初負債額・開始年月・解消予定年月を設定すると、開始月〜解消予定月の毎月の返済額を予算に自動計上し、負債残高を算出して表示します。年利を入力すると元利均等返済で計算します（未入力は無利子＝元本の月割り）。残価設定ローン（カーローン等）は残価を入力すると、最終回に残価を一括で支払う前提で月額と残高を計算します
          </p>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.countAsAsset}
              onChange={(e) => f("countAsAsset", e.target.checked)}
            />
            <span className="text-xs text-slate-600">
              純資産に評価額を計上する
              <span className="mt-0.5 block text-[10px] text-slate-400">
                ローンに含まれる登記費用・手数料など、借入はあるが資産価値を持たない項目はオフにしてください。オフにすると負債だけが純資産に反映されます
              </span>
            </span>
          </label>
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
            {saving ? "保存中…" : isEdit ? "保存" : "登録"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 総資産サマリ（F-8: 実物資産・銀行口座残高・ローンを含む純資産） ──────────
type NetWorthBreakdownItem = { key: string; label: string; amount: number };
type NetWorthSummary = {
  year: number;
  month: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown: NetWorthBreakdownItem[];
};

function NetWorthSummaryCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["assets-summary"],
    queryFn: async (): Promise<NetWorthSummary> => (await fetch("/api/assets/summary")).json(),
  });

  if (isLoading || !data) {
    return (
      <div className="card mb-6">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">
          総資産サマリ（{data.year}年{data.month}月時点）
        </h2>
        <p className="text-xs text-slate-400">実物資産・銀行口座残高・ローンを含む純資産</p>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">総資産</p>
          <p className="text-2xl font-bold text-emerald-600">{yen(data.totalAssets)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">総負債</p>
          <p className="text-2xl font-bold text-rose-600">{yen(data.totalLiabilities)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">純資産</p>
          <p
            className={`text-2xl font-bold ${data.netWorth >= 0 ? "text-indigo-600" : "text-red-600"}`}
          >
            {yen(data.netWorth)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-3">
        {data.breakdown
          .filter((b) => b.amount !== 0)
          .map((b) => (
            <span key={b.key}>
              {b.label}: <span className="font-medium text-slate-700">{yen(b.amount)}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

function PersonalAssetsSection() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editAsset, setEditAsset] = useState<PersonalAsset | null>(null);

  // 評価額・資産計上・負債は総資産サマリの元データでもあるので一緒に取り直す
  const invalidateAssets = () => {
    qc.invalidateQueries({ queryKey: ["personal-assets"] });
    qc.invalidateQueries({ queryKey: ["assets-summary"] });
  };
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
    onSuccess: invalidateAssets,
  });

  const delMut = useMutation({
    mutationFn: (id: number) => fetch(`/api/personal-assets/${id}`, { method: "DELETE" }),
    onSuccess: invalidateAssets,
  });

  // 純資産に計上するかの切り替え（ローンの諸費用などを資産計上外にする）
  const countMut = useMutation({
    mutationFn: (vars: { id: number; countAsAsset: boolean }) =>
      fetch(`/api/personal-assets/${vars.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countAsAsset: vars.countAsAsset }),
      }),
    onSuccess: invalidateAssets,
  });

  const assets = data ?? [];
  const total = assets.filter(isCountedAsAsset).reduce((s, a) => s + Number(a.currentValue), 0);
  const totalDebt = assets.reduce((s, a) => s + (a.debtRemaining ?? 0), 0);
  const hasExcluded = assets.some((a) => !isCountedAsAsset(a));

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="section-title">実物資産（土地・建物・車・金など）</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            合計評価額: {yen(total)}
            {totalDebt > 0 && (
              <span className="text-amber-600"> ・ 負債残高合計: {yen(totalDebt)}</span>
            )}
            {hasExcluded && <span> ・ 「資産計上外」の項目は負債のみ反映</span>}
          </p>
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
                  <button
                    type="button"
                    onClick={() => countMut.mutate({ id: a.id, countAsAsset: !a.countAsAsset })}
                    disabled={countMut.isPending}
                    title={
                      isCountedAsAsset(a)
                        ? "クリックすると純資産の評価額から除外します（ローンの諸費用など）"
                        : "クリックすると純資産に評価額を計上します"
                    }
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
                      isCountedAsAsset(a)
                        ? "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100"
                        : "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100"
                    }`}
                  >
                    {isCountedAsAsset(a) ? "資産計上" : "資産計上外"}
                  </button>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {a.acquiredOn && <span>取得日: {a.acquiredOn.slice(0, 10)} ・ </span>}
                  {a.acquisitionCost !== null && (
                    <span>取得価格: {yen(Number(a.acquisitionCost))} ・ </span>
                  )}
                  <span>登録日: {a.createdAt.slice(0, 10)}</span>
                </div>
                {a.debtRemaining !== null && (
                  <div className="text-xs text-amber-600 mt-0.5">
                    負債残高: {yen(a.debtRemaining)}（残り{a.debtRemainingMonths}回・月
                    {yen(a.debtMonthly ?? 0)}・年利
                    {(Number(a.debtInterestRate ?? 0) * 100).toFixed(3)}%・
                    {a.debtPayoffDue?.slice(0, 7)}解消予定）
                    {Number(a.debtResidualValue ?? 0) > 0 && (
                      <span className="block">
                        残価設定ローン: 最終回に {yen(Number(a.debtResidualValue))} を一括支払い
                      </span>
                    )}
                  </div>
                )}
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
                  onClick={() => setEditAsset(a)}
                  className="text-xs text-indigo-500 hover:text-indigo-700"
                >
                  編集
                </button>
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

      {showModal && <PersonalAssetFormModal onClose={() => setShowModal(false)} />}
      {editAsset && <PersonalAssetFormModal asset={editAsset} onClose={() => setEditAsset(null)} />}
    </div>
  );
}

const yen = (v: number) =>
  v >= 1_0000
    ? `${(v / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : v.toLocaleString("ja-JP") + "円";

// 資産管理は「総資産サマリ（実物資産・銀行口座残高・ローンを含む純資産）」と「実物資産」の
// 2 つに絞る。ASSET / LIABILITY 科目の残高から作っていた KPI カード（資産合計・負債合計・
// 純資産）と純資産推移グラフは、家計モードでは科目側に残高を積まないため常に 0 円になり、
// 同じ数字は総資産サマリが実データ（銀行口座・実物資産・ローン）から出しているため撤去した。
export default function AssetsPage() {
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">資産管理</h1>
        <p className="text-sm text-slate-500 mt-0.5">バランスシート・実物資産</p>
      </div>

      <NetWorthSummaryCard />

      <PersonalAssetsSection />
    </AppShell>
  );
}
