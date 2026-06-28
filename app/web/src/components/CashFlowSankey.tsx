"use client";

const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });
const pct = (v: number, total: number) =>
  total > 0 ? `${Math.round((Math.abs(v) / total) * 100)}%` : "0%";

// kept for backward compat with CashFlowResponse type in page.tsx
export type SankeyData = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

type Totals = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expense: number;
  operatingProfit: number;
};
type Labels = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  expense: string;
  operatingProfit: string;
};

// ── カラーパレット ────────────────────────────────────────────
const C = {
  rev: "#4f46e5", // indigo
  cogs: "#f97316", // orange
  gros: "#6366f1", // violet-indigo
  exp: "#f59e0b", // amber
  prof: "#16a34a", // green
  loss: "#dc2626", // red
  conn: "#cbd5e1", // slate-300
};

// バー内テキスト（バーが広い場合のみ内部に表示）
function BarLabel({
  x,
  y,
  w,
  h,
  line1,
  line2,
  minW = 90,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  line1: string;
  line2: string;
  minW?: number;
}) {
  if (w < minW) return null;
  return (
    <>
      <text
        x={x + w / 2}
        y={y + h / 2 - 7}
        textAnchor="middle"
        fontSize={11}
        fill="white"
        fontWeight="700"
      >
        {line1}
      </text>
      <text
        x={x + w / 2}
        y={y + h / 2 + 9}
        textAnchor="middle"
        fontSize={10}
        fill="rgba(255,255,255,0.85)"
      >
        {line2}
      </text>
    </>
  );
}

// バーが狭い場合は右外にラベル
function OuterLabel({
  x,
  y,
  w,
  h,
  line1,
  line2,
  minW = 90,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  line1: string;
  line2: string;
  minW?: number;
}) {
  if (w >= minW) return null;
  return (
    <>
      <text
        x={x + w + 8}
        y={y + h / 2 - 6}
        textAnchor="start"
        fontSize={11}
        fill="#1e293b"
        fontWeight="600"
      >
        {line1}
      </text>
      <text x={x + w + 8} y={y + h / 2 + 8} textAnchor="start" fontSize={10} fill="#64748b">
        {line2}
      </text>
    </>
  );
}

// ── メインコンポーネント ──────────────────────────────────────
export function CashFlowSankey({
  totals,
  labels,
}: {
  data?: SankeyData; // unused, kept for call-site compat
  totals?: Totals;
  labels?: Labels;
}) {
  if (!totals || totals.revenue <= 0) {
    return (
      <p className="text-sm text-slate-400 py-10 text-center">
        表示できる資金フローがありません（データ不足または損失）。
      </p>
    );
  }

  const lbl: Labels = labels ?? {
    revenue: "収入",
    cogs: "変動費",
    grossProfit: "粗利益",
    expense: "固定費",
    operatingProfit: "営業利益",
  };

  const rev = totals.revenue;

  // ── レイアウト定数 ─────────────────────────────────────────
  const LABEL_W = 82; // 左ラベル幅
  const BAR_MAX = 460; // 最大バー幅
  const BH = 52; // 主バー高さ
  const COST_H = 30; // コストバー高さ
  const GAP = 44; // 主バー間の空白（コストバーがここに入る）
  const STEP = BH + GAP;
  const CHART_W = LABEL_W + BAR_MAX + 160; // 右側の外部ラベル余白含む

  const y0 = 20;
  const y1 = y0 + STEP;
  const y2 = y1 + STEP;
  const CHART_H = y2 + BH + 20;

  const bx = LABEL_W; // バー開始X

  // バー幅 (revenue=BAR_MAX を基準に比例)
  const bw = (v: number) => Math.max(0, Math.min((v / rev) * BAR_MAX, BAR_MAX));

  const wGros = bw(Math.max(0, totals.grossProfit));
  const wCogs = bw(totals.cogs);
  const wProf = bw(Math.max(0, totals.operatingProfit));
  const wExp = bw(totals.expense);

  // コストバーのY（GAP 内で垂直センタリング）
  const yCogs = y0 + BH + (GAP - COST_H) / 2;
  const yExp = y1 + BH + (GAP - COST_H) / 2;

  const profitColor = totals.operatingProfit >= 0 ? C.prof : C.loss;
  const grossColor = totals.grossProfit >= 0 ? C.gros : C.loss;

  // 右矢印（コストバーの右端に付ける）
  const Arrow = ({ x, y }: { x: number; y: number }) => (
    <polygon points={`${x},${y - 5} ${x + 9},${y} ${x},${y + 5}`} fill="rgba(0,0,0,0.15)" />
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          width={CHART_W}
          height={CHART_H}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="font-sans"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          {/* ═══ 収入 ════════════════════════════════ */}
          <text
            x={bx - 10}
            y={y0 + BH / 2}
            dominantBaseline="middle"
            textAnchor="end"
            fontSize={12}
            fill="#374151"
            fontWeight="700"
          >
            {lbl.revenue}
          </text>
          <rect x={bx} y={y0} width={BAR_MAX} height={BH} fill={C.rev} rx={6} />
          <BarLabel x={bx} y={y0} w={BAR_MAX} h={BH} line1={yen(rev)} line2="100%" minW={100} />

          {/* コネクタ: 収入→粗利 */}
          <line x1={bx + 1} y1={y0 + BH} x2={bx + 1} y2={y1} stroke={C.conn} strokeWidth={2.5} />

          {/* ═══ 変動費（COGS）分岐バー ═════════════ */}
          {wCogs > 0 && (
            <g>
              <rect x={bx + wGros} y={yCogs} width={wCogs} height={COST_H} fill={C.cogs} rx={4} />
              <BarLabel
                x={bx + wGros}
                y={yCogs}
                w={wCogs}
                h={COST_H}
                line1={lbl.cogs}
                line2={`${yen(totals.cogs)}（${pct(totals.cogs, rev)}）`}
                minW={100}
              />
              <OuterLabel
                x={bx + wGros}
                y={yCogs}
                w={wCogs}
                h={COST_H}
                line1={`${lbl.cogs}  ${yen(totals.cogs)}`}
                line2={pct(totals.cogs, rev)}
                minW={100}
              />
              <Arrow x={bx + BAR_MAX + 4} y={yCogs + COST_H / 2} />
            </g>
          )}

          {/* ═══ 粗利益 ══════════════════════════════ */}
          <text
            x={bx - 10}
            y={y1 + BH / 2}
            dominantBaseline="middle"
            textAnchor="end"
            fontSize={12}
            fill="#374151"
            fontWeight="700"
          >
            {lbl.grossProfit}
          </text>
          {wGros > 0 ? (
            <g>
              <rect x={bx} y={y1} width={wGros} height={BH} fill={grossColor} rx={6} />
              <BarLabel
                x={bx}
                y={y1}
                w={wGros}
                h={BH}
                line1={yen(totals.grossProfit)}
                line2={pct(totals.grossProfit, rev)}
                minW={90}
              />
              <OuterLabel
                x={bx}
                y={y1}
                w={wGros}
                h={BH}
                line1={yen(totals.grossProfit)}
                line2={pct(totals.grossProfit, rev)}
                minW={90}
              />
            </g>
          ) : (
            <text
              x={bx + 10}
              y={y1 + BH / 2}
              dominantBaseline="middle"
              fontSize={12}
              fill={C.loss}
              fontWeight="600"
            >
              {yen(totals.grossProfit)}（損失）
            </text>
          )}

          {/* コネクタ: 粗利→営業利益 */}
          <line x1={bx + 1} y1={y1 + BH} x2={bx + 1} y2={y2} stroke={C.conn} strokeWidth={2.5} />

          {/* ═══ 固定費（Expense）分岐バー ══════════ */}
          {wExp > 0 && wGros > 0 && (
            <g>
              <rect x={bx + wProf} y={yExp} width={wExp} height={COST_H} fill={C.exp} rx={4} />
              <BarLabel
                x={bx + wProf}
                y={yExp}
                w={wExp}
                h={COST_H}
                line1={lbl.expense}
                line2={`${yen(totals.expense)}（${pct(totals.expense, rev)}）`}
                minW={100}
              />
              <OuterLabel
                x={bx + wProf}
                y={yExp}
                w={wExp}
                h={COST_H}
                line1={`${lbl.expense}  ${yen(totals.expense)}`}
                line2={pct(totals.expense, rev)}
                minW={100}
              />
              <Arrow x={bx + wGros + 4} y={yExp + COST_H / 2} />
            </g>
          )}

          {/* ═══ 営業利益 ════════════════════════════ */}
          <text
            x={bx - 10}
            y={y2 + BH / 2}
            dominantBaseline="middle"
            textAnchor="end"
            fontSize={12}
            fill="#374151"
            fontWeight="700"
          >
            {lbl.operatingProfit}
          </text>
          {wProf > 0 ? (
            <g>
              <rect x={bx} y={y2} width={wProf} height={BH} fill={profitColor} rx={6} />
              <BarLabel
                x={bx}
                y={y2}
                w={wProf}
                h={BH}
                line1={yen(totals.operatingProfit)}
                line2={pct(totals.operatingProfit, rev)}
                minW={90}
              />
              <OuterLabel
                x={bx}
                y={y2}
                w={wProf}
                h={BH}
                line1={yen(totals.operatingProfit)}
                line2={pct(totals.operatingProfit, rev)}
                minW={90}
              />
            </g>
          ) : (
            <text
              x={bx + 10}
              y={y2 + BH / 2}
              dominantBaseline="middle"
              fontSize={12}
              fill={C.loss}
              fontWeight="600"
            >
              {yen(totals.operatingProfit)}（損失）
            </text>
          )}
        </svg>
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 px-1">
        {(
          [
            [C.rev, lbl.revenue, yen(rev)],
            [C.cogs, lbl.cogs, yen(totals.cogs)],
            [grossColor, lbl.grossProfit, yen(totals.grossProfit)],
            [C.exp, lbl.expense, yen(totals.expense)],
            [profitColor, lbl.operatingProfit, yen(totals.operatingProfit)],
          ] as [string, string, string][]
        ).map(([color, label, amount]) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
            <span className="font-medium">{label}</span>
            <span className="text-slate-400">{amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
