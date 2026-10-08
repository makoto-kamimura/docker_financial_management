import { describe, expect, it } from "vitest";
import {
  autoAssign,
  membersByRule,
  normalizeForMatch,
  planAllocationApply,
  resolveAssignments,
  splitByRatio,
  type AssignRule,
} from "@/lib/shared/allocation-assign";
import { DEFAULT_ALLOCATION_RULES } from "@/lib/budget/default-allocation-rules";
import { HOME_ACCOUNTS_SEED } from "@/lib/accounting/default-accounts";

// 既定ルールを ID 付きにしたもの（id = 並び順 + 1）
const defaultRules: AssignRule[] = DEFAULT_ALLOCATION_RULES.map((r, i) => ({
  id: i + 1,
  keywords: r.keywords,
  fallbackCategory: r.fallbackCategory ?? null,
  sortOrder: i,
}));
const keyOf = (ruleId: number | null) =>
  ruleId === null ? null : DEFAULT_ALLOCATION_RULES[ruleId - 1].key;

describe("normalizeForMatch", () => {
  it("全角・半角、大文字小文字、空白の違いを無視する", () => {
    expect(normalizeForMatch("ＮＩＳＡ 積立")).toBe(normalizeForMatch("nisa積立"));
  });
});

describe("autoAssign（既定ルール）", () => {
  it("既定の家計科目の振り分けが変わらない", () => {
    const result = Object.fromEntries(
      HOME_ACCOUNTS_SEED.filter((a) => ["COGS", "EXPENSE", "PROFIT"].includes(a.category)).map(
        (a) => [a.name, keyOf(autoAssign(a, defaultRules).ruleId)],
      ),
    );
    expect(result).toMatchObject({
      電気代: "utilities",
      ガス代: "utilities",
      水道代: "utilities",
      固定ネット回線: "communication",
      モバイルネット回線: "communication",
      家賃: "rent",
      "管理費・修繕積立金": "rent", // 「積立」より家賃が先
      医療保険: "insurance",
      生命保険: "insurance",
      自動車保険: "insurance", // 保険料が車関連より先
      学資保険: "insurance", // 保険料が教育費より先
      ガソリン代: "car",
      駐車場代: "car",
      自動車税: "car",
      食費: "food",
      飲料費: "food",
      "日用品/消耗品": "daily",
      被服費: "daily",
      教育費: "education",
      "書籍・雑誌費": "education",
      "娯楽/外食費": "leisure",
      旅行費: "leisure",
      // 社会保険・税はキーワードに当たらず、受け皿へ
      社会保険: "other_fixed",
      健康保険料: "other_fixed",
      住民税: "other_fixed",
      医療費: "other_living",
    });
  });

  it("追加した科目も、名前のキーワードか区分で自動で入る", () => {
    expect(
      keyOf(autoAssign({ name: "ペット保険", category: "EXPENSE" }, defaultRules).ruleId),
    ).toBe("insurance");
    expect(
      keyOf(autoAssign({ name: "つみたてNISA", category: "PROFIT" }, defaultRules).ruleId),
    ).toBe("savings");
    expect(autoAssign({ name: "推し活費", category: "COGS" }, defaultRules)).toEqual({
      ruleId: defaultRules.find((r) => r.fallbackCategory === "COGS")!.id,
      source: "fallback",
    });
    // 受け皿の無い区分で、キーワードにも当たらなければ未分類
    expect(autoAssign({ name: "雑費", category: "PROFIT" }, defaultRules)).toEqual({
      ruleId: null,
      source: "none",
    });
  });
});

describe("resolveAssignments", () => {
  const accounts = [
    { id: 1, code: "A1", name: "電気代", category: "EXPENSE" },
    { id: 2, code: "A2", name: "ガス代", category: "EXPENSE" },
    { id: 3, code: "A3", name: "給与", category: "REVENUE" },
    { id: 4, code: "A4", name: "住宅ローン", category: "LIABILITY" },
    { id: 5, code: "A5", name: "食費", category: "COGS" },
  ];

  it("手動の割り当てを優先し、収入・負債は対象外", () => {
    const utilities = defaultRules.find((r) => r.keywords.includes("電気"))!.id;
    const food = defaultRules.find((r) => r.keywords.includes("食費"))!.id;
    const result = resolveAssignments(accounts, defaultRules, [
      { accountId: 2, ruleId: food }, // ガス代を手で食費へ
      { accountId: 5, ruleId: null }, // 食費を配分から外す
    ]);
    expect(result).toEqual([
      { accountId: 1, ruleId: utilities, source: "keyword" },
      { accountId: 2, ruleId: food, source: "manual" },
      { accountId: 5, ruleId: null, source: "manual" },
    ]);
    expect(membersByRule(result).get(food)).toEqual([2]);
  });

  it("割り当て先のルールが無ければ自動に戻す", () => {
    const [a] = resolveAssignments([accounts[0]], defaultRules, [{ accountId: 1, ruleId: 999 }]);
    expect(a.source).toBe("keyword");
  });
});

describe("splitByRatio", () => {
  it("重みの比率で分け、端数を配って合計を合わせる", () => {
    const r = splitByRatio(
      1000,
      [1, 2, 3],
      new Map([
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
    );
    expect([...r.values()]).toEqual([334, 333, 333]);
    expect(
      splitByRatio(
        900,
        [1, 2],
        new Map([
          [1, 200],
          [2, 100],
        ]),
      ),
    ).toEqual(
      new Map([
        [1, 600],
        [2, 300],
      ]),
    );
  });

  it("重みが無い（0 やマイナスだけ）なら均等に分ける", () => {
    expect([...splitByRatio(100, [1, 2], new Map([[1, -50]])).values()]).toEqual([50, 50]);
  });
});

describe("planAllocationApply", () => {
  it("予算が入っている科目は残し、残りを未設定の科目に按分する", () => {
    const plan = planAllocationApply({
      amount: 30_000,
      accountIds: [1, 2, 3],
      existingBudgets: new Map([[1, 10_000]]),
      weights: new Map([
        [1, 999],
        [2, 3_000],
        [3, 1_000],
      ]),
    });
    expect(plan.kept).toEqual([{ accountId: 1, amount: 10_000 }]);
    expect(plan.remaining).toBe(20_000);
    expect(plan.added).toEqual([
      { accountId: 2, amount: 15_000 },
      { accountId: 3, amount: 5_000 },
    ]);
  });

  it("残りが 0 以下、または未設定の科目が無ければ何も入れない", () => {
    expect(
      planAllocationApply({
        amount: 5_000,
        accountIds: [1, 2],
        existingBudgets: new Map([[1, 8_000]]),
        weights: new Map(),
      }).added,
    ).toEqual([]);
    expect(
      planAllocationApply({
        amount: 5_000,
        accountIds: [1],
        existingBudgets: new Map([[1, 1_000]]),
        weights: new Map(),
      }).added,
    ).toEqual([]);
  });
});
