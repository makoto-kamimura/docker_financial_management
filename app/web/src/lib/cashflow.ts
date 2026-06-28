// キャッシュフロー（資金フロー）図のデータ構造。Recharts Sankey に渡せる形にする。
export type CashFlowNode = { name: string };
export type CashFlowLink = { source: number; target: number; value: number };
export type CashFlowGraph = { nodes: CashFlowNode[]; links: CashFlowLink[] };

export type SysMode = "household" | "sole" | "corporate";

export type CashFlowLabels = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  expense: string;
  operatingProfit: string;
};

export const MODE_LABELS: Record<SysMode, CashFlowLabels> = {
  household: {
    revenue: "収入",
    cogs: "変動費",
    grossProfit: "収支差額",
    expense: "固定費",
    operatingProfit: "手残り",
  },
  sole: {
    revenue: "売上",
    cogs: "仕入・変動費",
    grossProfit: "粗利",
    expense: "経費",
    operatingProfit: "事業利益",
  },
  corporate: {
    revenue: "売上高",
    cogs: "売上原価",
    grossProfit: "売上総利益",
    expense: "販管費",
    operatingProfit: "営業利益",
  },
};

export type CashFlowInput = {
  revenue: number;
  cogs: number;
  expense: number;
};

export type CashFlowResult = {
  graph: CashFlowGraph;
  grossProfit: number;
  operatingProfit: number;
  labels: CashFlowLabels;
};

// ラベル付きエッジから、使用ノードのみを含む Sankey 用グラフを構築する。
// （値が 0 以下のエッジは除外し、未使用ノードは含めない＝Recharts のエラー回避）
function graphFromEdges(edges: { from: string; to: string; value: number }[]): CashFlowGraph {
  const names: string[] = [];
  const idx = (name: string) => {
    let i = names.indexOf(name);
    if (i < 0) {
      names.push(name);
      i = names.length - 1;
    }
    return i;
  };

  const links: CashFlowLink[] = edges
    .filter((e) => e.value > 0)
    .map((e) => ({ source: idx(e.from), target: idx(e.to), value: Math.round(e.value) }));

  return { nodes: names.map((name) => ({ name })), links };
}

// 収入・支出から資金フロー図を組み立てる。モードに応じてノード名を切り替える。
export function buildCashFlow(input: CashFlowInput, mode: SysMode = "sole"): CashFlowResult {
  const L = MODE_LABELS[mode];
  const grossProfit = input.revenue - input.cogs;
  const operatingProfit = grossProfit - input.expense;

  const graph = graphFromEdges([
    { from: L.revenue, to: L.cogs, value: input.cogs },
    { from: L.revenue, to: L.grossProfit, value: grossProfit },
    { from: L.grossProfit, to: L.expense, value: input.expense },
    { from: L.grossProfit, to: L.operatingProfit, value: operatingProfit },
  ]);

  return { graph, grossProfit, operatingProfit, labels: L };
}
