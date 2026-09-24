// 画面共通の書式。web 版の表示（toLocaleString("ja-JP")）とそろえる。

/** ¥1,234,567（web 版の円表示と同じ） */
export const yen = (v: number) => `¥${Math.round(v).toLocaleString("ja-JP")}`;

/** 1,234,567円 */
export const yenJa = (v: number) => `${Math.round(v).toLocaleString("ja-JP")}円`;

/** 画面幅が狭いカード用の短縮表記（1 万円以上は「◯万円」） */
export const yenShort = (v: number) =>
  Math.abs(v) >= 10_000
    ? `${(v / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`
    : `${Math.round(v).toLocaleString("ja-JP")}円`;

/** 2026/07/01 09:30 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 2026/07/01 */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/** "2026-07" → "2026年7月" */
export const periodLabel = (key: string) => `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`;

/** YYYY-MM-DD（ローカル日付） */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 数字以外を取り除く（金額入力欄用）。allowMinus で先頭の - を残す */
export function digitsOnly(text: string, allowMinus = false): string {
  const minus = allowMinus && text.trim().startsWith("-") ? "-" : "";
  return minus + text.replace(/[^0-9]/g, "");
}

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
