import type { SankeyData } from "@/components/CashFlowSankey";

export type TransferInput = {
  fromId: number;
  fromName: string;
  toId: number;
  toName: string;
  amount: number;
};

// 口座間の資金移動から Sankey 用グラフを構築する。
// ノードは口座（id で識別、name をラベルに）、リンクは各振込/引き落とし。
export function buildTransferFlow(transfers: TransferInput[]): SankeyData {
  const ids: number[] = [];
  const nameById: Record<number, string> = {};

  const idx = (id: number, name: string) => {
    nameById[id] = name;
    let i = ids.indexOf(id);
    if (i < 0) {
      ids.push(id);
      i = ids.length - 1;
    }
    return i;
  };

  const links = transfers
    .filter((t) => t.amount > 0 && t.fromId !== t.toId)
    .map((t) => ({
      source: idx(t.fromId, t.fromName),
      target: idx(t.toId, t.toName),
      value: Math.round(t.amount),
    }));

  return { nodes: ids.map((id) => ({ name: nameById[id] })), links };
}

// 自己ループや循環は Sankey で描画できないため、循環の有無を判定する（DFS）。
export function hasCycle(transfers: TransferInput[]): boolean {
  const adj = new Map<number, number[]>();
  for (const t of transfers) {
    if (t.fromId === t.toId) return true;
    if (!adj.has(t.fromId)) adj.set(t.fromId, []);
    adj.get(t.fromId)!.push(t.toId);
  }
  const state = new Map<number, number>(); // 0=未訪問,1=訪問中,2=完了
  const dfs = (n: number): boolean => {
    state.set(n, 1);
    for (const next of adj.get(n) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) return true;
      if (s === 0 && dfs(next)) return true;
    }
    state.set(n, 2);
    return false;
  };
  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0 && dfs(node)) return true;
  }
  return false;
}
