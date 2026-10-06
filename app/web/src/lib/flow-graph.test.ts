import { describe, expect, it } from "vitest";
import { filterFlowGraph } from "./flow-graph";

describe("filterFlowGraph", () => {
  const graph = {
    nodes: [
      { name: "外部（給与）" },
      { name: "給与口座" },
      { name: "貯蓄口座" },
      { name: "外部（家賃）" },
    ],
    links: [
      { source: 0, target: 1, value: 300 },
      { source: 1, target: 2, value: 100 },
      { source: 2, target: 3, value: 80, estimated: true },
    ],
  };

  it("選んだノードにつながる線だけを残し、ノードの番号を振り直す", () => {
    expect(filterFlowGraph(graph, "貯蓄口座")).toEqual({
      nodes: [{ name: "給与口座" }, { name: "貯蓄口座" }, { name: "外部（家賃）" }],
      links: [
        { source: 0, target: 1, value: 100 },
        { source: 1, target: 2, value: 80, estimated: true },
      ],
    });
  });

  it("名前が見つからなければ空の図にする", () => {
    expect(filterFlowGraph(graph, "無い口座")).toEqual({ nodes: [], links: [] });
  });
});
