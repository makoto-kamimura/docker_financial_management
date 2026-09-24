// カード・電子マネー関連の資金フロー図。
//
// 銀行管理のサマリにある「口座間 資金フロー図」（lib/transferflow.ts）のカード版。
// 銀行側は口座どうしの資金移動を描くが、こちらはカードを中心に 3 種類の線を 1 枚にまとめる。
//
//   1. 銀行口座 → カード       … 毎月の引き落とし（Transfer の linkedAccountId 付き）
//   2. 銀行口座 → カード       … チャージ（BankTransaction.chargeToAccountId）
//   3. カード → カード         … チャージ（CardTransaction.transferToAccountId）
//   4. カード → 外部（摘要）   … そのカードで毎月固定決済される支払い（CardRecurringPayment）
//
// 銀行側のフロー図では 1 の同じルールが「口座 → 外部（カード名）」になり、カードは
// 外部ノードとして潰れてしまうので、カード側では独立したノードとして扱う。
// 3 と 4 はそもそも銀行口座から現金が出る動きではないため、銀行側の図には現れない。
//
// 1 と 2 はどちらも銀行口座から出るが、1 は毎月のルール（設定）、2 は明細の実績で、
// 別々に登録されるため線としては同じ 銀行 → カード の組に合算する。

import type { FlowGraph } from "@/components/AccountFlowDiagram";
import { CHANNEL_LABELS, type TransferChannel } from "@/lib/transferflow";

/** 銀行口座 → カードの引き落とし（資金移動ルール） */
export type CardFlowTransfer = {
  /** 引き落とし元の銀行口座名（未設定なら外部からの入金として扱う） */
  fromAccountName: string | null;
  /** 対象のカード・電子マネー名 */
  linkedAccountName: string;
  amount: number;
  channel: TransferChannel;
  /** 外部側の名称（未設定なら種別名を使う） */
  label: string | null;
};

/** カード → カードのチャージ。金額は明細から求めた 1 か月あたりの額 */
export type CardFlowCharge = {
  fromCardName: string;
  toCardName: string;
  amount: number;
};

/** 銀行口座 → カードのチャージ。金額は明細から求めた 1 か月あたりの額 */
export type CardFlowBankCharge = {
  fromBankName: string;
  toCardName: string;
  amount: number;
};

/** カードで毎月固定決済される支払い（サブスク等）。終点は摘要名の外部ノード */
export type CardFlowRecurring = {
  cardName: string;
  label: string;
  amount: number;
};

export type CardFlowInput = {
  transfers: CardFlowTransfer[];
  charges?: CardFlowCharge[];
  bankCharges?: CardFlowBankCharge[];
  recurring?: CardFlowRecurring[];
};

/**
 * カード・電子マネー関連の資金の流れから Sankey 用グラフを構築する。
 *
 * 同じ 起点 → 終点 の組が複数に分かれている場合（別々の日に引き落とす、同じカードへ
 * 複数回チャージする、など）は 1 本の線にまとめ、金額を合計する。
 */
export function buildCardFlow(input: CardFlowInput): FlowGraph {
  const { transfers, charges = [], bankCharges = [], recurring = [] } = input;

  const keys: string[] = [];
  const nameByKey = new Map<string, string>();
  const idx = (key: string, name: string) => {
    nameByKey.set(key, name);
    let i = keys.indexOf(key);
    if (i < 0) {
      keys.push(key);
      i = keys.length - 1;
    }
    return i;
  };

  // source→target ごとに金額を合算する（同じ組の線を 1 本にまとめる）
  const totals = new Map<string, { source: number; target: number; value: number }>();
  const addLink = (
    src: { key: string; name: string },
    dst: { key: string; name: string },
    amount: number,
  ) => {
    if (!(amount > 0)) return;
    const source = idx(src.key, src.name);
    const target = idx(dst.key, dst.name);
    if (source === target) return;

    const pairKey = `${source}->${target}`;
    const current = totals.get(pairKey);
    if (current) current.value += Math.round(amount);
    else totals.set(pairKey, { source, target, value: Math.round(amount) });
  };

  const cardNode = (name: string) => ({ key: `card:${name}`, name });
  const bankNode = (name: string) => ({ key: `bank:${name}`, name });

  for (const t of transfers) {
    const src = t.fromAccountName
      ? bankNode(t.fromAccountName)
      : {
          key: `ext:${t.label ?? t.channel}`,
          name: `外部（${t.label?.trim() || CHANNEL_LABELS[t.channel]}）`,
        };
    addLink(src, cardNode(t.linkedAccountName), t.amount);
  }

  for (const c of charges) {
    addLink(cardNode(c.fromCardName), cardNode(c.toCardName), c.amount);
  }

  // 銀行口座からのチャージ。引き落としと同じ 銀行 → カード の組なので、
  // 同じ組み合わせなら addLink 側で 1 本にまとめられる
  for (const c of bankCharges) {
    addLink(bankNode(c.fromBankName), cardNode(c.toCardName), c.amount);
  }

  for (const r of recurring) {
    // 固定決済の終点はカードの外にお金が出ていく先。摘要名でノードを分ける
    addLink(cardNode(r.cardName), { key: `pay:${r.label}`, name: r.label }, r.amount);
  }

  return {
    nodes: keys.map((k) => ({ name: nameByKey.get(k) ?? k })),
    links: [...totals.values()],
  };
}

/** チャージとして指定済みの明細 1 件（集計の入力） */
export type CardChargeTxn = {
  fromCardName: string;
  toCardName: string;
  /** 明細の金額。+利用（チャージ）/ -返金 */
  amount: number;
};

/**
 * チャージ明細から「1 か月あたりのチャージ額」を求める。
 *
 * 図の他の線（引き落とし・固定決済）は毎月の金額なので、実績であるチャージも
 * 月あたりに均して並べないと線の太さが比べられない。金額はカード側の符号のまま
 * 渡ってくるので、返金（マイナス）は差し引いた純額にする。
 *
 * @param months 集計対象にした月数（0 以下なら 1 か月として扱う）
 */
export function aggregateCharges(txns: CardChargeTxn[], months: number): CardFlowCharge[] {
  return aggregateBy(txns, months, (t) => `${t.fromCardName}->${t.toCardName}`);
}

/** 銀行口座からのチャージ明細 1 件（集計の入力） */
export type BankChargeTxn = {
  fromBankName: string;
  toCardName: string;
  /**
   * チャージ額。銀行明細は「入金は正・出金は負」なので、呼び出し側で符号を反転して
   * カード側と同じ「チャージは正・返金は負」に揃えてから渡す。
   */
  amount: number;
};

/**
 * 銀行口座からのチャージ明細を「1 か月あたりのチャージ額」に均す。
 * カード同士のチャージ（aggregateCharges）と同じ扱いで、線の太さを比べられるようにする。
 */
export function aggregateBankCharges(txns: BankChargeTxn[], months: number): CardFlowBankCharge[] {
  return aggregateBy(txns, months, (t) => `${t.fromBankName}->${t.toCardName}`);
}

// 起点・終点の組ごとに金額を合算し、月数で割って 1 か月あたりに均す。
// 返金（マイナス）を差し引いた純額が 0 以下になった組は線を引かない。
function aggregateBy<T extends { amount: number }>(
  txns: T[],
  months: number,
  keyOf: (t: T) => string,
): T[] {
  const divisor = months > 0 ? months : 1;
  const sums = new Map<string, T>();
  for (const t of txns) {
    const key = keyOf(t);
    const current = sums.get(key);
    if (current) current.amount += t.amount;
    else sums.set(key, { ...t });
  }
  return [...sums.values()]
    .map((c) => ({ ...c, amount: Math.round(c.amount / divisor) }))
    .filter((c) => c.amount > 0);
}

/**
 * チャージの循環検出（カード同士のみ対象。銀行口座・外部の端点は循環しない）。
 * A→B→A のようにチャージし合っていると Sankey が描画できないため、
 * 銀行側の hasCycle と同じく描画前に判定して図の代わりに案内を出す。
 */
export function hasCardFlowCycle(charges: CardFlowCharge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const c of charges) {
    if (!(c.amount > 0)) continue;
    if (c.fromCardName === c.toCardName) return true;
    if (!adj.has(c.fromCardName)) adj.set(c.fromCardName, []);
    adj.get(c.fromCardName)!.push(c.toCardName);
  }
  const state = new Map<string, number>();
  const dfs = (n: string): boolean => {
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
