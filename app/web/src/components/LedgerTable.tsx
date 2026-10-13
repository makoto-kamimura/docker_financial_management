"use client";

// 実績管理の「履歴」の共通の表。出どころ（手動 / 銀行 / カード・電子マネー）が違っても、
// 同じ列（日付・口座・摘要・金額・科目・状態・操作）と、同じ位置の件数・絞り込み・ページ送りで見せる。
// 行の中身（科目の選択・状態のバッジ・操作のボタン）は呼び出し側が組み立てて渡す。
// 操作は、よく使うもの（削除など）をそのまま出し、残りは「その他」を開くと出る（列が詰まらないように）。

import { useState, type ReactNode } from "react";
import { Pager } from "@/components/ui";
import { useActualsScope } from "@/lib/client/use-view-mode";
import { businessUseText } from "@/lib/shared/business-use";
import { DirectionTag } from "@/components/DirectedAmount";
import { useQuery } from "@tanstack/react-query";
import { displayName, type ViewMode } from "@/lib/shared/display-name";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/shared/labels";

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
  /** 金額の表示（符号は付けず絶対値。向きは directionLabel と tone で示す） */
  amount: ReactNode;
  /** 金額の色。in = 入金・収入・返金（緑）、out = 出金・支出・利用（赤）、none = 色なし */
  tone: "in" | "out" | "none";
  /** 金額の前に付ける向きのラベル（入金・出金・利用・返金など） */
  directionLabel?: string;
  category: ReactNode;
  status: ReactNode;
  /** すぐ押せる操作（削除など） */
  actions?: ReactNode;
  /** 「その他」を開くと出る操作（チャージ先・毎月の入出金・削除など） */
  more?: ReactNode;
};

const yenTone = { in: "text-emerald-600", out: "text-rose-600", none: "text-slate-700" };

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
                    {r.directionLabel && <DirectionTag label={r.directionLabel} side={r.tone} />}
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

/** 摘要の横に出す事業利用の印（「事業 50%」）。事業利用でなければ何も出さない */
export function BusinessTag({
  businessUse,
  businessRatio,
}: {
  businessUse?: boolean;
  businessRatio?: number | null;
}) {
  const text = businessUseText(businessUse ?? false, businessRatio ?? null);
  if (!text) return null;
  return (
    <span className="ml-1.5 align-middle">
      <LedgerBadge tone="indigo" title="事業の分として数える割合（按分）">
        {text}
      </LedgerBadge>
    </span>
  );
}

/**
 * 個人事業主モードの「事業利用のみ」の絞り込み。個人事業主モードでは最初から事業利用の明細だけを出し、
 * 切り替えで全件も見られる（科目や事業利用を付け直すため）。ほかのモードでは絞らず、切り替えも出さない。
 */
export function useBusinessOnlyFilter() {
  const scope = useActualsScope();
  const [override, setOverride] = useState<boolean | null>(null);
  const isBusinessMode = scope === "business";
  const businessOnly = isBusinessMode && (override ?? true);
  const toggle = isBusinessMode ? (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 h-8">
      <input
        type="checkbox"
        checked={businessOnly}
        onChange={(e) => setOverride(e.target.checked)}
      />
      事業利用のみ
    </label>
  ) : null;
  const keep = <T extends { businessUse?: boolean }>(rows: T[]): T[] =>
    businessOnly ? rows.filter((r) => r.businessUse) : rows;
  return { businessOnly, toggle, keep };
}

/** 表の上に置く科目の絞り込み（収入・原価・経費の科目） */
export function LedgerCategoryFilter({
  accounts,
  mode,
  value,
  onChange,
}: {
  accounts: LedgerFilterAccount[];
  mode: ViewMode;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <select
      aria-label="科目で絞り込む"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="text-xs border border-slate-200 rounded-lg px-2 h-8 bg-white max-w-56"
    >
      <option value="">すべての科目</option>
      {CATEGORY_ORDER.filter((c) => FILTER_CATEGORIES.includes(c)).map((cat) => {
        const items = accounts.filter((a) => a.category === cat);
        if (items.length === 0) return null;
        return (
          <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
            {items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {displayName(a, mode)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

type LedgerFilterAccount = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};
const FILTER_CATEGORIES: string[] = ["REVENUE", "COGS", "EXPENSE"];

/** 履歴の状態の絞り込み（現金・銀行・カードで共通） */
export type LedgerStatus = "all" | "unassigned" | "actual";
export const LEDGER_STATUS_FILTERS: [LedgerStatus, string][] = [
  ["all", "全件"],
  ["unassigned", "未割り当て"],
  ["actual", "実績"],
];

/** 履歴の 1 ページの件数（予算の履歴と同じ） */
export const LEDGER_PAGE_SIZE = 30;

/**
 * 実績管理の「履歴」の明細を、サーバーでページ送り・絞り込みして読む（GET /api/ledger/history）。
 * 状態（全件・未割り当て・実績）・科目・事業利用のみ（個人事業主モード）で絞り、30 件ずつ新しい順に出す。
 * 取得のキーは種別ごとの既存のキー（actuals / bank-txns / card-txns）で始め、明細を変えたときの
 * 取り直し（invalidateQueries）がそのまま効くようにする。
 * accountId: 銀行の口座・カード（null = その種別のすべて）。現金は使わない。
 */
export function useLedgerHistory<T>({
  kind,
  accountId = null,
  mode,
}: {
  kind: "CASH" | "BANK" | "CARD";
  accountId?: number | null;
  mode: ViewMode;
}) {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<LedgerStatus>("all");
  const [categoryAccountId, setCategoryAccountId] = useState<number | null>(null);
  const businessFilter = useBusinessOnlyFilter();
  const scope = useActualsScope();
  // 口座や「事業利用のみ」を切り替えたら 1 ページ目に戻す
  const pageKey = `${accountId}:${businessFilter.businessOnly}`;
  const [shownKey, setShownKey] = useState(pageKey);
  if (shownKey !== pageKey) {
    setShownKey(pageKey);
    setOffset(0);
  }

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<LedgerFilterAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  const base =
    kind === "CASH"
      ? ["actuals"]
      : [kind === "BANK" ? "bank-txns" : "card-txns", accountId ?? "all"];
  const params = new URLSearchParams({
    kind,
    status,
    limit: String(LEDGER_PAGE_SIZE),
    offset: String(offset),
    ...(accountId !== null && kind !== "CASH" ? { accountId: String(accountId) } : {}),
    ...(categoryAccountId !== null ? { categoryAccountId: String(categoryAccountId) } : {}),
    ...(businessFilter.businessOnly ? { businessOnly: "1" } : {}),
  });
  const { data, isLoading } = useQuery({
    queryKey: [...base, "history", params.toString()],
    queryFn: async (): Promise<{ data: T[]; total: number }> => {
      const res = await fetch(`/api/ledger/history?${params}`);
      const json = await res.json();
      return { data: json.data ?? [], total: json.total ?? 0 };
    },
    // 個人事業主モードかどうか（事業利用のみの既定）が決まるまで待つ
    enabled: scope !== null,
    placeholderData: (prev) => prev,
  });

  const filtered = status !== "all" || categoryAccountId !== null || businessFilter.businessOnly;
  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <LedgerFilter
        options={LEDGER_STATUS_FILTERS}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setOffset(0);
        }}
      />
      <LedgerCategoryFilter
        accounts={(accounts ?? []).filter((a) => FILTER_CATEGORIES.includes(a.category))}
        mode={mode}
        value={categoryAccountId}
        onChange={(id) => {
          setCategoryAccountId(id);
          setOffset(0);
        }}
      />
      {businessFilter.toggle}
    </div>
  );
  return {
    rows: data?.data ?? [],
    total: data?.total ?? 0,
    loading: isLoading && !data,
    offset,
    setOffset,
    pageSize: LEDGER_PAGE_SIZE,
    toolbar,
    /** 絞り込みをしているか（空の表の文言を変える） */
    filtered,
    status,
  };
}
