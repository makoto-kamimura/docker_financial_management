"use client";

// 画面をまたいで同じ見た目にするための小さな部品（モバイルの components/ui.tsx に相当）。
// 以前は画面ごとに markup を書き写していたため、余白・色・ボタンの種類がばらついていた。
//   PageHeader       … ページ見出し（タイトル・説明・対象年度のバッジ・右側の操作）
//   Tabs             … ページ内のタブ
//   Notice           … 成功・エラー・注意・案内のお知らせ（閉じるボタンは任意）
//   Pager            … 前へ・次へのページ送り
//   SegmentedControl … 2〜3 択の切替（表示範囲・表示形式など）
//   CsvDropzone      … CSV ファイルを選ぶ／ドロップする枠

import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { PageLead } from "@/components/Explain";
import { YearBadge } from "@/components/YearBadge";

export function PageHeader({
  title,
  lead,
  showYear = false,
  actions,
}: {
  title: string;
  lead?: ReactNode;
  /** 対象年度（左のメニューで選ぶ）で絞る画面ならバッジを出す */
  showYear?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="page-title">{title}</h1>
          {showYear && <YearBadge />}
        </div>
        <PageLead>{lead}</PageLead>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "mb-6",
}: {
  tabs: readonly (readonly [T, ReactNode])[];
  value: T;
  onChange: (tab: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex gap-1 border-b border-slate-200 overflow-x-auto ${className}`}
    >
      {tabs.map(([t, label]) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={value === t}
          onClick={() => onChange(t)}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
            value === t
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const NOTICE_TONE = {
  success: "text-green-700 bg-green-50 border-green-200",
  error: "text-red-700 bg-red-50 border-red-200",
  warn: "text-amber-800 bg-amber-50 border-amber-200",
  info: "text-indigo-800 bg-indigo-50 border-indigo-200",
} as const;

export type NoticeTone = keyof typeof NOTICE_TONE;

export function Notice({
  tone = "info",
  children,
  onClose,
  className = "",
}: {
  tone?: NoticeTone;
  children: ReactNode;
  /** 指定すると右端に閉じるボタンを出す */
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${NOTICE_TONE[tone]} ${className}`}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="shrink-0 opacity-60 hover:opacity-100"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function Pager({
  offset,
  pageSize,
  total,
  onChange,
  className = "",
}: {
  /** 表示中の先頭の位置（0 始まり） */
  offset: number;
  pageSize: number;
  total: number;
  onChange: (offset: number) => void;
  className?: string;
}) {
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(0, offset - pageSize))}
        disabled={offset === 0}
        className="btn-secondary btn-sm"
      >
        ← 前の {pageSize} 件
      </button>
      <span className="text-xs text-slate-400">
        {page} / {pages} ページ
      </span>
      <button
        type="button"
        onClick={() => onChange(offset + pageSize)}
        disabled={offset + pageSize >= total}
        className="btn-secondary btn-sm"
      >
        次の {pageSize} 件 →
      </button>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  /** スクリーンリーダー向けの名前 */
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5"
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`text-xs px-3 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
            value === v
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function CsvDropzone({
  busy,
  onFile,
  accept = ".csv",
  hint = "CSV ファイル (.csv) に対応",
}: {
  busy: boolean;
  onFile: (file: File) => void;
  accept?: string;
  hint?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      onClick={() => fileRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
      }}
      className={`card cursor-pointer border-2 border-dashed transition-colors text-center py-12 ${
        dragOver
          ? "border-indigo-400 bg-indigo-50"
          : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
      }`}
    >
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      {busy ? (
        <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
          <span className="w-5 h-5 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
          インポート中…
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-3xl" aria-hidden="true">
            📂
          </p>
          <p className="text-sm font-medium text-slate-700">
            クリックしてファイルを選択 または ドラッグ＆ドロップ
          </p>
          <p className="text-xs text-slate-400">{hint}</p>
        </div>
      )}
    </div>
  );
}
