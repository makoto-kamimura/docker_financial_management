"use client";

// 月のカレンダー（予算・現金・銀行・カードのカレンダーで共用）。
// 月の移動・月の合計の帯・曜日の行・日のマス（今日の印・選んだ日の強調・土日の色）をここにまとめ、
// マスの中身（その日の収入・支出など）と、選んだ日の一覧・登録フォームは呼び出し側が持つ。

import type { ReactNode } from "react";
import { yen } from "@/lib/format";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 月の 1 日の曜日・日数・マスの数（6 週に満たない月は必要な週だけ） */
export function monthGrid(year: number, month: number) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return { firstWeekday, daysInMonth, totalCells };
}

/** year・month を delta か月動かした年月 */
export function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function Arrow({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d={
          dir === "prev"
            ? "M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
            : "M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
        }
        clipRule="evenodd"
      />
    </svg>
  );
}

export function MonthCalendar({
  year,
  month,
  onMove,
  titleExtra,
  summary,
  loading = false,
  selectedDay,
  onSelectDay,
  renderDay,
}: {
  year: number;
  month: number;
  /** 前月（-1）・翌月（+1）へ */
  onMove: (delta: -1 | 1) => void;
  /** 年月の横に出す印（「確定済み」など） */
  titleExtra?: ReactNode;
  /** 年月の下に出す月の合計の帯（CalendarTotals） */
  summary?: ReactNode;
  loading?: boolean;
  selectedDay: number | null;
  onSelectDay: (day: number) => void;
  /** 日のマスの中身（日付の下に出す） */
  renderDay?: (day: number) => ReactNode;
}) {
  const now = new Date();
  const { firstWeekday, daysInMonth, totalCells } = monthGrid(year, month);
  const isThisMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  return (
    <div className="card w-full lg:flex-1 min-w-0 p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <button
          type="button"
          onClick={() => onMove(-1)}
          aria-label="前の月"
          className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
        >
          <Arrow dir="prev" />
        </button>
        <span className="font-semibold text-slate-800">
          {year}年{month}月{titleExtra}
        </span>
        <button
          type="button"
          onClick={() => onMove(1)}
          aria-label="次の月"
          className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
        >
          <Arrow dir="next" />
        </button>
      </div>
      {summary}
      <div className="grid grid-cols-7 border-b border-slate-100">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-2 text-center text-xs font-medium ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-slate-500"}`}
          >
            {w}
          </div>
        ))}
      </div>
      {loading ? (
        <p className="p-8 text-center text-sm text-slate-400">読み込み中…</p>
      ) : (
        <div className="grid grid-cols-7">
          {Array.from({ length: totalCells }, (_, i) => {
            const day = i - firstWeekday + 1;
            const isValid = day >= 1 && day <= daysInMonth;
            const isToday = isValid && isThisMonth && day === now.getDate();
            const weekday = i % 7;
            return (
              <button
                key={i}
                type="button"
                disabled={!isValid}
                onClick={() => isValid && onSelectDay(day)}
                aria-pressed={isValid ? day === selectedDay : undefined}
                aria-label={isValid ? `${month}月${day}日` : undefined}
                className={[
                  "min-h-[4.5rem] p-1.5 border-b border-r border-slate-100 text-left transition-colors",
                  !isValid ? "bg-slate-50/50" : "hover:bg-indigo-50/50 cursor-pointer",
                  isValid && day === selectedDay
                    ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300"
                    : "",
                ].join(" ")}
              >
                {isValid && (
                  <>
                    <span
                      className={[
                        "inline-flex items-center justify-center w-6 h-6 text-xs font-medium rounded-full mb-0.5",
                        isToday
                          ? "bg-indigo-600 text-white"
                          : weekday === 0
                            ? "text-red-500"
                            : weekday === 6
                              ? "text-blue-500"
                              : "text-slate-700",
                      ].join(" ")}
                    >
                      {day}
                    </span>
                    {renderDay?.(day)}
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 月の合計の帯（収入・支出・差引など）。tone: in は緑、out は赤、net は差引（負なら赤） */
export function CalendarTotals({
  items,
  note,
}: {
  items: { label: string; value: number; tone: "in" | "out" | "net" }[];
  /** 右端に出す件数など */
  note?: ReactNode;
}) {
  const color = (tone: "in" | "out" | "net", v: number) =>
    tone === "in"
      ? "text-emerald-600"
      : tone === "out"
        ? "text-rose-600"
        : v < 0
          ? "text-red-600"
          : "text-indigo-600";
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
      {items.map((it) => (
        <span key={it.label} className="text-xs text-slate-500">
          {it.label}{" "}
          <span className={`text-sm font-semibold tabular-nums ${color(it.tone, it.value)}`}>
            {yen(it.value)}
          </span>
        </span>
      ))}
      {note && <span className="text-xs text-slate-400 ml-auto">{note}</span>}
    </div>
  );
}

/** マスの中の、その日の入金（+）と出金（−）の合計。0 の側は出さない */
export function DayAmounts({ income, expense }: { income: number; expense: number }) {
  return (
    <>
      {income > 0 && (
        <p className="text-[10px] text-emerald-600 truncate leading-tight">+{yen(income)}</p>
      )}
      {expense > 0 && (
        <p className="text-[10px] text-rose-600 truncate leading-tight">−{yen(expense)}</p>
      )}
    </>
  );
}
