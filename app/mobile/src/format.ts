// 画面共通の書式。金額は web 版（app/web/src/lib/common/format.ts）と同じく「1,234円」にそろえる。
//   - yen: ふつうの金額。負の数は「−1,234円」
//   - yenSigned: 入出金・差のように向きのある金額。「+1,234円」「−1,234円」（0 は「0円」）
//   - yenShort: 幅の狭いカード・グラフ。1 万円以上は「12.3万円」
//   - amountText: 表の中の数字だけ
// どれも円未満は四捨五入する。

const MINUS = "−";

/** 「1,234」（四捨五入。負の数は「−1,234」） */
export function amountText(v: number): string {
  const n = Math.round(v);
  return `${n < 0 ? MINUS : ""}${Math.abs(n).toLocaleString("ja-JP")}`;
}

/** 「1,234円」 */
export function yen(v: number): string {
  return `${amountText(v)}円`;
}

/** 「+1,234円」「−1,234円」「0円」 */
export function yenSigned(v: number): string {
  const n = Math.round(v);
  return `${n > 0 ? "+" : ""}${yen(n)}`;
}

/** 1 万円以上は「12.3万円」（小数 1 桁）、それ未満は「1,234円」 */
export function yenShort(v: number): string {
  if (Math.abs(v) < 1_0000) return yen(v);
  const man = (Math.abs(v) / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
  return `${v < 0 ? MINUS : ""}${man}万円`;
}

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
