"use client";

// 実績管理の取り込み（銀行・カード）の「読み方を選ぶ」。自動で読めない・読み違えた明細の CSV について、
// 見出しの行と、列の役割（日付・摘要・金額・残高）を選ぶ。選んだ読み方で読んだ先頭の行を、その場で見せる。
// 読み方は、この口座・カードの同じ見出しの CSV に使える（覚えるかは取り込む前の確認で選ぶ）。
import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { Notice } from "@/components/ui";
import { ConversionPreview } from "@/components/entry/StatementImportConfirm";
import {
  convertStatement,
  headerCandidates,
  headerKey,
  mappingFor,
  StatementMappingSchema,
  type AmountStyle,
  type StatementMapping,
} from "@/lib/shared/statement-formats";

type Col = number | null;

type Roles = {
  /** 日付の列（年・月・日が別の列なら年の列） */
  date: Col;
  /** 年・月・日が別の列 */
  dateSplit: boolean;
  dateMonth: Col;
  dateDay: Col;
  desc1: Col;
  desc2: Col;
  style: AmountStyle;
  withdrawal: Col;
  deposit: Col;
  usage: Col;
  signed: Col;
  kind: Col;
  balance: Col;
};

const STYLE_OPTIONS: [AmountStyle, string][] = [
  ["split", "出金と入金が別の列"],
  ["usage", "利用金額の列（カード。利用を支出にする）"],
  ["signed", "入金が正・出金が負の金額の列"],
  ["typed", "符号の無い金額の列と、入金か出金かの区分の列"],
];

function rolesOf(m: StatementMapping | null): Roles {
  const style: AmountStyle = !m
    ? "split"
    : m.withdrawal !== null || m.deposit !== null
      ? "split"
      : m.usage !== null
        ? "usage"
        : m.kind !== null
          ? "typed"
          : "signed";
  return {
    date: m?.date ?? null,
    dateSplit: (m?.dateMonth ?? null) !== null,
    dateMonth: m?.dateMonth ?? null,
    dateDay: m?.dateDay ?? null,
    desc1: m?.description[0] ?? null,
    desc2: m?.description[1] ?? null,
    style,
    withdrawal: m?.withdrawal ?? null,
    deposit: m?.deposit ?? null,
    usage: m?.usage ?? null,
    signed: m?.signed ?? null,
    kind: m?.kind ?? null,
    balance: m?.balance ?? null,
  };
}

/** 選んだ役割から読み方を作る（金額の読み方に使わない列は外す）。日付（年・月・日）の列がそろわなければ null */
function buildMapping(cells: string[], r: Roles): StatementMapping | null {
  if (r.date === null) return null;
  if (r.dateSplit && (r.dateMonth === null || r.dateDay === null)) return null;
  return mappingFor(cells, {
    date: r.date,
    ...(r.dateSplit ? { dateMonth: r.dateMonth, dateDay: r.dateDay } : {}),
    description: [r.desc1, r.desc2].filter((c): c is number => c !== null),
    withdrawal: r.style === "split" ? r.withdrawal : null,
    deposit: r.style === "split" ? r.deposit : null,
    usage: r.style === "usage" ? r.usage : null,
    signed: r.style === "signed" || r.style === "typed" ? r.signed : null,
    kind: r.style === "typed" ? r.kind : null,
    balance: r.balance,
  });
}

export function StatementMappingEditor({
  text,
  initial,
  note = null,
  onCancel,
  onApply,
}: {
  /** 読み込んだ CSV の中身 */
  text: string;
  /** 初めの読み方（自動で読めたとき・覚えた読み方があるとき） */
  initial: StatementMapping | null;
  /** 画面を開いた理由（自動で読めなかったときなど） */
  note?: string | null;
  onCancel: () => void;
  onApply: (mapping: StatementMapping) => void;
}) {
  const candidates = useMemo(() => headerCandidates(text), [text]);
  const initialRow = useMemo(() => {
    const key = (cells: string[]) => headerKey(cells).join("\u0000");
    const same = initial && candidates.find((c) => key(c.cells) === initial.header.join("\u0000"));
    if (same) return same.index;
    // 値のある列がいちばん多い最初の行を、見出しの行とみなす
    const width = (cells: string[]) => cells.filter((c) => c.trim() !== "").length;
    const widest = Math.max(0, ...candidates.map((c) => width(c.cells)));
    return candidates.find((c) => width(c.cells) === widest)?.index ?? 0;
  }, [candidates, initial]);

  const [rowIndex, setRowIndex] = useState(initialRow);
  const [roles, setRoles] = useState<Roles>(() => rolesOf(initial));
  const headerCells = candidates.find((c) => c.index === rowIndex)?.cells ?? [];
  // 末尾の空の列は選べない（読み方の見出しに入らないため）
  const columns = headerCells.slice(0, headerKey(headerCells).length);

  const mapping = buildMapping(headerCells, roles);
  const checked = mapping ? StatementMappingSchema.safeParse(mapping) : null;
  const problem = !mapping
    ? "日付の列を選んでください"
    : !checked?.success
      ? (checked?.error.issues[0]?.message ?? "読み方を確かめてください")
      : null;
  const conversion = !problem && mapping ? convertStatement(text, { mapping }) : null;

  const set = (patch: Partial<Roles>) => setRoles((r) => ({ ...r, ...patch }));
  const select = (
    label: string,
    role: keyof Omit<Roles, "style" | "dateSplit">,
    optional = true,
  ) => (
    <ColumnSelect
      label={label}
      columns={columns}
      value={roles[role]}
      onChange={(v) => set({ [role]: v })}
      optional={optional}
    />
  );

  return (
    <Modal size="md">
      <h2 className="text-lg font-bold text-slate-800 mb-1">読み方を選ぶ</h2>
      <p className="text-xs text-slate-500 mb-4">
        見出しの行と、それぞれの列の役割を選びます。選んだ読み方で読んだ明細を、下で確かめられます。
      </p>
      {note && (
        <Notice tone="warn" className="mb-4">
          {note}
        </Notice>
      )}
      <div className="space-y-2 mb-4">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="w-20 shrink-0">見出しの行</span>
          <select
            className="input-field text-xs flex-1 min-w-0"
            value={rowIndex}
            onChange={(e) => setRowIndex(Number(e.target.value))}
          >
            {candidates.map((c) => (
              <option key={c.index} value={c.index}>
                {c.index + 1} 行目:{" "}
                {c.cells
                  .map((x) => x.trim())
                  .join(", ")
                  .slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="w-20 shrink-0">日付の形</span>
          <select
            className="input-field text-xs flex-1 min-w-0"
            value={roles.dateSplit ? "split" : "single"}
            onChange={(e) => set({ dateSplit: e.target.value === "split" })}
          >
            <option value="single">1 つの列（2026/10/01 など）</option>
            <option value="split">年・月・日が別の列</option>
          </select>
        </label>
        {roles.dateSplit ? (
          <>
            {select("年", "date", false)}
            {select("月", "dateMonth", false)}
            {select("日", "dateDay", false)}
          </>
        ) : (
          select("日付", "date", false)
        )}
        {select("摘要", "desc1")}
        {select("摘要（2）", "desc2")}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="w-20 shrink-0">金額の形</span>
          <select
            className="input-field text-xs flex-1 min-w-0"
            value={roles.style}
            onChange={(e) => set({ style: e.target.value as AmountStyle })}
          >
            {STYLE_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {roles.style === "split" && (
          <>
            {select("出金", "withdrawal")}
            {select("入金", "deposit")}
          </>
        )}
        {roles.style === "usage" && select("利用金額", "usage", false)}
        {(roles.style === "signed" || roles.style === "typed") && select("金額", "signed", false)}
        {roles.style === "typed" && select("区分", "kind", false)}
        {select("残高", "balance")}
      </div>

      {problem ? (
        <Notice tone="warn" className="mb-4">
          {problem}
        </Notice>
      ) : conversion && conversion.rows.length > 0 ? (
        <ConversionPreview conversion={conversion} />
      ) : (
        <Notice tone="warn" className="mb-4">
          この読み方では、日付と金額のある行がありません。列を選び直してください。
        </Notice>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          キャンセル
        </button>
        <button
          type="button"
          disabled={!conversion || conversion.rows.length === 0}
          onClick={() => mapping && onApply(mapping)}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          この読み方で読む
        </button>
      </div>
    </Modal>
  );
}

/** 列を 1 つ選ぶ（見出しの行の列名を出す） */
function ColumnSelect({
  label,
  columns,
  value,
  onChange,
  optional,
}: {
  label: string;
  columns: string[];
  value: Col;
  onChange: (v: Col) => void;
  optional: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      <span className="w-20 shrink-0">{label}</span>
      <select
        className="input-field text-xs flex-1 min-w-0"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">{optional ? "（なし）" : "選んでください"}</option>
        {columns.map((name, i) => (
          <option key={i} value={i}>
            {i + 1} 列目: {name.trim() || "（空欄）"}
          </option>
        ))}
      </select>
    </label>
  );
}
