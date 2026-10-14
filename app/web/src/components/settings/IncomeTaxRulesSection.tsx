"use client";

// 設定の「税制設定」タブの、所得税・住民税の控除額などの値（年ごと）。
// 既定値（lib/shared/tax-rules.ts）から変えた項目だけを保存し、控除・確定申告のページの計算に使う。
// 既定値のない来年の分は、前年の値をコピーしてから改正された箇所だけ直す。

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SETTINGS_HELP } from "@/lib/shared/help-texts";
import {
  TAX_RULE_FIELDS,
  TAX_RULE_GROUPS,
  getRuleValue,
  validateRuleValue,
  type RuleColumn,
  type RuleField,
  type RuleUnit,
  type TaxRules,
} from "@/lib/shared/tax-rules";
import { Notice } from "@/components/ui";
import { SaveNotice, SectionCard, type SaveMessage } from "@/components/SectionCard";

type Payload = {
  year: number;
  defaults: TaxRules;
  rules: TaxRules;
  baseYear: number;
  fallback: boolean;
  changed: string[];
  defaultYears: number[];
  overrideYears: number[];
};

type Row = Record<string, number | null>;
type Values = Record<string, unknown>;

function valuesOf(rules: TaxRules): Values {
  return Object.fromEntries(TAX_RULE_FIELDS.map((f) => [f.path, getRuleValue(rules, f.path)]));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function IncomeTaxRulesSection() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Payload | null>(null);
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<SaveMessage>(null);

  const apply = useCallback((p: Payload) => {
    setData(p);
    setValues(valuesOf(p.rules));
  }, []);

  useEffect(() => {
    setMsg(null);
    fetch(`/api/tax-rules?year=${year}`)
      .then((r) => r.json())
      .then(({ data }) => data && apply(data));
  }, [year, apply]);

  async function send(input: RequestInfo, init: RequestInit, done: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(input, init);
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      apply(json.data);
      setMsg({ ok: true, text: done });
    } else {
      setMsg({ ok: false, text: json.error ?? "保存に失敗しました" });
    }
  }

  const errors = TAX_RULE_FIELDS.map(
    (f) => [f, validateRuleValue(f.path, values[f.path])] as const,
  ).filter(([, e]) => e !== null);
  const hasDefaults = data?.defaultYears.includes(year) ?? true;
  const dirty = !!data && !same(values, valuesOf(data.rules));
  const yearOptions = [
    ...new Set([
      ...(data?.defaultYears ?? []),
      ...(data?.overrideYears ?? []),
      new Date().getFullYear() + 1,
      year,
    ]),
  ].sort((a, b) => a - b);

  return (
    <SectionCard
      title="所得税・住民税の控除額"
      lead={SETTINGS_HELP.incomeTaxRules}
      actions={
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || busy || errors.length > 0}
          onClick={() =>
            send(
              "/api/tax-rules",
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ year, values }),
              },
              "保存しました",
            )
          }
        >
          {busy ? "保存中…" : "保存"}
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">所得の年</span>
          <select
            className="input-field mt-1"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y} 年分
                {data?.overrideYears.includes(y) ? "（変更あり）" : ""}
              </option>
            ))}
          </select>
        </label>
        {!hasDefaults && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() =>
              send(
                "/api/tax-rules/copy",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ year }),
                },
                `${year - 1} 年分の値をコピーしました`,
              )
            }
          >
            {year - 1} 年分の値をコピーして作る
          </button>
        )}
        {data && data.overrideYears.includes(year) && (
          <button
            type="button"
            className="btn-outline-danger"
            disabled={busy}
            onClick={() =>
              confirm(`${year} 年分の変更をすべて消して既定値に戻しますか？`) &&
              send(`/api/tax-rules?year=${year}`, { method: "DELETE" }, "既定値に戻しました")
            }
          >
            この年を既定値に戻す
          </button>
        )}
      </div>

      {data?.fallback && (
        <Notice tone="warn" className="mb-4">
          {year} 年分の既定値はまだ用意していないため、{data.baseYear}{" "}
          年分の値を出しています。改正があった場合は「
          {year - 1}{" "}
          年分の値をコピーして作る」を押してから、変わった箇所だけ直して保存してください。
        </Notice>
      )}
      {data && data.changed.length > 0 && (
        <p className="mb-4 text-sm text-slate-600">
          既定値から変えた項目: {data.changed.length} 件
        </p>
      )}

      {data &&
        TAX_RULE_GROUPS.map((group) => {
          const fields = TAX_RULE_FIELDS.filter((f) => f.group === group);
          const changedCount = fields.filter(
            (f) => !same(values[f.path], getRuleValue(data.defaults, f.path)),
          ).length;
          return (
            <details key={group} className="mb-3 rounded-lg border border-slate-200">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-800">
                {group}
                {changedCount > 0 && (
                  <span className="badge badge-amber ml-2">変更 {changedCount}</span>
                )}
              </summary>
              <div className="space-y-5 border-t border-slate-100 px-4 py-4">
                {fields.map((f) => (
                  <FieldEditor
                    key={f.path}
                    field={f}
                    value={values[f.path]}
                    defaultValue={getRuleValue(data.defaults, f.path)}
                    error={validateRuleValue(f.path, values[f.path])}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.path]: v }))}
                  />
                ))}
              </div>
            </details>
          );
        })}
      <SaveNotice msg={msg} />
    </SectionCard>
  );
}

function FieldEditor({
  field,
  value,
  defaultValue,
  error,
  onChange,
}: {
  field: RuleField;
  value: unknown;
  defaultValue: unknown;
  error: string | null;
  onChange: (v: unknown) => void;
}) {
  const changed = !same(value, defaultValue);
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-700">{field.label}</span>
        {changed && (
          <>
            <span className="badge badge-amber">変更あり</span>
            <button
              type="button"
              className="text-xs text-indigo-600 hover:underline"
              onClick={() => onChange(JSON.parse(JSON.stringify(defaultValue)))}
            >
              既定値に戻す
            </button>
          </>
        )}
      </div>
      {field.note && <p className="mb-1 text-xs text-slate-500">{field.note}</p>}
      {field.kind === "value" ? (
        <div className="max-w-xs">
          <NumberInput
            unit={field.unit}
            value={value as number}
            onChange={(v) => onChange(v ?? 0)}
          />
        </div>
      ) : (
        <TableEditor columns={field.columns} rows={(value as Row[]) ?? []} onChange={onChange} />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const UNIT_SUFFIX: Record<RuleUnit, string> = {
  yen: "円",
  rate: "%",
  years: "年",
  count: "",
  year: "年",
};

function NumberInput({
  unit,
  value,
  onChange,
  nullable = false,
}: {
  unit: RuleUnit;
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
}) {
  // 率は % で見せて、保存は 0〜1 の小数
  const shown =
    value === null ? "" : unit === "rate" ? String(Math.round(value * 1e6) / 1e4) : String(value);
  return (
    <div className="relative">
      <input
        type="number"
        className="input-field pr-8 text-right tabular-nums"
        step={unit === "rate" ? "0.001" : "1"}
        value={shown}
        placeholder={nullable ? "上限なし" : "0"}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(nullable ? null : 0);
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(unit === "rate" ? Math.round(n * 1e4) / 1e6 : n);
        }}
      />
      {UNIT_SUFFIX[unit] && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
          {UNIT_SUFFIX[unit]}
        </span>
      )}
    </div>
  );
}

function TableEditor({
  columns,
  rows,
  onChange,
}: {
  columns: RuleColumn[];
  rows: Row[];
  onChange: (rows: Row[]) => void;
}) {
  const setCell = (i: number, key: string, v: number | null) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const blank = (): Row => Object.fromEntries(columns.map((c) => [c.key, c.nullable ? null : 0]));
  return (
    <div className="table-scroll">
      <table className="text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            {columns.map((c) => (
              <th key={c.key} className="px-1 pb-1 text-left font-medium">
                {c.label}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className="min-w-[8rem] px-1 py-0.5">
                  <NumberInput
                    unit={c.unit}
                    value={r[c.key] ?? null}
                    nullable={c.nullable}
                    onChange={(v) => setCell(i, c.key, v)}
                  />
                </td>
              ))}
              <td className="px-1">
                <button
                  type="button"
                  aria-label="この行を消す"
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn-secondary btn-sm mt-2"
        onClick={() => {
          // 上限なし（null）の行は最後に置くので、その前に足す
          const last = rows[rows.length - 1];
          const openEnded = last && columns.some((c) => c.nullable && last[c.key] === null);
          onChange(openEnded ? [...rows.slice(0, -1), blank(), last] : [...rows, blank()]);
        }}
      >
        <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
        行を足す
      </button>
    </div>
  );
}
