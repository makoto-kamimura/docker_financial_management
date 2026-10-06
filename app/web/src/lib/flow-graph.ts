// 資金フロー図（Sankey）のグラフの加工。web とモバイルで共有する（shared-with-mobile.ts）。
// フロー図を 1 つのノード（銀行管理の「表示する銀行」で選んだ口座）につながる線だけに絞る。
// ノードは名前で探し、残った線に出てくるノードだけを残して番号を振り直す。見つからなければ空の図を返す。
export function filterFlowGraph<L extends { source: number; target: number }>(
  graph: { nodes: { name: string }[]; links: L[] },
  name: string,
): { nodes: { name: string }[]; links: L[] } {
  const center = graph.nodes.findIndex((n) => n.name === name);
  if (center < 0) return { nodes: [], links: [] };
  const kept = graph.links.filter((l) => l.source === center || l.target === center);
  const used = [...new Set(kept.flatMap((l) => [l.source, l.target]))].sort((a, b) => a - b);
  const renumber = new Map(used.map((old, i) => [old, i]));
  return {
    nodes: used.map((i) => graph.nodes[i]),
    links: kept.map((l) => ({
      ...l,
      source: renumber.get(l.source)!,
      target: renumber.get(l.target)!,
    })),
  };
}
