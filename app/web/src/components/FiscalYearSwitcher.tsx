"use client";

// 対象年度の切替（左のメニューとモバイル幅のヘッダーに置く）。
// 選んだ年度は use-fiscal-year.ts で全画面に伝わる。候補は予算か実績のある年と今年。

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { setFiscalYear, useFiscalYear } from "@/lib/client/use-fiscal-year";

export function FiscalYearSwitcher({ compact = false }: { compact?: boolean }) {
  const year = useFiscalYear();
  const [years, setYears] = useState<number[]>([]);

  useEffect(() => {
    fetch("/api/periods/years")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setYears(j.data ?? []))
      .catch(() => setYears([]));
  }, []);

  // 候補に今の年度が無くても選べるようにする（前後の年へ移ったとき）
  const options = [...new Set([...years, year])].sort((a, b) => b - a);
  const btn =
    "p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div
      className={`flex items-center gap-1 ${compact ? "" : "rounded-lg border border-slate-600 px-1 py-0.5"}`}
      role="group"
      aria-label="対象年度"
    >
      <button
        type="button"
        className={btn}
        onClick={() => setFiscalYear(year - 1)}
        aria-label="前の年度"
      >
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <select
        aria-label="対象年度を選ぶ"
        value={year}
        onChange={(e) => setFiscalYear(Number(e.target.value))}
        className={`flex-1 bg-transparent text-white font-semibold text-center focus:outline-none cursor-pointer ${compact ? "text-[11px]" : "text-xs"}`}
      >
        {options.map((y) => (
          <option key={y} value={y} className="text-slate-900">
            {y}年
          </option>
        ))}
      </select>
      <button
        type="button"
        className={btn}
        onClick={() => setFiscalYear(year + 1)}
        aria-label="次の年度"
      >
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
