// 金額の表示の共通部分。画面ごとに書いていた表示（「￥1,234」「¥1,234」「1,234円」など）を
// 「1,234円」にそろえる。モバイル（app/mobile/src/format.ts）も同じ見た目にする。
//   - yen: ふつうの金額。負の数は「−1,234円」
//   - yenSigned: 入出金・差のように向きのある金額。「+1,234円」「−1,234円」（0 は「0円」）
//   - yenShort: サマリ・グラフの軸のように幅の狭い所。1 万円以上は「12.3万円」
//   - amountText: 科目×月の表のように列の狭い表の中の数字だけ（見出しに「（円）」を書く）
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
