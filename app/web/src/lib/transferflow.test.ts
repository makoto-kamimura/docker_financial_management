import { describe, expect, it } from "vitest";
import { buildTransferFlow, hasCycle, type TransferInput } from "@/lib/transferflow";

const T = (fromId: number, fromName: string, toId: number, toName: string, amount: number): TransferInput => ({
  fromId, fromName, toId, toName, amount,
});

describe("buildTransferFlow", () => {
  it("口座をノード、振替をリンクとして構築する", () => {
    const graph = buildTransferFlow([
      T(1, "給与口座", 2, "引き落とし口座", 250000),
      T(1, "給与口座", 3, "貯蓄口座", 100000),
    ]);
    expect(graph.nodes.map((n) => n.name)).toEqual(["給与口座", "引き落とし口座", "貯蓄口座"]);
    expect(graph.links).toHaveLength(2);
    expect(graph.links[0]).toEqual({ source: 0, target: 1, value: 250000 });
    expect(graph.links[1]).toEqual({ source: 0, target: 2, value: 100000 });
  });

  it("同一口座IDは1ノードに集約する", () => {
    const graph = buildTransferFlow([
      T(1, "給与", 2, "A", 100),
      T(1, "給与", 3, "B", 200),
    ]);
    expect(graph.nodes).toHaveLength(3); // 給与, A, B
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
  it("自己ループは true", () => {
    expect(hasCycle([T(1, "A", 1, "A", 100)])).toBe(true);
  });
});
