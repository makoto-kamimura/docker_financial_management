import type { SankeyData } from "@/components/CashFlowSankey";

export type TransferChannel =
  "BANK_TRANSFER" | "AUTO_DEBIT" | "CARD_PAYMENT" | "INCOME" | "EXPENSE";

export const CHANNEL_LABELS: Record<TransferChannel, string> = {
  BANK_TRANSFER: "口座間振込",
  AUTO_DEBIT: "口座引き落とし",
  CARD_PAYMENT: "カード引き落とし",
  INCOME: "入金",
  EXPENSE: "支出",
};

// 出金元/入金先は口座(id)または外部(null)。外部側は label でラベル付けする。
export type TransferInput = {
  fromId: number | null;
  fromName: string | null;
  toId: number | null;
  toName: string | null;
  amount: number;
  channel: TransferChannel;
  label?: string | null;
};

// 外部端点のノードキー/ラベルを決める
function externalKey(prefix: "in" | "out", channel: TransferChannel, label?: string | null) {
  const name = label && label.trim() ? label : CHANNEL_LABELS[channel];
  return { key: `ext:${prefix}:${name}`, name: `外部（${name}）` };
}

// 口座間／外部を含む資金移動から Sankey 用グラフを構築する。
export function buildTransferFlow(transfers: TransferInput[]): SankeyData {
  const keys: string[] = [];
  const nameByKey: Record<string, string> = {};
  const idx = (key: string, name: string) => {
    nameByKey[key] = name;
    let i = keys.indexOf(key);
    if (i < 0) {
      keys.push(key);
      i = keys.length - 1;
    }
    return i;
  };

  const links = transfers
    .filter((t) => t.amount > 0 && !(t.fromId != null && t.fromId === t.toId))
    .map((t) => {
      const src =
        t.fromId != null
          ? { key: `acc:${t.fromId}`, name: t.fromName ?? `口座${t.fromId}` }
          : externalKey("in", t.channel, t.label);
      const dst =
        t.toId != null
          ? { key: `acc:${t.toId}`, name: t.toName ?? `口座${t.toId}` }
          : externalKey("out", t.channel, t.label);
      return {
        source: idx(src.key, src.name),
        target: idx(dst.key, dst.name),
        value: Math.round(t.amount),
      };
    });

  return { nodes: keys.map((k) => ({ name: nameByKey[k] })), links };
}

// 循環検出（口座間のみ対象。外部端点は循環しない）。自己ループも循環扱い。
export function hasCycle(transfers: TransferInput[]): boolean {
  const adj = new Map<number, number[]>();
  for (const t of transfers) {
    if (t.fromId == null || t.toId == null) continue;
    if (t.fromId === t.toId) return true;
    if (!adj.has(t.fromId)) adj.set(t.fromId, []);
    adj.get(t.fromId)!.push(t.toId);
  }
  const state = new Map<number, number>();
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
