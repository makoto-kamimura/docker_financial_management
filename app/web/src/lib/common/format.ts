// 金額の表示の共通部分。画面ごとに書いていた表示（「￥1,234」「¥1,234」「1,234円」など）を
// 「1,234円」にそろえる。モバイル（app/mobile/src/format.ts）も同じ見た目にする。
//   - yen: ふつうの金額。負の数は「−1,234円」
//   - yenAbs: 向きのある金額（入出金・差・増減）。符号は付けず絶対値で出し、向きはラベルと色で示す
//     （言葉は lib/shared/amount-direction.ts）
//   - yenNet: 差引・利益など。負のときは「赤字 1,234円」のように言葉を付ける
//   - yenShort: サマリ・グラフの軸のように幅の狭い所。1 万円以上は「12.3万円」
//   - amountText: 科目×月の表のように列の狭い表の中の数字だけ（見出しに「（円）」を書く）
// どれも円未満は四捨五入する。

import { netWord } from "@/lib/shared/amount-direction";

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

/** 絶対値の「1,234円」（向きはラベルと色で示す） */
export function yenAbs(v: number): string {
  return yen(Math.abs(v));
}

/** 差引・利益など。負のときは「−」の代わりに言葉を付ける（既定「赤字 1,234円」） */
export function yenNet(v: number, negative = "赤字"): string {
  const word = netWord(v, negative);
  return word ? `${word} ${yenAbs(v)}` : yen(v);
}

/** 1 万円以上は「12.3万円」（小数 1 桁）、それ未満は「1,234円」 */
export function yenShort(v: number): string {
  if (Math.abs(v) < 1_0000) return yen(v);
  const man = (Math.abs(v) / 1_0000).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
  return `${v < 0 ? MINUS : ""}${man}万円`;
}
