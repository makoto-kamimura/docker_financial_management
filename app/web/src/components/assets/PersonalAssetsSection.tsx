"use client";

// 資産管理の「実物資産」の一覧（評価額の手入力・登録・編集・削除）。

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { TrendBadge } from "@/components/AssetTrendCharts";
import { SectionLead } from "@/components/Explain";
import { asOfDateLabel } from "@/lib/shared/asset-valuation";
import { ASSETS_HELP } from "@/lib/shared/help-texts";
import { isCountedAsAsset } from "@/lib/assets/personal-asset";
import { PERSONAL_ASSET_CATEGORY_LABEL } from "@/lib/shared/labels";
import { yenShort } from "@/lib/common/format";
import { PersonalAsset } from "@/components/assets/types";
import { PersonalAssetFormModal } from "@/components/assets/PersonalAssetFormModal";

// 評価額・資産計上・負債は、推移と総資産サマリ（ダッシュボード）の元データでもあるので一緒に取り直す
export function useInvalidateAssets() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["personal-assets"] });
    qc.invalidateQueries({ queryKey: ["personal-assets-trend"] });
    qc.invalidateQueries({ queryKey: ["assets-summary"] });
  };
}

// 評価額を手で入れ直す欄（押すと入力になり、Enter か ✓ で保存。保存した値から先を見積もり直す）
function ValueEditor({
  value,
  label,
  onSave,
}: {
  value: number | string;
  label: string;
  onSave: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setText(String(Number(value)));
        }}
        className="text-[11px] text-indigo-500 hover:text-indigo-700"
        title={`${label}の評価額を入れ直します。入れた値から先を見積もり直します`}
      >
        評価額を更新
      </button>
    );
  }
  const save = () => {
    if (text.trim() !== "" && Number(text) >= 0) onSave(Number(text));
    setEditing(false);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        autoFocus
        aria-label={`${label}の評価額`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-28 text-right text-sm border border-indigo-400 rounded px-2 py-1"
      />
      <button type="button" onClick={save} className="text-xs text-indigo-600">
        ✓
      </button>
    </span>
  );
}

/** 最後の評価額の記録（手で入れた値、または価値の変わり方を変えたときの見積もり） */
const lastValuedText = (value: number | string, on: string | null) =>
  on ? `${on} 時点の評価額 ${yenShort(Number(value))}` : `評価額 ${yenShort(Number(value))}`;

export function PersonalAssetsSection() {
  const invalidateAssets = useInvalidateAssets();
  const [showModal, setShowModal] = useState(false);
  const [editAsset, setEditAsset] = useState<PersonalAsset | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["personal-assets"],
    queryFn: () =>
      fetch("/api/personal-assets")
        .then((r) => r.json())
        .then((r) => (r.data ?? []) as PersonalAsset[]),
  });

  const patch = (id: number, body: Record<string, unknown>) =>
    fetch(`/api/personal-assets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  // 評価額の入れ直し（資産そのもの、または内訳）。内訳は全件を送り、変えた内訳だけ値を差し替える
  const valueMut = useMutation({
    mutationFn: (vars: { asset: PersonalAsset; partId?: number; value: number }) =>
      vars.partId === undefined
        ? patch(vars.asset.id, { currentValue: vars.value })
        : patch(vars.asset.id, {
            parts: vars.asset.parts.map((p) => ({
              id: p.id,
              name: p.name,
              category: p.category,
              acquisitionCost: p.acquisitionCost === null ? null : Number(p.acquisitionCost),
              currentValue: p.id === vars.partId ? vars.value : Number(p.currentValue),
            })),
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
      patch(vars.id, { countAsAsset: vars.countAsAsset }),
    onSuccess: invalidateAssets,
  });

  const assets = data ?? [];
  const total = assets
    .filter(isCountedAsAsset)
    .reduce((s, a) => s + (a.estimatedValue ?? Number(a.currentValue)), 0);
  const totalDebt = assets.reduce((s, a) => s + (a.debtRemaining ?? 0), 0);
  const hasExcluded = assets.some((a) => !isCountedAsAsset(a));

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="section-title mb-1">実物資産（土地・建物・車・金など）</h2>
          <SectionLead className="mb-1">{ASSETS_HELP.personal}</SectionLead>
          <p className="text-xs text-slate-400 mt-0.5">
            {asOfDateLabel(new Date())}の見積もりの合計: {yenShort(total)}
            {totalDebt > 0 && (
              <span className="text-amber-600"> ・ 負債残高合計: {yenShort(totalDebt)}</span>
            )}
            {hasExcluded && <span> ・ 「資産計上外」の項目は負債のみ反映</span>}
          </p>
        </div>
        <button type="button" onClick={() => setShowModal(true)} className="btn-primary">
          + 資産を登録
        </button>
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : assets.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">{ASSETS_HELP.empty}</p>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <div key={a.id} className="border border-slate-100 rounded-lg px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
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
                    <TrendBadge trend={a.trend} />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {a.acquiredOn && <span>取得日: {a.acquiredOn.slice(0, 10)} ・ </span>}
                    {a.acquisitionCost !== null && (
                      <span>取得価格: {yenShort(Number(a.acquisitionCost))} ・ </span>
                    )}
                    {a.ruleLabel && <span>価値の変わり方: {a.ruleLabel} ・ </span>}
                    {a.parts.length === 0 && (
                      <span>{lastValuedText(a.currentValue, a.lastValuedOn)}</span>
                    )}
                  </div>
                  {a.loanId !== null && (
                    <div className="text-xs text-amber-600 mt-0.5">
                      借入: {a.loanLenderName} ・ {asOfDateLabel(new Date())}の残高{" "}
                      {yenShort(a.debtRemaining ?? 0)} ・{" "}
                      <Link href={"/loans" as never} className="underline">
                        借入金管理で見る
                      </Link>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400">
                      {asOfDateLabel(new Date())}の見積もり
                    </p>
                    <p className="font-bold text-slate-800 text-sm tabular-nums">
                      {yenShort(a.estimatedValue ?? Number(a.currentValue))}
                    </p>
                    {a.parts.length === 0 && (
                      <ValueEditor
                        value={a.currentValue}
                        label={a.name}
                        onSave={(v) => valueMut.mutate({ asset: a, value: v })}
                      />
                    )}
                  </div>
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

              {/* 内訳（土地と建物など）。内訳ごとに価値の変わり方と評価額の入れ直し */}
              {a.parts.length > 0 && (
                <ul className="mt-2 border-t border-slate-100 pt-2 space-y-1.5">
                  {a.parts.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 pl-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-slate-300" aria-hidden="true">
                            └
                          </span>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                            {PERSONAL_ASSET_CATEGORY_LABEL[p.category]}
                          </span>
                          <span className="text-sm text-slate-700">{p.name}</span>
                          <TrendBadge trend={p.trend} />
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 pl-5">
                          {p.acquisitionCost !== null && (
                            <span>取得価格: {yenShort(Number(p.acquisitionCost))} ・ </span>
                          )}
                          価値の変わり方: {p.ruleLabel} ・{" "}
                          {lastValuedText(p.currentValue, p.lastValuedOn)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-700 tabular-nums">
                          {yenShort(p.estimatedValue ?? Number(p.currentValue))}
                        </p>
                        <ValueEditor
                          value={p.currentValue}
                          label={`${a.name}の${p.name}`}
                          onSave={(v) => valueMut.mutate({ asset: a, partId: p.id, value: v })}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && <PersonalAssetFormModal onClose={() => setShowModal(false)} />}
      {editAsset && <PersonalAssetFormModal asset={editAsset} onClose={() => setEditAsset(null)} />}
    </div>
  );
}
