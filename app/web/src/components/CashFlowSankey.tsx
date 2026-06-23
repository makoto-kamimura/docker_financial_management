"use client";

import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";

export type SankeyData = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

// Sankey のノード描画（矩形＋ラベル）。
function FlowNode(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: { name: string; value: number };
  containerWidth: number;
}) {
  const { x, y, width, height, payload, containerWidth } = props;
  const isRightSide = x + width + 140 > containerWidth;
  const labelX = isRightSide ? x - 6 : x + width + 6;
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill="#2563eb" fillOpacity={0.9} />
      <text
        x={labelX}
        y={y + height / 2}
        textAnchor={isRightSide ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={13}
        fill="#111827"
      >
        {payload.name}
      </text>
      <text
        x={labelX}
        y={y + height / 2 + 16}
        textAnchor={isRightSide ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={11}
        fill="#6b7280"
      >
        {payload.value.toLocaleString("ja-JP")}
      </text>
    </Layer>
  );
}

// 資金フロー図（Sankey ダイアグラム）。
export function CashFlowSankey({ data }: { data: SankeyData }) {
  if (!data.links.length) {
    return <p style={{ color: "#6b7280" }}>表示できる資金フローがありません（データ不足、または損失）。</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={420}>
      <Sankey
        data={data}
        nodePadding={28}
        margin={{ top: 16, right: 140, bottom: 16, left: 16 }}
        link={{ stroke: "#93c5fd" }}
        node={<FlowNode containerWidth={0} x={0} y={0} width={0} height={0} index={0} payload={{ name: "", value: 0 }} />}
      >
        <Tooltip formatter={(v: number) => v.toLocaleString("ja-JP")} />
      </Sankey>
    </ResponsiveContainer>
  );
}
