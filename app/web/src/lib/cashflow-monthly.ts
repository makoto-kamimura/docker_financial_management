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

// 過去の実績から推測した「まだ実績入力が無い」フロー。描画側で色を変えるため estimated を立てる。
export type EstimatedEdgeInput = MonthlyTxnEdgeInput;

// 対象月に実績がない (口座 × 科目) の組について、過去数か月の平均から推測値を作る。
// history は対象月より前の紐付け済み明細（月をまたいで渡す）。months は履歴の対象月数。
export function estimateMissingEdges(
  actual: MonthlyTxnEdgeInput[],
  history: MonthlyTxnEdgeInput[],
  months: number,
): EstimatedEdgeInput[] {
  if (months <= 0) return [];
  const key = (e: MonthlyTxnEdgeInput) => `${e.accountId}:${e.categoryAccountId}`;
  const actualKeys = new Set(actual.filter((e) => e.categoryAccountId !== null).map(key));

  const sums = new Map<string, { edge: MonthlyTxnEdgeInput; total: number }>();
  for (const e of history) {
    if (e.categoryAccountId === null || e.amount === 0) continue;
    const k = key(e);
    if (actualKeys.has(k)) continue; // 実績があるものは推測しない
    const cur = sums.get(k) ?? { edge: e, total: 0 };
    cur.total += e.amount;
    sums.set(k, cur);
  }

  const estimated: EstimatedEdgeInput[] = [];
  for (const { edge, total } of sums.values()) {
    const avg = total / months;
    // 平均が 1 円未満（＝ほぼ相殺）になるものは線を出さない
    if (Math.abs(avg) < 1) continue;
    estimated.push({ ...edge, amount: Math.round(avg) });
  }
  return estimated;
}

export function buildMonthlyCashFlow(
  txns: MonthlyTxnEdgeInput[],
  transfers: TransferInput[],
  /** 実績が無い分の推測フロー（破線で描画される） */
  estimated: EstimatedEdgeInput[] = [],
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

  const links: { source: number; target: number; value: number; estimated?: boolean }[] = [];

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

  // 推測フロー（実績が未入力の口座 × 科目）。実績・資金移動の後に足して線を重複させない。
  for (const e of estimated) {
    if (e.categoryAccountId === null || e.amount === 0) continue;
    const accKey = `acc:${e.accountId}`;
    const catKey = categoryKey(e.categoryAccountId).key;
    const catName = e.categoryName ?? `科目${e.categoryAccountId}`;
    const value = Math.round(Math.abs(e.amount));
    if (e.amount > 0) {
      links.push({
        source: idx(catKey, catName),
        target: idx(accKey, e.accountName),
        value,
        estimated: true,
      });
    } else {
      links.push({
        source: idx(accKey, e.accountName),
        target: idx(catKey, catName),
        value,
        estimated: true,
      });
    }
  }

  return { nodes: keys.map((k) => ({ name: nameByKey[k] })), links };
}
