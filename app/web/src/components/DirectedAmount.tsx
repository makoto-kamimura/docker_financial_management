// 向きのある金額の表示。金額に「+」「−」を付けず、絶対値に向きのラベル（入金・出金・利用・返金など）と
// 色（入ってくる向き＝緑、出ていく向き＝赤）を添える。言葉は lib/shared/amount-direction.ts。

import { yenAbs } from "@/lib/common/format";
import { FLOW_LABELS, flowSide, type FlowKind, type FlowSide } from "@/lib/shared/amount-direction";

/** 文字の色（入ってくる向き＝緑、出ていく向き＝赤） */
export const SIDE_TEXT: Record<FlowSide, string> = {
  in: "text-emerald-600",
  out: "text-rose-600",
  none: "text-slate-700",
};

const SIDE_TAG: Record<FlowSide, string> = {
  in: "bg-emerald-50 text-emerald-700",
  out: "bg-rose-50 text-rose-700",
  none: "bg-slate-100 text-slate-600",
};

/** 金額の前に付ける小さなラベル */
export function DirectionTag({ label, side }: { label: string; side: FlowSide }) {
  if (!label) return null;
  return (
    <span
      className={`mr-1 inline-block rounded px-1 py-px align-middle text-[10px] font-medium leading-tight ${SIDE_TAG[side]}`}
    >
      {label}
    </span>
  );
}

/** 「[出金] 1,234円」。kind で正の値の向きを決める（カードは正の値が利用） */
export function DirectedAmount({
  kind,
  amount,
  short = false,
  className = "",
}: {
  kind: FlowKind;
  amount: number;
  /** 1 文字のラベルにする（幅の狭い所） */
  short?: boolean;
  className?: string;
}) {
  const side = flowSide(kind, amount);
  const labels = FLOW_LABELS[kind];
  const label =
    side === "none" ? "" : short ? labels[side === "in" ? "shortIn" : "shortOut"] : labels[side];
  return (
    <span className={`tabular-nums ${SIDE_TEXT[side]} ${className}`}>
      <DirectionTag label={label} side={side} />
      {yenAbs(amount)}
    </span>
  );
}
