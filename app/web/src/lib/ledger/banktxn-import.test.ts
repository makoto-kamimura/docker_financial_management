import { describe, expect, it } from "vitest";
import {
  classifyByRules,
  normalizeKeyword,
  parseBankCsv,
  ruleSideOf,
} from "@/lib/ledger/banktxn-import";

describe("normalizeKeyword", () => {
  it("trims, collapses whitespace, and uppercases", () => {
    expect(normalizeKeyword("  amazon   co jp  ")).toBe("AMAZON CO JP");
  });
});

describe("classifyByRules", () => {
  const rules = [
    { keyword: "amazon", categoryAccountId: 1, priority: 0 },
    { keyword: "amazon prime", categoryAccountId: 2, priority: 0 },
    { keyword: "electric", categoryAccountId: 3, priority: 0 },
  ];

  it("matches a case-insensitive substring of the description", () => {
    expect(classifyByRules("AMAZON.CO.JP PURCHASE", rules)?.categoryAccountId).toBe(1);
  });

  it("prefers the longer keyword when multiple rules match (more specific wins)", () => {
    expect(classifyByRules("AMAZON PRIME MEMBERSHIP", rules)?.categoryAccountId).toBe(2);
  });

  it("prioritizes higher-priority rules over keyword length", () => {
    const withPriority = [
      { keyword: "amazon", categoryAccountId: 1, priority: 0 },
      { keyword: "am", categoryAccountId: 99, priority: 100 }, // 手動学習ルール想定
    ];
    expect(classifyByRules("AMAZON.CO.JP", withPriority)?.categoryAccountId).toBe(99);
  });

  it("returns null when no rule matches", () => {
    expect(classifyByRules("UNKNOWN MERCHANT", rules)).toBeNull();
  });

  describe("flow side", () => {
    const sided = [
      { keyword: "府民共済", categoryAccountId: 10, priority: 100, flowSide: "OUT" as const },
      { keyword: "府民共済", categoryAccountId: 20, priority: 100, flowSide: "IN" as const },
      { keyword: "共済", categoryAccountId: 30, priority: 100, flowSide: "ANY" as const },
    ];

    it("only uses rules for the entry's side (plus ANY)", () => {
      expect(classifyByRules("府民共済", sided, "OUT")?.categoryAccountId).toBe(10);
      expect(classifyByRules("府民共済", sided, "IN")?.categoryAccountId).toBe(20);
      // 向きが無い（0 円）なら ANY だけ
      expect(classifyByRules("府民共済", sided, null)?.categoryAccountId).toBe(30);
    });

    it("prefers a sided rule over ANY with the same keyword", () => {
      const rules = [
        { keyword: "府民共済", categoryAccountId: 1, priority: 100, flowSide: "ANY" as const },
        { keyword: "府民共済", categoryAccountId: 2, priority: 100, flowSide: "OUT" as const },
      ];
      expect(classifyByRules("府民共済", rules, "OUT")?.categoryAccountId).toBe(2);
      expect(classifyByRules("府民共済", rules, "IN")?.categoryAccountId).toBe(1);
    });

    it("treats rules without flowSide as ANY", () => {
      expect(classifyByRules("AMAZON", rules, "IN")?.categoryAccountId).toBe(1);
    });

    it("ruleSideOf reads the flow sign (+ in / − out)", () => {
      expect(ruleSideOf(11_275)).toBe("IN");
      expect(ruleSideOf(-3_000)).toBe("OUT");
      expect(ruleSideOf(0)).toBeNull();
    });
  });
});

describe("parseBankCsv", () => {
  it("parses valid rows and generates a deterministic externalId", () => {
    const csv = "date,description,amount\n2026-01-05,食料品,-3000\n";
    const { rows, errors } = parseBankCsv(csv, 42);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-01-05", description: "食料品", amount: -3000 });
    expect(rows[0].externalId).toBe("csv-42-2026-01-05--3000-食料品");
  });

  it("collects validation errors for invalid rows without throwing", () => {
    const csv = "date,description,amount\n,,notanumber\n";
    const { rows, errors } = parseBankCsv(csv, 1);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});
