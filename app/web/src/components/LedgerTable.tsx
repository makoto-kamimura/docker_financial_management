"use client";

// 実績管理の「履歴」の共通の表。出どころ（手動 / 銀行 / カード・電子マネー）が違っても、
// 同じ列（日付・口座・摘要・金額・科目・状態・操作）と、同じ位置の件数・絞り込み・ページ送りで見せる。
// 行の中身（科目の選択・状態のバッジ・操作のボタン）は呼び出し側が組み立てて渡す。
// 操作は、よく使うもの（削除など）をそのまま出し、残りは「その他」を開くと出る（列が詰まらないように）。

import type { ReactNode } from "react";
import { Pager } from "@/components/ui";

export type LedgerColumn =
  | "date"
  | "account"
  | "description"
  | "amount"
  | "category"
  | "status"
  | "actions";

export const LEDGER_COLUMNS: [LedgerColumn, string][] = [
  ["date", "日付"],
  ["account", "口座"],
  ["description", "摘要"],
  ["amount", "金額"],
  ["category", "科目"],
  ["status", "状態"],
  ["actions", "操作"],
];

export type LedgerRow = {
  key: string | number;
  date: ReactNode;
  account: ReactNode;
  description: ReactNode;
  /** 金額の表示（符号つきの円など） */
  amount: ReactNode;
  /** 金額の色。in = 入金・収入（緑）、out = 出金・支出（赤）、none = 色なし */
  tone: "in" | "out" | "none";
  category: ReactNode;
  status: ReactNode;
  /** すぐ押せる操作（削除など） */
  actions?: ReactNode;
  /** 「その他」を開くと出る操作（チャージ先・毎月の入出金・削除など） */
  more?: ReactNode;
};

const yenTone = { in: "text-emerald-600", out: "text-red-600", none: "text-slate-700" };

export function LedgerTable({
  rows,
  total,
  offset,
  pageSize,
  onPageChange,
  toolbar,
  headers,
  emptyText = "記録がありません",
}: {
  rows: LedgerRow[];
  /** 全件数（ページ送り・件数の表示に使う） */
  total: number;
  offset: number;
  pageSize: number;
  onPageChange: (offset: number) => void;
  /** 件数の右に置く絞り込みなど */
  toolbar?: ReactNode;
  /** 見出しの差し替え（並べ替えのボタンなど） */
  headers?: Partial<Record<LedgerColumn, ReactNode>>;
  emptyText?: string;
}) {
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-xs text-slate-500">
          {total > 0
            ? `全 ${total.toLocaleString()} 件中 ${offset + 1}〜${Math.min(offset + pageSize, total)} 件を表示`
            : "0 件"}
        </p>
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[56rem]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {LEDGER_COLUMNS.map(([key, label]) => (
                  <th
                    key={key}
                    className={`px-3 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap ${key === "amount" ? "text-right" : "text-left"}`}
                  >
                    {headers?.[key] ?? label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50 align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">{r.date}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 text-xs">
                    {r.account}
                  </td>
                  <td className="px-3 py-2.5 text-slate-800">{r.description}</td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${yenTone[r.tone]}`}
                  >
                    {r.amount}
                  </td>
                  <td className="px-3 py-2.5">{r.category}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">{r.status}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      {r.actions}
                      {r.more && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-slate-500 hover:text-slate-700 select-none">
                            その他
                          </summary>
                          <div className="mt-2 flex flex-col gap-2 min-w-44">{r.more}</div>
                        </details>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={LEDGER_COLUMNS.length}
                    className="px-4 py-8 text-center text-slate-400 text-sm"
                  >
                    {emptyText}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total > pageSize && (
          <Pager
            offset={offset}
            pageSize={pageSize}
            total={total}
            onChange={onPageChange}
            className="px-4 py-3 border-t border-slate-100"
          />
        )}
      </div>
    </>
  );
}

/** 状態の列に並べる小さなバッジ */
export function LedgerBadge({
  tone = "slate",
  children,
  title,
}: {
  tone?: "slate" | "emerald" | "sky" | "indigo" | "amber" | "rose";
  children: ReactNode;
  title?: string;
}) {
  const colors = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    indigo: "bg-indigo-50 text-indigo-600",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <span
      title={title}
      className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${colors[tone]}`}
    >
      {children}
    </span>
  );
}

/** 「その他」の中の 1 ブロック（見出しつき） */
export function LedgerMoreSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
      <p className="text-[10px] font-semibold text-slate-400 mb-1">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

/** 表の上に置く「全件 / 未割り当て / 実績」などの切り替え */
export function LedgerFilter<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs h-8">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 font-medium transition-colors ${value === v ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
