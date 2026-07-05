import { describe, expect, it, vi } from "vitest";
import type { Account, AccountMappingRule } from "@prisma/client";

const findManyMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    accountMappingRule: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

const { badgeFor, isHomeAccountCode, suggestConversions } = await import("@/lib/account-conversion");

function acc(overrides: Partial<Account>): Account {
  return {
    id: 1,
    tenantId: 1,
    code: "0000",
    name: "テスト科目",
    category: "EXPENSE",
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Account;
}

function rule(overrides: Partial<AccountMappingRule>): AccountMappingRule {
  return {
    id: 1,
    homeCode: "H-9000",
    corporateCode: null,
    matchType: "TABLE",
    confidenceScore: 1.0,
    isConvertible: true,
    notes: null,
    userId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AccountMappingRule;
}

describe("isHomeAccountCode", () => {
  it("H- で始まるコードのみ家庭モード科目と判定する", () => {
    expect(isHomeAccountCode("H-1001")).toBe(true);
    expect(isHomeAccountCode("H1000")).toBe(false);
    expect(isHomeAccountCode("4000")).toBe(false);
  });
});

describe("suggestConversions", () => {
  it("システム定義ルール（TABLE）で変換先を確定する", async () => {
    findManyMock.mockResolvedValueOnce([
      rule({ homeCode: "H-3001", corporateCode: "7200", confidenceScore: 1.0 }),
    ]);
    const home = [acc({ id: 10, code: "H-3001", name: "電気代", category: "EXPENSE" })];
    const corp = [acc({ id: 20, code: "7200", name: "水道光熱費", category: "EXPENSE" })];

    const [s] = await suggestConversions(1, home, corp);
    expect(s.matchType).toBe("TABLE");
    expect(s.corporateAccountId).toBe(20);
    expect(s.isManuallyOverridden).toBe(false);
  });

  it("ユーザー独自ルールをシステムルールより優先する", async () => {
    findManyMock.mockResolvedValueOnce([
      rule({ homeCode: "H-3001", corporateCode: "7200", userId: null }),
      rule({ homeCode: "H-3001", corporateCode: "8300", userId: 5, id: 2 }),
    ]);
    const home = [acc({ id: 10, code: "H-3001", name: "電気代", category: "EXPENSE" })];
    const corp = [
      acc({ id: 20, code: "7200", name: "水道光熱費", category: "EXPENSE" }),
      acc({ id: 21, code: "8300", name: "雑費", category: "EXPENSE" }),
    ];

    const [s] = await suggestConversions(5, home, corp);
    expect(s.corporateAccountId).toBe(21);
    expect(s.matchType).toBe("MANUAL");
    expect(s.isManuallyOverridden).toBe(true);
  });

  it("ルールが無ければキーワード一致で変換先を推定する", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const home = [acc({ id: 11, code: "H-9999", name: "自動車保険", category: "EXPENSE" })];
    const corp = [acc({ id: 22, code: "8100", name: "損害保険料", category: "EXPENSE" })];

    const [s] = await suggestConversions(1, home, corp);
    expect(s.matchType).toBe("KEYWORD");
    expect(s.corporateAccountId).toBe(22);
    expect(s.confidenceScore).toBe(0.9);
  });

  it("キーワードが無ければあいまい一致（名称類似度）で推定する", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const home = [acc({ id: 12, code: "H-9998", name: "書斎用品費", category: "EXPENSE" })];
    const corp = [
      acc({ id: 23, code: "9100", name: "事務用品費", category: "EXPENSE" }),
      acc({ id: 24, code: "7900", name: "広告宣伝費", category: "EXPENSE" }),
    ];

    const [s] = await suggestConversions(1, home, corp);
    expect(s.matchType).toBe("FUZZY");
    expect(s.corporateAccountId).toBe(23);
  });

  it("あいまい一致もなければカテゴリ別フォールバック（AI_FREE 疑似AI）を返す", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const home = [acc({ id: 13, code: "H-9997", name: "推し活費", category: "EXPENSE" })];
    const corp = [acc({ id: 25, code: "8300", name: "雑費", category: "EXPENSE" })];

    const [s] = await suggestConversions(1, home, corp);
    expect(s.matchType).toBe("AI_FREE");
    expect(s.corporateAccountId).toBe(25);
    expect(s.confidenceScore).toBe(0.4);
  });

  it("何にも一致しなければ手動マッピング必須として返す", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const home = [acc({ id: 14, code: "H-9996", name: "推し活費", category: "ASSET" })];
    const corp = [acc({ id: 26, code: "1000", name: "現金", category: "ASSET" })];

    const [s] = await suggestConversions(1, home, corp);
    expect(s.matchType).toBe("MANUAL");
    expect(s.corporateAccountId).toBeNull();
    expect(s.isConvertible).toBe(false);
  });
});

describe("badgeFor", () => {
  it("変換不可フラグがあれば unconvertible", () => {
    expect(badgeFor({ isConvertible: false, confidenceScore: 1, corporateAccountId: 1 })).toBe(
      "unconvertible",
    );
  });
  it("変換先未確定なら manual", () => {
    expect(badgeFor({ isConvertible: true, confidenceScore: null, corporateAccountId: null })).toBe(
      "manual",
    );
  });
  it("信頼度80%以上なら auto", () => {
    expect(badgeFor({ isConvertible: true, confidenceScore: 0.9, corporateAccountId: 1 })).toBe("auto");
  });
  it("信頼度50〜79%なら review", () => {
    expect(badgeFor({ isConvertible: true, confidenceScore: 0.6, corporateAccountId: 1 })).toBe(
      "review",
    );
  });
  it("信頼度50%未満なら manual", () => {
    expect(badgeFor({ isConvertible: true, confidenceScore: 0.3, corporateAccountId: 1 })).toBe(
      "manual",
    );
  });
});
