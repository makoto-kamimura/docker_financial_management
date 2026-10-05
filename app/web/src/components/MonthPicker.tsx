"use client";

// 月（1〜12）を選ぶボタンの列。年は左のメニューの対象年度で決まり、ここでは月だけを選ぶ。
// ダッシュボードの KPI・予実差確認・予算の確定・実績の確定で共用する。

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function MonthPicker({
  year,
  month,
  onChange,
  label = "対象月",
  isAvailable,
  unavailableTitle,
}: {
  year: number;
  /** 選択中の月。未定（読み込み中）なら null */
  month: number | null;
  onChange: (month: number) => void;
  /** ボタン列の名前（画面に「{label}（{year}年）」と出し、role=group の名前にも使う） */
  label?: string;
  /** 指定すると、false の月は押せなくする（データの無い月など） */
  isAvailable?: (month: number) => boolean;
  /** 押せない月のボタンに出す説明 */
  unavailableTitle?: (month: number) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-xs font-medium text-slate-500">
        {label}（{year}年）:
      </span>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
        {MONTHS.map((m) => {
          const isSelected = m === month;
          const available = isAvailable ? isAvailable(m) : true;
          return (
            <button
              key={m}
              type="button"
              disabled={!available}
              aria-pressed={isSelected}
              title={available ? undefined : unavailableTitle?.(m)}
              onClick={() => onChange(m)}
              className={`text-xs w-11 py-1 rounded-md border font-medium transition-colors ${
                isSelected
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                  : available
                    ? "border-slate-300 bg-white text-slate-600 hover:bg-indigo-50 hover:border-indigo-300"
                    : "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
              }`}
            >
              {m}月
            </button>
          );
        })}
      </div>
    </div>
  );
}
