"use client";

// 控除・確定申告のページの入力部品。金額は円の整数で、空欄は 0（上書きの欄は「帳簿の値を使う」）。

import { useId, type ReactNode } from "react";
import { yen } from "@/lib/common/format";

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function toNumber(raw: string): number | null {
  const digits = raw.replace(/[^\d-]/g, "");
  if (digits === "" || digits === "-") return null;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function YenInput({
  value,
  onChange,
  placeholder,
  allowNegative = false,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  allowNegative?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        className="input-field pr-8 text-right tabular-nums"
        value={value === null ? "" : value.toLocaleString("ja-JP")}
        placeholder={placeholder}
        onChange={(e) => {
          const n = toNumber(e.target.value);
          onChange(n === null ? null : allowNegative ? n : Math.max(0, n));
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
        円
      </span>
    </div>
  );
}

/** 手入力だけの金額（空欄は 0） */
export function AmountField({
  label,
  value,
  onChange,
  hint,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      <YenInput value={value || null} placeholder="0" onChange={(v) => onChange(v ?? 0)} />
    </Field>
  );
}

/** 帳簿の値を下書きにして、上書きできる金額（null は帳簿の値を使う） */
export function LedgerAmountField({
  label,
  value,
  ledger,
  onChange,
  hint,
  allowNegative = false,
}: {
  label: ReactNode;
  value: number | null;
  ledger: number | null;
  onChange: (v: number | null) => void;
  hint?: ReactNode;
  allowNegative?: boolean;
}) {
  return (
    <Field
      label={label}
      hint={
        <>
          {value === null ? (
            <span>帳簿の値を使っています</span>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="badge badge-amber">手入力</span>
              {ledger !== null && <span>帳簿: {yen(ledger)}</span>}
              <button
                type="button"
                className="text-indigo-600 hover:underline"
                onClick={() => onChange(null)}
              >
                帳簿の値に戻す
              </button>
            </span>
          )}
          {hint && <span className="block">{hint}</span>}
        </>
      }
    >
      <YenInput
        value={value}
        placeholder={ledger === null ? "0" : ledger.toLocaleString("ja-JP")}
        onChange={onChange}
        allowNegative={allowNegative}
      />
    </Field>
  );
}

export function Check({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="text-sm text-slate-700">
        {label}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </label>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: ReactNode;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <select className="input-field" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** 所得税・住民税の 2 つの額を並べる */
export function TwoAmounts({ income, resident }: { income: number; resident: number }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <div className="flex gap-2">
        <dt className="text-slate-500">所得税</dt>
        <dd className="font-semibold tabular-nums text-slate-900">{yen(income)}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-slate-500">住民税</dt>
        <dd className="font-semibold tabular-nums text-slate-900">{yen(resident)}</dd>
      </div>
    </dl>
  );
}

/** 数字を大きく出すカード（概要・ふるさと納税） */
export function StatTile({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: "slate" | "green" | "red" | "indigo";
}) {
  const color = {
    slate: "text-slate-900",
    green: "text-green-700",
    red: "text-red-700",
    indigo: "text-indigo-700",
  }[tone];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
