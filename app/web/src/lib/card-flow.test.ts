import { describe, expect, it } from "vitest";
import {
  aggregateBankCharges,
  aggregateCharges,
  buildCardFlow,
  hasCardFlowCycle,
  type CardFlowTransfer,
} from "./card-flow";

const base: CardFlowTransfer = {
  fromAccountName: "住信SBIネット銀行",
  linkedAccountName: "三井住友カード",
  amount: 120_000,
  channel: "CARD_PAYMENT",
  label: null,
};

describe("buildCardFlow", () => {
  it("引き落とし元の銀行口座からカードへの線を作る", () => {
    const graph = buildCardFlow({ transfers: [base] });
    expect(graph.nodes.map((n) => n.name)).toEqual(["住信SBIネット銀行", "三井住友カード"]);
    expect(graph.links).toEqual([{ source: 0, target: 1, value: 120_000 }]);
  });

  it("同じ 口座 → カード の組は 1 本にまとめて合算する", () => {
    const graph = buildCardFlow({ transfers: [base, { ...base, amount: 30_000 }] });
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0].value).toBe(150_000);
  });

  it("引き落とし元が未設定なら外部ノードから引く", () => {
    const graph = buildCardFlow({ transfers: [{ ...base, fromAccountName: null }] });
    expect(graph.nodes[0].name).toBe("外部（カード引き落とし）");
    expect(graph.links[0]).toMatchObject({ source: 0, target: 1 });
  });

  it("外部ノードのラベルは label を優先する", () => {
    const graph = buildCardFlow({
      transfers: [{ ...base, fromAccountName: null, label: "給与口座以外" }],
    });
    expect(graph.nodes[0].name).toBe("外部（給与口座以外）");
  });

  it("複数の口座・カードをそれぞれのノードにする", () => {
    const graph = buildCardFlow({
      transfers: [
        base,
        { ...base, fromAccountName: "みずほ銀行", linkedAccountName: "JAL Global Wallet" },
      ],
    });
    expect(graph.nodes.map((n) => n.name)).toEqual([
      "住信SBIネット銀行",
      "三井住友カード",
      "みずほ銀行",
      "JAL Global Wallet",
    ]);
    expect(graph.links).toHaveLength(2);
  });

  it("金額が 0 以下のルールは線にしない", () => {
    expect(buildCardFlow({ transfers: [{ ...base, amount: 0 }] }).links).toHaveLength(0);
  });

  it("ルールが無ければ空のグラフを返す", () => {
    expect(buildCardFlow({ transfers: [] })).toEqual({ nodes: [], links: [] });
  });

  it("チャージはカードからチャージ先カードへの線になる", () => {
    const graph = buildCardFlow({
      transfers: [base],
      charges: [
        { fromCardName: "三井住友カード", toCardName: "JAL Global Wallet", amount: 40_000 },
      ],
    });
    expect(graph.nodes.map((n) => n.name)).toEqual([
      "住信SBIネット銀行",
      "三井住友カード",
      "JAL Global Wallet",
    ]);
    expect(graph.links).toEqual([
      { source: 0, target: 1, value: 120_000 },
      { source: 1, target: 2, value: 40_000 },
    ]);
  });

  it("銀行口座からのチャージは銀行ノードからカードへの線になる", () => {
    const graph = buildCardFlow({
      transfers: [],
      bankCharges: [{ fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 48_000 }],
    });
    expect(graph.nodes.map((n) => n.name)).toEqual(["PAyPay銀行", "PayPay"]);
    expect(graph.links).toEqual([{ source: 0, target: 1, value: 48_000 }]);
  });

  it("引き落としと銀行からのチャージが同じ 口座 → カード なら 1 本にまとめる", () => {
    const graph = buildCardFlow({
      transfers: [base],
      bankCharges: [
        { fromBankName: "住信SBIネット銀行", toCardName: "三井住友カード", amount: 20_000 },
      ],
    });
    expect(graph.nodes.map((n) => n.name)).toEqual(["住信SBIネット銀行", "三井住友カード"]);
    expect(graph.links).toEqual([{ source: 0, target: 1, value: 140_000 }]);
  });

  it("同じ名前の銀行口座とカードは別のノードになる", () => {
    // PayPay銀行から PayPay へのチャージのように、名前が似ていても銀行とカードは別ノード
    const graph = buildCardFlow({
      transfers: [],
      bankCharges: [{ fromBankName: "PayPay", toCardName: "PayPay", amount: 10_000 }],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.links).toEqual([{ source: 0, target: 1, value: 10_000 }]);
  });

  it("固定決済はカードから摘要名のノードへの線になる", () => {
    const graph = buildCardFlow({
      transfers: [base],
      recurring: [{ cardName: "三井住友カード", label: "Netflix", amount: 1_890 }],
    });
    expect(graph.nodes.map((n) => n.name)).toEqual([
      "住信SBIネット銀行",
      "三井住友カード",
      "Netflix",
    ]);
    expect(graph.links[1]).toEqual({ source: 1, target: 2, value: 1_890 });
  });

  it("同じカードの同じ摘要の固定決済は合算する", () => {
    const graph = buildCardFlow({
      transfers: [],
      recurring: [
        { cardName: "三井住友カード", label: "携帯料金", amount: 3_000 },
        { cardName: "三井住友カード", label: "携帯料金", amount: 1_500 },
      ],
    });
    expect(graph.links).toEqual([{ source: 0, target: 1, value: 4_500 }]);
  });

  it("チャージ先が自分自身の線は描かない", () => {
    const graph = buildCardFlow({
      transfers: [],
      charges: [{ fromCardName: "三井住友カード", toCardName: "三井住友カード", amount: 1_000 }],
    });
    expect(graph.links).toHaveLength(0);
  });
});

describe("aggregateCharges", () => {
  it("同じ組の明細を合計して月あたりに均す", () => {
    const result = aggregateCharges(
      [
        { fromCardName: "三井住友カード", toCardName: "JGW", amount: 30_000 },
        { fromCardName: "三井住友カード", toCardName: "JGW", amount: 60_000 },
      ],
      3,
    );
    expect(result).toEqual([{ fromCardName: "三井住友カード", toCardName: "JGW", amount: 30_000 }]);
  });

  it("返金（マイナス）は差し引く", () => {
    const result = aggregateCharges(
      [
        { fromCardName: "A", toCardName: "B", amount: 10_000 },
        { fromCardName: "A", toCardName: "B", amount: -4_000 },
      ],
      1,
    );
    expect(result[0].amount).toBe(6_000);
  });

  it("純額が 0 以下になった組は除く", () => {
    const result = aggregateCharges(
      [
        { fromCardName: "A", toCardName: "B", amount: 5_000 },
        { fromCardName: "A", toCardName: "B", amount: -5_000 },
      ],
      1,
    );
    expect(result).toEqual([]);
  });

  it("月数が 0 以下でも 1 か月として扱う（0 除算を避ける）", () => {
    const result = aggregateCharges([{ fromCardName: "A", toCardName: "B", amount: 1_000 }], 0);
    expect(result[0].amount).toBe(1_000);
  });

  it("組ごとに別々の線を返す", () => {
    const result = aggregateCharges(
      [
        { fromCardName: "A", toCardName: "B", amount: 3_000 },
        { fromCardName: "A", toCardName: "C", amount: 6_000 },
      ],
      3,
    );
    expect(result).toHaveLength(2);
  });
});

describe("hasCardFlowCycle", () => {
  it("チャージが循環していれば true", () => {
    expect(
      hasCardFlowCycle([
        { fromCardName: "A", toCardName: "B", amount: 1 },
        { fromCardName: "B", toCardName: "A", amount: 1 },
      ]),
    ).toBe(true);
  });

  it("自分自身へのチャージも循環扱い", () => {
    expect(hasCardFlowCycle([{ fromCardName: "A", toCardName: "A", amount: 1 }])).toBe(true);
  });

  it("一方向に流れているだけなら false", () => {
    expect(
      hasCardFlowCycle([
        { fromCardName: "A", toCardName: "B", amount: 1 },
        { fromCardName: "B", toCardName: "C", amount: 1 },
      ]),
    ).toBe(false);
  });

  it("金額が 0 以下の線は循環判定に含めない", () => {
    expect(
      hasCardFlowCycle([
        { fromCardName: "A", toCardName: "B", amount: 1 },
        { fromCardName: "B", toCardName: "A", amount: 0 },
      ]),
    ).toBe(false);
  });
});

describe("aggregateBankCharges", () => {
  it("同じ組の明細を合計して月あたりに均す", () => {
    expect(
      aggregateBankCharges(
        [
          { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 30_000 },
          { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 60_000 },
        ],
        3,
      ),
    ).toEqual([{ fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 30_000 }]);
  });

  it("返金（マイナス）は差し引く", () => {
    expect(
      aggregateBankCharges(
        [
          { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 30_000 },
          { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: -6_000 },
        ],
        1,
      ),
    ).toEqual([{ fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 24_000 }]);
  });

  it("純額が 0 以下になった組は除く", () => {
    expect(
      aggregateBankCharges(
        [
          { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 10_000 },
          { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: -10_000 },
        ],
        1,
      ),
    ).toEqual([]);
  });

  it("組ごとに別々の線を返す", () => {
    const result = aggregateBankCharges(
      [
        { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 30_000 },
        { fromBankName: "住信SBIネット銀行", toCardName: "JAL Global Wallet", amount: 20_000 },
      ],
      1,
    );
    expect(result).toHaveLength(2);
  });

  it("元の配列を書き換えない（合算は複製した上で行う）", () => {
    const txns = [
      { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 30_000 },
      { fromBankName: "PAyPay銀行", toCardName: "PayPay", amount: 60_000 },
    ];
    aggregateBankCharges(txns, 1);
    expect(txns[0].amount).toBe(30_000);
  });
});
