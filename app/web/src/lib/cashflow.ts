// キャッシュフロー（資金フロー）図のデータ構造。Recharts Sankey に渡せる形にする。
export type CashFlowNode = { name: string };
export type CashFlowLink = { source: number; target: number; value: number };
export type CashFlowGraph = { nodes: CashFlowNode[]; links: CashFlowLink[] };

export type CashFlowInput = {
  revenue: number; // 売上高
  cogs: number; // 売上原価
  expense: number; // 販管費
};

export type CashFlowResult = {
  graph: CashFlowGraph;
  grossProfit: number; // 売上総利益 = 売上 - 原価
  operatingProfit: number; // 営業利益 = 売上総利益 - 販管費
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

// 売上・原価・販管費から資金フロー図を組み立てる。
// 売上高 → (売上原価 / 売上総利益) 、売上総利益 → (販管費 / 営業利益)
export function buildCashFlow(input: CashFlowInput): CashFlowResult {
  const grossProfit = input.revenue - input.cogs;
  const operatingProfit = grossProfit - input.expense;

  const graph = graphFromEdges([
    { from: "売上高", to: "売上原価", value: input.cogs },
    { from: "売上高", to: "売上総利益", value: grossProfit },
    { from: "売上総利益", to: "販管費", value: input.expense },
    { from: "売上総利益", to: "営業利益", value: operatingProfit },
  ]);

  return { graph, grossProfit, operatingProfit };
}
