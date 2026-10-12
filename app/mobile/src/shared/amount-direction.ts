// 金額の向きの言葉。画面では金額に「+」「−」を付けず、絶対値に向きのラベルと色を添える
// （入ってくる向き＝緑、出ていく向き＝赤）。I/O を持たない純関数。
//
// モバイルと共有する（lib/shared/shared-with-mobile.ts）ため、他のファイルを import しない。

/** 明細・カレンダーの種類 */
export type FlowKind = "bank" | "cash" | "budget" | "card";

/** 金額の向き。in = 入ってくる（収入・入金・返金）、out = 出ていく（支出・出金・利用） */
export type FlowSide = "in" | "out" | "none";

export type FlowLabels = {
  in: string;
  out: string;
  /** カレンダーのマスのように幅の狭い所で使う 1 文字 */
  shortIn: string;
  shortOut: string;
};

export const FLOW_LABELS: Record<FlowKind, FlowLabels> = {
  bank: { in: "入金", out: "出金", shortIn: "入", shortOut: "出" },
  cash: { in: "収入", out: "支出", shortIn: "収", shortOut: "支" },
  budget: { in: "収入", out: "支出", shortIn: "収", shortOut: "支" },
  card: { in: "返金", out: "利用", shortIn: "返", shortOut: "利" },
};

/**
 * 金額の向き。銀行・現金・予算は正の値が入ってくる向き（入金・収入）。
 * カードは正の値が利用（出ていく向き）で、負の値が返金。
 */
export function flowSide(kind: FlowKind, amount: number): FlowSide {
  const n = Math.round(amount);
  if (n === 0) return "none";
  const positiveIsIn = kind !== "card";
  return n > 0 === positiveIsIn ? "in" : "out";
}

/** 向きのラベル（0 のときは空文字） */
export function flowLabel(kind: FlowKind, amount: number): string {
  const side = flowSide(kind, amount);
  return side === "none" ? "" : FLOW_LABELS[kind][side];
}

/**
 * 予実の差（実績 − 予算）の言葉。費用は余り・超過、収入は上振れ・不足。
 * 金額は絶対値で添える。
 */
export function differenceLabel(category: string, difference: number): string {
  const n = Math.round(difference);
  if (n === 0) return "予算どおり";
  // 収入（REVENUE）以外は費用（lib/shared/budget-cycle.ts の isExpenseCategory と同じ）
  if (category !== "REVENUE") return n < 0 ? "余り" : "超過";
  return n > 0 ? "上振れ" : "不足";
}

/** 増減の言葉（正 = 増、負 = 減、0 = 空文字）。「5,000円増」のように金額の後ろに付ける */
export function changeWord(v: number): "増" | "減" | "" {
  const n = Math.round(v);
  return n > 0 ? "増" : n < 0 ? "減" : "";
}

/** 差引・利益などが負のときの言葉（既定は「赤字」）。0 以上なら空文字 */
export function netWord(v: number, negative = "赤字"): string {
  return Math.round(v) < 0 ? negative : "";
}

/**
 * 科目の金額（実績）が負のときの言葉。費用は返金などが上回った「戻り」、収入は「減額」。
 * 科目×月の表やセルの内訳で、「−」の代わりに金額の前に付ける。
 */
export function negativeAmountWord(category: string): string {
  return category === "REVENUE" ? "減額" : "戻り";
}
