import type { ViewMode } from "@/lib/display-name";
import { MODE_LABELS, type ModeLabels } from "@/lib/mode-labels";

// キャッシュフロー（資金フロー）図のデータ構造。Recharts Sankey に渡せる形にする。
export type CashFlowNode = { name: string };
export type CashFlowLink = { source: number; target: number; value: number };
export type CashFlowGraph = { nodes: CashFlowNode[]; links: CashFlowLink[] };

// lib/display-name.ts の ViewMode と同一。既存コードとの互換のためエイリアスとして残す。
export type SysMode = ViewMode;

// モード別の用語（MODE_LABELS）は KPI カードと共用するため lib/mode-labels.ts に置いている

export type CashFlowInput = {
  revenue: number;
  cogs: number;
  expense: number;
};

export type CashFlowResult = {
  graph: CashFlowGraph;
  grossProfit: number;
  operatingProfit: number;
  labels: ModeLabels;
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
