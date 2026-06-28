"use client";

// 口座間 資金移動フロー図
// Sankey ノード／リンクを受け取り、左→右のカード＋ベジェ矢印で描画する。

export type FlowGraph = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

// ── レイアウト定数 ─────────────────────────────────────────────────────
const NW  = 118;   // ノード幅
const NH  = 48;    // ノード高さ
const RG  = 14;    // 同列ノード間の縦ギャップ
const CG  = 96;    // 列間水平ギャップ
const PAD = 22;    // 外側余白

// ── ユーティリティ ────────────────────────────────────────────────────
function manFmt(v: number) {
  const m = v / 10_000;
  return m % 1 === 0 ? `${m}万` : `${m.toFixed(1)}万`;
}

/** トポロジカル順 + 最長パス深さ */
function computeDepths(N: number, links: FlowGraph["links"]): number[] {
  const depth   = Array(N).fill(0);
  const adj     = Array.from({ length: N }, (): number[] => []);
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

/** 外部ノード（名前が 外部（…）形式）かどうか */
function isExternal(name: string) { return name.startsWith("外部（"); }

// ── メインコンポーネント ──────────────────────────────────────────────
export function AccountFlowDiagram({ data }: { data?: FlowGraph }) {
  if (!data || data.nodes.length === 0) {
    return (
      <p className="text-sm text-slate-400 py-10 text-center">
        口座間の資金移動が登録されていません。<br />
        「カレンダー」タブで口座間フローを設定してください。
      </p>
    );
  }

  const { nodes, links } = data;
  const N = nodes.length;
  const depth = computeDepths(N, links);
  const maxDepth = Math.max(...depth);

  // 列ごとにノードをグループ化
  const cols: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (let i = 0; i < N; i++) cols[depth[i]].push(i);

  // 列 X 座標
  const colX = cols.map((_, ci) => PAD + ci * (NW + CG));

  // 各列の高さ（ノード数×高さ + ギャップ合計）
  const colH = (col: number[]) => col.length * NH + Math.max(0, col.length - 1) * RG;
  const maxColH = Math.max(...cols.map(colH));

  // ノード位置（列内は中央揃え）
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

  // ノードカラー
  function nodeColors(ni: number) {
    const name = nodes[ni].name;
    const d    = depth[ni];
    if (isExternal(name)) {
      return d === 0
        ? { fill: "#d1fae5", stroke: "#34d399", text: "#065f46" }  // 入金元 = 緑
        : { fill: "#fee2e2", stroke: "#f87171", text: "#991b1b" }; // 支出先 = 赤
    }
    return { fill: "#eef2ff", stroke: "#818cf8", text: "#3730a3" }; // 銀行口座 = インディゴ
  }

  // エッジの最大値（ストローク幅スケール用）
  const maxVal = Math.max(...links.map(l => l.value), 1);

  // ノードごとの出力リンクを y 順にソートして、開始点をノード内でオフセット
  const outByNode: Map<number, { target: number; value: number }[]> = new Map();
  for (const { source, target, value } of links) {
    if (!outByNode.has(source)) outByNode.set(source, []);
    outByNode.get(source)!.push({ target, value });
  }
  for (const [, outs] of outByNode) {
    outs.sort((a, b) => nodePos[a.target].y - nodePos[b.target].y);
  }

  // エッジ描画パラメータ計算
  const edgeParams = links.map(({ source, target, value }) => {
    const outs  = outByNode.get(source) ?? [];
    const idx   = outs.findIndex(o => o.target === target);
    const total = outs.length;

    const s = nodePos[source];
    const t = nodePos[target];
    // 出発点: ノード右端、Y はリンク数で均等割り
    const y1 = s.y + NH * (idx + 1) / (total + 1);
    const y2 = t.y + NH / 2;
    const x1 = s.x + NW;
    const x2 = t.x;
    const cx = x1 + CG / 2;
    const sw = Math.max(2, Math.round((value / maxVal) * 7));

    // テキストラベル位置: カーブ中間点より少し上
    const lx = (x1 + x2) / 2;
    const ly = (y1 + y2) / 2 - 10;

    return { x1, y1, x2, y2, cx, sw, lx, ly, value };
  });

  return (
    <div className="overflow-x-auto">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ fontFamily: "system-ui, sans-serif" }}
      >
        {/* ── エッジ ────────────────────────────────────────────── */}
        {edgeParams.map(({ x1, y1, x2, y2, cx, sw, lx, ly, value }, i) => (
          <g key={i}>
            <path
              d={`M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`}
              fill="none"
              stroke="#c7d2fe"
              strokeWidth={sw}
              strokeLinecap="round"
              opacity={0.8}
            />
            {/* 矢印先端 */}
            <polygon
              points={`${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}`}
              fill="#818cf8"
              opacity={0.6}
            />
            {/* 金額ラベル（背景付き） */}
            <rect
              x={lx - 18} y={ly - 10}
              width={36} height={14}
              rx={3}
              fill="white"
              opacity={0.85}
            />
            <text
              x={lx}
              y={ly + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fill="#4f46e5"
              fontWeight="700"
            >
              {manFmt(value)}
            </text>
          </g>
        ))}

        {/* ── ノード ────────────────────────────────────────────── */}
        {nodes.map((node, ni) => {
          const { x, y } = nodePos[ni];
          const c = nodeColors(ni);
          const name = node.name;
          const fs = name.length > 9 ? 10 : name.length > 6 ? 11 : 12;
          return (
            <g key={ni}>
              {/* ドロップシャドウ */}
              <rect
                x={x + 1} y={y + 2}
                width={NW} height={NH}
                rx={8}
                fill="rgba(0,0,0,0.07)"
              />
              <rect
                x={x} y={y}
                width={NW} height={NH}
                rx={8}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={1.5}
              />
              <text
                x={x + NW / 2}
                y={y + NH / 2 + 0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={fs}
                fill={c.text}
                fontWeight="700"
              >
                {name}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 凡例 */}
      <div className="flex gap-4 mt-3 px-1 flex-wrap">
        {([
          { fill: "#d1fae5", stroke: "#34d399", text: "#065f46", label: "入金元（外部）" },
          { fill: "#eef2ff", stroke: "#818cf8", text: "#3730a3", label: "銀行口座" },
          { fill: "#fee2e2", stroke: "#f87171", text: "#991b1b", label: "支出先（外部）" },
        ] as const).map(({ fill, stroke, text, label }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="w-4 h-4 rounded"
              style={{ background: fill, border: `1.5px solid ${stroke}` }}
            />
            <span style={{ color: text }} className="font-medium">{label}</span>
          </div>
        ))}
        <span className="text-xs text-slate-400 ml-auto">矢印の太さ ∝ 金額</span>
      </div>
    </div>
  );
}
