"use client";

// チャージ（銀行口座・カード → デビット / プリペイド / 電子マネー）を指定するときに、
// チャージ先に入った明細を選んで対にするためのモーダル。
//
// チャージ元の明細に「チャージ先」を持たせるだけでは、チャージ先に入った記録と結び付かない。
// チャージ先の CSV に入金行が含まれる場合、その行を科目に紐付けると同じ資金が収入として
// 二重に効いてしまうため、ここで対にして両方を収支の対象外にする。
// チャージ先に入金の記録が無い CSV（利用明細しか出てこない）では「紐づけずに指定」を選ぶ。

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export type ChargeCandidate = {
  id: number;
  date: string;
  description: string;
  amount: number;
  categoryAccount: { id: number; code: string; name: string } | null;
  dayGap: number;
  amountMatch: boolean;
  incoming: boolean;
};

type Props = {
  /** チャージ元の明細（銀行明細・カード明細のどちらでも） */
  source: { date: string; description: string; amount: number };
  /** チャージ先のカード・電子マネー */
  target: { id: number; name: string };
  onCancel: () => void;
  /** 選んだチャージ先の明細 id。紐付けない場合は null */
  onConfirm: (pairTxnId: number | null) => void;
};

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ja-JP");

export function ChargeLinkModal({ source, target, onCancel, onConfirm }: Props) {
  const [selected, setSelected] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["charge-candidates", target.id, source.date, source.amount],
    queryFn: async (): Promise<{ data: ChargeCandidate[]; total: number }> => {
      const params = new URLSearchParams({
        targetAccountId: String(target.id),
        amount: String(source.amount),
        date: source.date.slice(0, 10),
      });
      const res = await fetch(`/api/charge-links/candidates?${params}`);
      if (!res.ok) return { data: [], total: 0 };
      const json = await res.json();
      return { data: json.data ?? [], total: json.total ?? 0 };
    },
  });
  const candidates = data?.data ?? [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-2xl my-auto">
        <h2 className="text-lg font-bold text-slate-800 mb-1">チャージ先の履歴と紐付ける</h2>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          この明細を <span className="font-medium text-slate-700">{target.name}</span>{" "}
          へのチャージとして指定します。チャージ先にも入金の記録がある場合は、その明細を選んで
          紐付けてください（両方が収入・支出の集計から外れ、二重計上を防げます）。
          チャージ先に入金の記録が無ければ「紐づけずに指定」で構いません。
        </p>

        <div className="rounded-lg bg-slate-50 px-3 py-2 mb-4 text-xs text-slate-600">
          <span className="font-medium">チャージ元:</span> {fmtDate(source.date)} ·{" "}
          {source.description} ·{" "}
          <span className="tabular-nums">{yen(Math.abs(source.amount))}</span>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-400 py-6 text-center">候補を読み込み中…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center leading-relaxed">
            {target.name} に、この日付の前後で紐付けできる明細は見つかりませんでした。
            <br />
            <span className="text-xs text-slate-400">
              まだ CSV を取り込んでいない、または入金の記録が出てこないカードの場合は
              「紐づけずに指定」を選んでください。
            </span>
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelected(c.id === selected ? null : c.id)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-slate-50 ${
                  selected === c.id ? "bg-indigo-50 hover:bg-indigo-50" : ""
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 shrink-0 rounded-full border ${
                    selected === c.id ? "border-indigo-600 bg-indigo-600" : "border-slate-300"
                  }`}
                  aria-hidden="true"
                />
                <span className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(c.date)}</span>
                <span className="text-sm text-slate-700 truncate flex-1">{c.description}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {c.amountMatch && (
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">
                      金額一致
                    </span>
                  )}
                  {c.incoming && (
                    <span className="text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded">
                      入金
                    </span>
                  )}
                  {c.dayGap > 0 && (
                    <span className="text-[10px] text-slate-400">{c.dayGap}日ずれ</span>
                  )}
                  {c.categoryAccount && (
                    <span
                      className="text-[10px] text-amber-600"
                      title="紐付けると、この明細に付いている科目は外れます"
                    >
                      科目あり
                    </span>
                  )}
                </span>
                <span className="text-sm tabular-nums text-slate-600 whitespace-nowrap">
                  {yen(Math.abs(c.amount))}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onConfirm(null)}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            紐づけずに指定
          </button>
          <button
            type="button"
            onClick={() => selected !== null && onConfirm(selected)}
            disabled={selected === null}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            紐づけて指定
          </button>
        </div>
      </div>
    </div>
  );
}
