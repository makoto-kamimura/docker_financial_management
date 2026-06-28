import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { G, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import type { FlowGraph } from "../api";

const NW  = 100;
const NH  = 44;
const RG  = 12;
const CG  = 72;
const PAD = 16;

function manFmt(v: number): string {
  const m = v / 10_000;
  return m % 1 === 0 ? `${m}万` : `${m.toFixed(1)}万`;
}

function computeDepths(N: number, links: FlowGraph["links"]): number[] {
  const depth    = Array(N).fill(0);
  const adj      = Array.from({ length: N }, (): number[] => []);
  const indegree = Array(N).fill(0);
  for (const { source, target } of links) {
    adj[source].push(target);
    indegree[target]++;
  }
  const q: number[] = [];
  for (let i = 0; i < N; i++) if (indegree[i] === 0) q.push(i);
  while (q.length) {
    const u = q.shift()!;
    for (const v of adj[u]) {
      depth[v] = Math.max(depth[v], depth[u] + 1);
      if (--indegree[v] === 0) q.push(v);
    }
  }
  return depth;
}

function isExternal(name: string) { return name.startsWith("外部（"); }

function nodeColors(name: string, d: number) {
  if (isExternal(name)) {
    return d === 0
      ? { fill: "#d1fae5", stroke: "#34d399", text: "#065f46" }
      : { fill: "#fee2e2", stroke: "#f87171", text: "#991b1b" };
  }
  return { fill: "#eef2ff", stroke: "#818cf8", text: "#3730a3" };
}

export function AccountFlowDiagram({ graph }: { graph: FlowGraph }) {
  const { nodes, links } = graph;
  const N = nodes.length;
  if (N === 0) return null;

  const depth    = computeDepths(N, links);
  const maxDepth = Math.max(...depth);

  const cols: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (let i = 0; i < N; i++) cols[depth[i]].push(i);

  const colX = cols.map((_, ci) => PAD + ci * (NW + CG));
  const colH = (col: number[]) => col.length * NH + Math.max(0, col.length - 1) * RG;
  const maxColH = Math.max(...cols.map(colH));

  const nodePos: { x: number; y: number }[] = Array(N);
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci];
    const h   = colH(col);
    let y = PAD + (maxColH - h) / 2;
    for (const ni of col) {
      nodePos[ni] = { x: colX[ci], y };
      y += NH + RG;
    }
  }

  const svgW = PAD + (cols.length - 1) * (NW + CG) + NW + PAD;
  const svgH = PAD + maxColH + PAD;

  const maxVal = Math.max(...links.map(l => l.value), 1);

  const outByNode = new Map<number, { target: number; value: number }[]>();
  for (const { source, target, value } of links) {
    if (!outByNode.has(source)) outByNode.set(source, []);
    outByNode.get(source)!.push({ target, value });
  }
  for (const [, outs] of outByNode) {
    outs.sort((a, b) => nodePos[a.target].y - nodePos[b.target].y);
  }

  const edgeParams = links.map(({ source, target, value }) => {
    const outs  = outByNode.get(source) ?? [];
    const idx   = outs.findIndex(o => o.target === target);
    const total = outs.length;
    const sp    = nodePos[source];
    const tp    = nodePos[target];
    const y1    = sp.y + NH * (idx + 1) / (total + 1);
    const y2    = tp.y + NH / 2;
    const x1    = sp.x + NW;
    const x2    = tp.x;
    const cx    = x1 + CG / 2;
    const sw    = Math.max(2, Math.round((value / maxVal) * 6));
    const lx    = (x1 + x2) / 2;
    const ly    = (y1 + y2) / 2 - 8;
    return { x1, y1, x2, y2, cx, sw, lx, ly, value };
  });

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={svgW} height={svgH}>
          {/* エッジ */}
          {edgeParams.map(({ x1, y1, x2, y2, cx, sw, lx, ly, value }, i) => (
            <G key={i}>
              <Path
                d={`M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`}
                fill="none"
                stroke="#c7d2fe"
                strokeWidth={sw}
                strokeLinecap="round"
                opacity={0.85}
              />
              <Polygon
                points={`${x2},${y2} ${x2 - 6},${y2 - 4} ${x2 - 6},${y2 + 4}`}
                fill="#818cf8"
                opacity={0.7}
              />
              <Rect x={lx - 18} y={ly - 9} width={36} height={14} rx={3} fill="white" opacity={0.9} />
              <SvgText
                x={lx}
                y={ly + 4}
                textAnchor="middle"
                fontSize={9}
                fill="#4f46e5"
                fontWeight="bold"
              >
                {manFmt(value)}
              </SvgText>
            </G>
          ))}

          {/* ノード */}
          {nodes.map((node, ni) => {
            const { x, y } = nodePos[ni];
            const c  = nodeColors(node.name, depth[ni]);
            const fs = node.name.length > 8 ? 9 : node.name.length > 5 ? 10 : 11;
            return (
              <G key={ni}>
                <Rect x={x + 1} y={y + 2} width={NW} height={NH} rx={8} fill="rgba(0,0,0,0.06)" />
                <Rect x={x} y={y} width={NW} height={NH} rx={8} fill={c.fill} stroke={c.stroke} strokeWidth={1.5} />
                <SvgText
                  x={x + NW / 2}
                  y={y + NH / 2 + Math.round(fs * 0.35)}
                  textAnchor="middle"
                  fontSize={fs}
                  fill={c.text}
                  fontWeight="bold"
                >
                  {node.name}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </ScrollView>

      {/* 凡例 */}
      <View style={st.legend}>
        {([
          { fill: "#d1fae5", stroke: "#34d399", text: "#065f46", label: "入金元" },
          { fill: "#eef2ff", stroke: "#818cf8", text: "#3730a3", label: "銀行口座" },
          { fill: "#fee2e2", stroke: "#f87171", text: "#991b1b", label: "支出先" },
        ] as const).map(({ fill, stroke, text, label }) => (
          <View key={label} style={st.legendItem}>
            <View style={[st.legendBox, { backgroundColor: fill, borderColor: stroke }]} />
            <Text style={[st.legendText, { color: text }]}>{label}</Text>
          </View>
        ))}
        <Text style={st.legendHint}>矢印の太さ ∝ 金額</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  legend:     { flexDirection: "row", flexWrap: "wrap", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendBox:  { width: 14, height: 14, borderRadius: 3, borderWidth: 1.5 },
  legendText: { fontSize: 11, fontWeight: "600" },
  legendHint: { fontSize: 10, color: "#94a3b8", marginLeft: "auto" },
});
