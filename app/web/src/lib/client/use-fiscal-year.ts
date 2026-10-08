"use client";

import { useEffect, useState } from "react";

// 対象年度（暦年。1〜12 月）。左のメニュー（AppShell）で選び、どの画面も同じ年度を表示する。
// 表示モード（use-view-mode.ts）と同じく、AppShell が localStorage への保存と
// "fiscalyear-change" イベントの発火を担当し、各画面はこのフックで購読するだけでよい。
// 期の集計（KPI の当期累計など）は tenants.closingMonth で別に扱う。

const STORAGE_KEY = "fiscalYear";
const EVENT = "fiscalyear-change";

export const currentCalendarYear = () => new Date().getFullYear();

function readStoredYear(): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(v) && v >= 2000 && v <= 2100 ? v : null;
  } catch {
    return null;
  }
}

/** 対象年度を変える（AppShell の年度切替から呼ぶ） */
export function setFiscalYear(year: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(year));
  } catch {
    // 保存できなくても、この画面の表示には反映する
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: year }));
}

/** 対象年度。既定は今年。左のメニューで変えると、開いているどの画面にも反映される */
export function useFiscalYear(): number {
  const [year, setYear] = useState<number>(currentCalendarYear);

  useEffect(() => {
    const stored = readStoredYear();
    if (stored) setYear(stored);

    const handler = (e: Event) => {
      const next = (e as CustomEvent<number>).detail ?? readStoredYear();
      if (next) setYear(next);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  return year;
}
