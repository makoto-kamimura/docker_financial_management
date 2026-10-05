// 対象年度（暦年。1〜12 月）。画面上部のサブヘッダー（App.tsx）で選び、どの画面も同じ年度を表示する
// （web 版の lib/use-fiscal-year.ts と同じ役割）。表示モードと同じくメモリ内で持つ。
import { useSyncExternalStore } from "react";

let _year = new Date().getFullYear();
const listeners = new Set<() => void>();

export function getFiscalYear() {
  return _year;
}

export function setFiscalYear(year: number) {
  if (year === _year) return;
  _year = year;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 対象年度。サブヘッダーで変えると、開いているどの画面にも反映される */
export function useFiscalYear() {
  return useSyncExternalStore(subscribe, getFiscalYear, getFiscalYear);
}
