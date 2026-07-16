import { describe, expect, it } from "vitest";
import { buildMonthlyCashFlow, type MonthlyTxnEdgeInput } from "@/lib/cashflow-monthly";
import type { TransferInput } from "@/lib/transferflow";

describe("buildMonthlyCashFlow", () => {
  it("builds income-source -> account and account -> payment-item edges from categorized transactions", () => {
    const txns: MonthlyTxnEdgeInput[] = [
      {
        accountId: 1,
        accountName: "給与口座",
        amount: 300000,
        categoryAccountId: 10,
        categoryName: "給与",
      },
      {
        accountId: 1,
        accountName: "給与口座",
        amount: -50000,
        categoryAccountId: 20,
        categoryName: "家賃",
      },
    ];
    const { nodes, links } = buildMonthlyCashFlow(txns, []);
    const names = nodes.map((n) => n.name);
    expect(names).toEqual(["給与", "給与口座", "家賃"]);
    expect(links).toEqual([
      { source: 0, target: 1, value: 300000 },
      { source: 1, target: 2, value: 50000 },
    ]);
  });

  it("excludes uncategorized transactions (categoryAccountId is null)", () => {
    const txns: MonthlyTxnEdgeInput[] = [
      {
        accountId: 1,
        accountName: "口座",
        amount: -1000,
        categoryAccountId: null,
        categoryName: null,
      },
    ];
    const { nodes, links } = buildMonthlyCashFlow(txns, []);
    expect(nodes).toHaveLength(0);
    expect(links).toHaveLength(0);
  });

  it("deduplicates account nodes shared between transactions and transfers", () => {
    const txns: MonthlyTxnEdgeInput[] = [
      {
        accountId: 1,
        accountName: "給与口座",
        amount: 300000,
        categoryAccountId: 10,
        categoryName: "給与",
      },
    ];
    const transfers: TransferInput[] = [
      {
        fromId: 1,
        fromName: "給与口座",
        toId: 2,
        toName: "生活費口座",
        amount: 100000,
        channel: "BANK_TRANSFER",
      },
    ];
    const { nodes, links } = buildMonthlyCashFlow(txns, transfers);
    // 給与口座 は txn 側と transfer 側で同一ノード（重複しない）
    const names = nodes.map((n) => n.name);
    expect(names).toEqual(["給与", "給与口座", "生活費口座"]);
    expect(links).toEqual([
      { source: 0, target: 1, value: 300000 },
      { source: 1, target: 2, value: 100000 },
    ]);
  });

  it("routes external transfer endpoints through ext: nodes with the channel or custom label", () => {
    const transfers: TransferInput[] = [
      {
        fromId: null,
        fromName: null,
        toId: 1,
        toName: "口座",
        amount: 5000,
        channel: "INCOME",
        label: null,
      },
      {
        fromId: 1,
        fromName: "口座",
        toId: null,
        toName: null,
        amount: 3000,
        channel: "CARD_PAYMENT",
        label: "楽天カード",
      },
    ];
    const { nodes } = buildMonthlyCashFlow([], transfers);
    const names = nodes.map((n) => n.name);
    expect(names).toContain("外部（入金）");
    expect(names).toContain("外部（楽天カード）");
  });

  it("skips zero/negative transfer amounts and self-loop transfers", () => {
    const transfers: TransferInput[] = [
      {
        fromId: 1,
        fromName: "口座A",
        toId: 1,
        toName: "口座A",
        amount: 1000,
        channel: "BANK_TRANSFER",
      },
      {
        fromId: 1,
        fromName: "口座A",
        toId: 2,
        toName: "口座B",
        amount: 0,
        channel: "BANK_TRANSFER",
      },
    ];
    const { nodes, links } = buildMonthlyCashFlow([], transfers);
    expect(nodes).toHaveLength(0);
    expect(links).toHaveLength(0);
  });
});
