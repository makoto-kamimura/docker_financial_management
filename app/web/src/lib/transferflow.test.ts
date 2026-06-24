import { describe, expect, it } from "vitest";
import { buildTransferFlow, hasCycle, type TransferInput } from "@/lib/transferflow";

const T = (
  fromId: number | null,
  fromName: string | null,
  toId: number | null,
  toName: string | null,
  amount: number,
  channel: TransferInput["channel"] = "BANK_TRANSFER",
  label?: string,
): TransferInput => ({ fromId, fromName, toId, toName, amount, channel, label });

describe("buildTransferFlow", () => {
  it("口座をノード、振替をリンクとして構築する", () => {
    const graph = buildTransferFlow([
      T(1, "給与口座", 2, "引き落とし口座", 250000),
      T(1, "給与口座", 3, "貯蓄口座", 100000),
    ]);
    expect(graph.nodes.map((n) => n.name)).toEqual(["給与口座", "引き落とし口座", "貯蓄口座"]);
    expect(graph.links).toHaveLength(2);
    expect(graph.links[0]).toEqual({ source: 0, target: 1, value: 250000 });
  });

  it("入金（外部→口座）は外部ノードを生成する", () => {
    const graph = buildTransferFlow([T(null, null, 1, "給与口座", 450000, "INCOME", "給与")]);
    expect(graph.nodes.map((n) => n.name)).toEqual(["外部（給与）", "給与口座"]);
    expect(graph.links[0]).toEqual({ source: 0, target: 1, value: 450000 });
  });

  it("カード引き落とし（口座→外部）は外部ノードを生成する", () => {
    const graph = buildTransferFlow([T(2, "引き落とし口座", null, null, 120000, "CARD_PAYMENT", "楽天カード")]);
    expect(graph.nodes.map((n) => n.name)).toEqual(["引き落とし口座", "外部（楽天カード）"]);
  });

  it("自己振替・0円は除外する", () => {
    const graph = buildTransferFlow([T(1, "A", 1, "A", 100), T(1, "A", 2, "B", 0)]);
    expect(graph.links).toHaveLength(0);
  });
});

describe("hasCycle", () => {
  it("非循環は false", () => {
    expect(hasCycle([T(1, "A", 2, "B", 100), T(2, "B", 3, "C", 50)])).toBe(false);
  });
  it("循環は true", () => {
    expect(hasCycle([T(1, "A", 2, "B", 100), T(2, "B", 1, "A", 50)])).toBe(true);
  });
  it("外部端点は循環に含めない", () => {
    expect(hasCycle([T(null, null, 1, "A", 100), T(1, "A", null, null, 50, "EXPENSE")])).toBe(false);
  });
});
