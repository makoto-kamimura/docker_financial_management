"use client";

// 予算管理と実績管理の「一覧」タブで共用する、科目 × 月（1〜12 月）の表。
// 並び（区分の順 → 科目コード）・区分のバッジ・月ごとの合計の行・確定済みの月の鍵・
// セルでの追加／編集／削除・「科目を追加」の行・エラーの表示をここで一か所にまとめる。
// onAdd・onSave・onDelete を渡さなければ見るだけの表になる（実績は明細から入るため、実績管理は見るだけ）。
// 予算・実績それぞれの追加表示（ローン返済・適正額、N 件の内訳・仕訳と連動など）は
// getCell / emptyCellLabel で呼び出し側が渡す。

import { useState, type ReactNode } from "react";
import { Check, Lock, Pencil, Trash2 } from "lucide-react";
import { useMonthColumnScroll } from "@/hooks/useMonthColumnScroll";
import { displayName, type ViewMode } from "@/lib/display-name";
import { CATEGORY_LABEL, categoryRank } from "@/lib/labels";

export type MatrixAccount = {
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};

export type MatrixCell = {
  /** 表示する金額（自動反映などを含めた合計） */
  amount: number;
  /** その場で編集・削除できる行の ID と元の金額。null ならその場では直せない */
  editable: { id: number; amount: number } | null;
  /** 金額の右に出す印（「N件」「仕訳」など。編集・削除のボタンの代わり） */
  action?: ReactNode;
  /** 金額の下に出す補足（「内 ローン返済」「適正」など） */
  extras?: ReactNode;
};

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const now = new Date();

export const CATEGORY_BADGE: Record<string, string> = {
  REVENUE: "bg-blue-50 text-blue-700",
  COGS: "bg-orange-50 text-orange-700",
  EXPENSE: "bg-amber-50 text-amber-700",
  PROFIT: "bg-green-50 text-green-700",
  ASSET: "bg-emerald-50 text-emerald-700",
  LIABILITY: "bg-rose-50 text-rose-700",
  OTHER: "bg-slate-100 text-slate-600",
};

const yen = (v: number) => Math.round(v).toLocaleString("ja-JP");
const INCOME = new Set(["REVENUE"]);
const SPENDING = new Set(["COGS", "EXPENSE"]);

export function AccountMonthMatrix({
  mode,
  year,
  noun,
  rows,
  allAccounts,
  getCell,
  emptyCellLabel,
  rowBadges,
  lockedMonths,
  lockedTitle,
  legend,
  onAdd,
  onSave,
  onDelete,
}: {
  mode: ViewMode;
  year: number;
  /** 「予算」「実績」。ボタンの説明やメッセージに使う */
  noun: string;
  /** 表に出す科目（値のある科目など）。並べ替えはこの中で行う */
  rows: MatrixAccount[];
  /** 「科目を追加」で選べる科目の全体 */
  allAccounts: MatrixAccount[];
  getCell: (code: string, month: number) => MatrixCell | null;
  /** 値の無いセルの「—」の代わりに出すもの（適正額など）。押すと追加になる */
  emptyCellLabel?: (code: string, month: number) => ReactNode;
  /** 科目名の右に出す印（自動反映など） */
  rowBadges?: (code: string) => ReactNode;
  lockedMonths: Set<number>;
  lockedTitle: (month: number) => string;
  /** 表の上に出す印の見かた */
  legend?: ReactNode;
  /** 失敗したらメッセージを返す（成功なら null）。3 つとも省くと見るだけの表になる */
  onAdd?: (code: string, month: number, amount: number) => Promise<string | null>;
  onSave?: (id: number, amount: number) => Promise<string | null>;
  onDelete?: (id: number) => Promise<string | null>;
}) {
  const [edit, setEdit] = useState<{ id: number; amount: string } | null>(null);
  const [add, setAdd] = useState<{ code: string; month: number; amount: string } | null>(null);
  const [extraCodes, setExtraCodes] = useState<string[]>([]);
  const [addRowCode, setAddRowCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 当月の列を左端に寄せて開く（今年以外を表示中は 1 月始まりのまま）
  const scrollRef = useMonthColumnScroll(year === now.getFullYear() ? now.getMonth() + 1 : null);

  const extraRows = allAccounts.filter(
    (a) => extraCodes.includes(a.code) && !rows.some((r) => r.code === a.code),
  );
  const sorted = [...rows, ...extraRows].sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category) || a.code.localeCompare(b.code),
  );
  const addable = allAccounts.filter((a) => !sorted.some((r) => r.code === a.code));

  async function run(p: Promise<string | null>, done: () => void) {
    setError(null);
    const message = await p;
    if (message) setError(message);
    else done();
  }
  const readOnly = !onAdd || !onSave || !onDelete;
  const saveEdit = () =>
    edit && onSave && run(onSave(edit.id, Number(edit.amount)), () => setEdit(null));
  const saveAdd = () =>
    add &&
    add.amount !== "" &&
    onAdd &&
    run(onAdd(add.code, add.month, Number(add.amount)), () => setAdd(null));

  // 月ごとの合計（収入・支出・差引）
  const totals = MONTHS.map((m) => {
    let income = 0;
    let spending = 0;
    for (const a of sorted) {
      const v = getCell(a.code, m)?.amount ?? 0;
      if (INCOME.has(a.category)) income += v;
      else if (SPENDING.has(a.category)) spending += v;
    }
    return { income, spending };
  });
  const sum = (f: (t: { income: number; spending: number }) => number) =>
    totals.reduce((s, t) => s + f(t), 0);

  const editor = (
    value: string,
    onChange: (v: string) => void,
    onOk: () => void,
    onCancel: () => void,
    label: string,
  ) => (
    <div className="flex items-center gap-1 justify-end">
      <input
        type="number"
        value={value}
        placeholder="金額"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOk();
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
        aria-label={label}
        className="w-24 text-right text-xs border border-indigo-400 rounded px-1 py-0.5"
      />
      <button
        type="button"
        aria-label="保存"
        title="保存"
        onClick={onOk}
        className="text-indigo-600 hover:text-indigo-700"
      >
        <Check className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );

  const totalRow = (label: string, values: number[], total: number, tone?: boolean) => (
    <tr className="bg-slate-50 text-xs">
      <td className="sticky left-0 bg-slate-50 px-4 py-2 font-semibold text-slate-600">{label}</td>
      {values.map((v, i) => (
        <td
          key={i}
          className={`px-3 py-2 text-right tabular-nums font-medium ${tone && v < 0 ? "text-red-600" : "text-slate-700"}`}
        >
          {v === 0 ? "—" : yen(v)}
        </td>
      ))}
      <td
        className={`px-3 py-2 text-right tabular-nums font-semibold ${tone && total < 0 ? "text-red-600" : "text-slate-800"}`}
      >
        {total === 0 ? "—" : yen(total)}
      </td>
    </tr>
  );

  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}
      <div className="card overflow-hidden p-0">
        {legend}
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="sticky left-0 bg-slate-50 px-4 py-3 text-left text-xs font-semibold text-slate-600 min-w-44">
                  勘定科目
                </th>
                {MONTHS.map((m) => (
                  <th
                    key={m}
                    data-month={m}
                    className="px-3 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap min-w-24"
                  >
                    {lockedMonths.has(m) ? (
                      <span
                        className="inline-flex items-center gap-1 text-emerald-700"
                        title={lockedTitle(m)}
                      >
                        <Lock className="w-3 h-3" aria-hidden="true" />
                        {m}月
                      </span>
                    ) : (
                      `${m}月`
                    )}
                  </th>
                ))}
                <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 min-w-28">
                  年間合計
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((acct) => {
                const annual = MONTHS.reduce((s, m) => s + (getCell(acct.code, m)?.amount ?? 0), 0);
                return (
                  <tr key={acct.code} className="hover:bg-slate-50 group">
                    <td className="sticky left-0 bg-white group-hover:bg-slate-50 px-4 py-2 font-medium">
                      <span className="text-xs font-mono text-slate-400 mr-1.5">{acct.code}</span>
                      <span className="text-slate-800">{displayName(acct, mode)}</span>
                      <span
                        className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${CATEGORY_BADGE[acct.category] ?? ""}`}
                      >
                        {CATEGORY_LABEL[acct.category] ?? acct.category}
                      </span>
                      {rowBadges?.(acct.code)}
                    </td>
                    {MONTHS.map((m) => {
                      const cell = getCell(acct.code, m);
                      const locked = lockedMonths.has(m);
                      const editing = cell?.editable && edit?.id === cell.editable.id ? edit : null;
                      const adding = add && add.code === acct.code && add.month === m ? add : null;
                      return (
                        <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                          {editing ? (
                            editor(
                              editing.amount,
                              (v) => setEdit({ ...editing, amount: v }),
                              saveEdit,
                              () => setEdit(null),
                              `${acct.code} の ${m}月の${noun}`,
                            )
                          ) : cell ? (
                            <div>
                              <div className="flex items-center justify-end gap-1 group/cell">
                                <span>{yen(cell.amount)}</span>
                                {cell.action ??
                                  (cell.editable && !locked && onDelete && (
                                    <>
                                      <button
                                        type="button"
                                        aria-label={`この${noun}を編集`}
                                        title="編集"
                                        onClick={() =>
                                          setEdit({
                                            id: cell.editable!.id,
                                            amount: String(cell.editable!.amount),
                                          })
                                        }
                                        className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover/cell:opacity-100"
                                      >
                                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`この${noun}を削除`}
                                        title="削除"
                                        onClick={() => run(onDelete(cell.editable!.id), () => {})}
                                        className="text-slate-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                      </button>
                                    </>
                                  ))}
                              </div>
                              {cell.extras}
                            </div>
                          ) : adding ? (
                            editor(
                              adding.amount,
                              (v) => setAdd({ ...adding, amount: v }),
                              saveAdd,
                              () => setAdd(null),
                              `${acct.code} の ${m}月の${noun}`,
                            )
                          ) : locked ? (
                            <span className="text-slate-300" title={lockedTitle(m)}>
                              —
                            </span>
                          ) : readOnly ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAdd({ code: acct.code, month: m, amount: "" })}
                              title={`${acct.code} の ${m}月に${noun}を追加`}
                              className="text-slate-300 hover:text-indigo-500"
                            >
                              {emptyCellLabel?.(acct.code, m) ?? "—"}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-700">
                      {annual === 0 ? "—" : yen(annual)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-200">
              {totalRow(
                "収入計",
                totals.map((t) => t.income),
                sum((t) => t.income),
              )}
              {totalRow(
                "支出計",
                totals.map((t) => t.spending),
                sum((t) => t.spending),
              )}
              {totalRow(
                "差引",
                totals.map((t) => t.income - t.spending),
                sum((t) => t.income - t.spending),
                true,
              )}
            </tfoot>
          </table>
        </div>
        {/* 値がまだ無い科目を行として足す（見るだけの表では出さない） */}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-100">
            <label htmlFor="matrix-add-row" className="text-xs font-medium text-slate-600">
              科目を追加
            </label>
            <select
              id="matrix-add-row"
              value={addRowCode}
              onChange={(e) => setAddRowCode(e.target.value)}
              className="select-sm max-w-64"
            >
              <option value="">選択してください</option>
              {addable.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} {displayName(a, mode)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={addRowCode === ""}
              onClick={() => {
                setExtraCodes((codes) =>
                  codes.includes(addRowCode) ? codes : [...codes, addRowCode],
                );
                setAddRowCode("");
              }}
              className="btn-secondary btn-sm"
            >
              行を追加
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
