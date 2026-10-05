"use client";

// 画面の見出しの横に出す対象年度のバッジ。どの年度の内容を見ているか分かるようにする。
// 年度は左のメニュー（FiscalYearSwitcher）で変える。

import { CalendarDays } from "lucide-react";
import { useFiscalYear } from "@/lib/use-fiscal-year";

export function YearBadge({ year }: { year?: number }) {
  const current = useFiscalYear();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 whitespace-nowrap"
      title="対象年度は左のメニューで変えられます"
    >
      <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
      {year ?? current}年
    </span>
  );
}
