import type { SankeyData } from "@/components/CashFlowSankey";
import { externalKey, type TransferChannel, type TransferInput } from "@/lib/transferflow";

// F-6: 実績ベースの月間資金フロー図（Sankey）。
// 「収入源 → 口座 → カード/引落 → 支払項目」を、紐付け済み明細（実績）+ 資金移動ルールから構築する。
// ノード命名規約は既存 transferflow.ts を踏襲する（口座: `acc:<id>`、外部: `ext:in|out:<label>`）。

// 科目に紐付け済みの入出金明細 1 行。amount は元の符号のまま（+入金 / -出金）。
export type MonthlyTxnEdgeInput = {
  accountId: number;
  accountName: string;
  amount: number;
  categoryAccountId: number | null;
  categoryName: string | null;
};

function categoryKey(categoryAccountId: number) {
  return { key: `cat:${categoryAccountId}` };
}

export function buildMonthlyCashFlow(
  txns: MonthlyTxnEdgeInput[],
  transfers: TransferInput[],
): SankeyData {
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

  const links: { source: number; target: number; value: number }[] = [];

  // 紐付け済み明細（未紐付け＝categoryAccountId が null の行は除外）
  for (const t of txns) {
    if (t.categoryAccountId === null || t.amount === 0) continue;
    const accKey = `acc:${t.accountId}`;
    const catKey = categoryKey(t.categoryAccountId).key;
    const catName = t.categoryName ?? `科目${t.categoryAccountId}`;
    if (t.amount > 0) {
      // 収入源 → 口座
      links.push({
        source: idx(catKey, catName),
        target: idx(accKey, t.accountName),
        value: Math.round(t.amount),
      });
    } else {
      // 口座 → 支払項目
      links.push({
        source: idx(accKey, t.accountName),
        target: idx(catKey, catName),
        value: Math.round(Math.abs(t.amount)),
      });
    }
  }

  // 資金移動（口座間振込・カード/自動引落など）。口座ノードは上のキー規約を共有するため重複しない。
  for (const tr of transfers) {
    if (tr.amount <= 0 || (tr.fromId != null && tr.fromId === tr.toId)) continue;
    const src =
      tr.fromId != null
        ? { key: `acc:${tr.fromId}`, name: tr.fromName ?? `口座${tr.fromId}` }
        : externalKey("in", tr.channel as TransferChannel, tr.label);
    const dst =
      tr.toId != null
        ? { key: `acc:${tr.toId}`, name: tr.toName ?? `口座${tr.toId}` }
        : externalKey("out", tr.channel as TransferChannel, tr.label);
    links.push({
      source: idx(src.key, src.name),
      target: idx(dst.key, dst.name),
      value: Math.round(tr.amount),
    });
  }

  return { nodes: keys.map((k) => ({ name: nameByKey[k] })), links };
}
