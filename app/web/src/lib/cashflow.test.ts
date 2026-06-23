import { describe, expect, it } from "vitest";
import { buildCashFlow } from "@/lib/cashflow";

describe("buildCashFlow", () => {
  it("売上総利益・営業利益を算出する", () => {
    const r = buildCashFlow({ revenue: 1000, cogs: 400, expense: 200 });
    expect(r.grossProfit).toBe(600);
    expect(r.operatingProfit).toBe(400);
  });

  it("売上→原価/総利益、総利益→販管費/営業利益のリンクを生成する", () => {
    const { graph } = buildCashFlow({ revenue: 1000, cogs: 400, expense: 200 });
    const names = graph.nodes.map((n) => n.name);
    expect(names).toContain("売上高");
    expect(names).toContain("売上総利益");
    expect(names).toContain("営業利益");

    // 売上高(0) → 売上原価 の値は cogs=400
    const revenueIdx = names.indexOf("売上高");
    const cogsIdx = names.indexOf("売上原価");
    const link = graph.links.find((l) => l.source === revenueIdx && l.target === cogsIdx);
    expect(link?.value).toBe(400);
  });

  it("値が0以下のフローは除外する（営業損失）", () => {
    // 販管費が総利益を上回る → 営業利益は負 → 営業利益ノード/リンクなし
    const { graph, operatingProfit } = buildCashFlow({ revenue: 1000, cogs: 400, expense: 800 });
    expect(operatingProfit).toBe(-200);
    expect(graph.nodes.map((n) => n.name)).not.toContain("営業利益");
  });

  it("使用されないノードは含めない（リンク整合性）", () => {
    const { graph } = buildCashFlow({ revenue: 1000, cogs: 400, expense: 200 });
    const nodeCount = graph.nodes.length;
    for (const link of graph.links) {
      expect(link.source).toBeLessThan(nodeCount);
      expect(link.target).toBeLessThan(nodeCount);
    }
  });
});
