/**
 * API 結合テスト（Prisma モック版）
 * DB に接続せず、Route Handler のビジネスロジック・バリデーション・レスポンス形式を検証する。
 */
import { describe, it, expect, vi } from "vitest";

// ── Prisma モック ─────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    taxSetting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    journalEntry: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    journalDetail: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    journalApproval: {
      create: vi.fn(),
    },
    businessProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    inventory: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    loan: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    loanRepayment: {
      create: vi.fn(),
    },
    tenant: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    officer: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    financialRecord: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    apportionment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    fiscalYearClose: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn().mockImplementation(async (ops: unknown[]) => {
      return Promise.all(ops.map((op) => (typeof op === "function" ? op() : op)));
    }),
  },
}));

// tenantDb() は本来 prisma.$extends() でテナント自動スコープを行うが、
// ここではモック済み prisma をそのまま返す（拡張ロジック自体の検証は tenant-db.ts 側で行う）。
vi.mock("@/lib/tenant-db", async () => {
  const { prisma } = await import("@/lib/prisma");
  return { tenantDb: () => prisma };
});

// ── 認証モック（常に admin として通過）────────────────────────────────────
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn().mockResolvedValue({
    user: { id: 1, email: "admin@example.com", name: "Admin", role: "admin", tenantId: 1 },
  }),
}));

// ── Redis モック（キャッシュ無効化）──────────────────────────────────────
vi.mock("@/lib/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

// ── NextRequest ヘルパー ──────────────────────────────────────────────────
function makeReq(method: string, url: string, body?: unknown) {
  const req = {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
    // FormData は今回のテスト対象外
  } as unknown as import("next/server").NextRequest;
  return req;
}

// ── テスト群 ──────────────────────────────────────────────────────────────

describe("GET /api/tax-settings", () => {
  it("200 と data 配列を返す", async () => {
    const { GET } = await import("@/app/api/tax-settings/route");
    const req = makeReq("GET", "http://localhost:3000/api/tax-settings");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });
});

describe("PUT /api/tax-settings", () => {
  it("taxYear・taxationType が必須", async () => {
    const { PUT } = await import("@/app/api/tax-settings/route");
    const req = makeReq("PUT", "http://localhost:3000/api/tax-settings", {});
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });

  it("有効なボディで upsert を呼ぶ", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.taxSetting.upsert as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      taxYear: 2026,
      taxationType: "general",
      simplifiedRate: null,
    });
    const { PUT } = await import("@/app/api/tax-settings/route");
    const req = makeReq("PUT", "http://localhost:3000/api/tax-settings", {
      taxYear: 2026,
      taxationType: "general",
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(prisma.taxSetting.upsert).toHaveBeenCalled();
  });
});

describe("GET /api/inventories", () => {
  it("200 と data 配列を返す", async () => {
    const { GET } = await import("@/app/api/inventories/route");
    const req = makeReq("GET", "http://localhost:3000/api/inventories");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });
});

describe("POST /api/inventories", () => {
  it("name と inventoryDate が必須", async () => {
    const { POST } = await import("@/app/api/inventories/route");
    const req = makeReq("POST", "http://localhost:3000/api/inventories", { items: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("valuationMethod が保存される", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.inventory.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      name: "test",
      valuationMethod: "average",
      items: [],
    });
    const { POST } = await import("@/app/api/inventories/route");
    const req = makeReq("POST", "http://localhost:3000/api/inventories", {
      name: "テスト棚卸",
      inventoryDate: "2026-06-01",
      valuationMethod: "average",
      items: [],
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const call = (prisma.inventory.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.valuationMethod).toBe("average");
  });
});

describe("GET /api/tax-credit", () => {
  it("year パラメータで集計を返す", async () => {
    const { GET } = await import("@/app/api/tax-credit/route");
    const req = makeReq("GET", "http://localhost:3000/api/tax-credit?year=2026");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.year).toBe(2026);
    expect(typeof json.data.creditableTax).toBe("number");
  });
});

describe("GET /api/journals/approve", () => {
  it("承認待ち一覧を返す", async () => {
    const { GET } = await import("@/app/api/journals/approve/route");
    const req = makeReq("GET", "http://localhost:3000/api/journals/approve?status=pending");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });
});

describe("POST /api/journals/approve", () => {
  it("journalEntryId と action が必須", async () => {
    const { POST } = await import("@/app/api/journals/approve/route");
    const req = makeReq("POST", "http://localhost:3000/api/journals/approve", {});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("無効な action は 400 を返す", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.journalEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      tenantId: 1,
    });
    const { POST } = await import("@/app/api/journals/approve/route");
    const req = makeReq("POST", "http://localhost:3000/api/journals/approve", {
      journalEntryId: 1,
      action: "invalid",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("submit アクションで approvalStatus が pending になる", async () => {
    const { prisma } = await import("@/lib/prisma");
    (prisma.journalEntry.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      tenantId: 1,
    });
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 1, approvalStatus: "pending" },
      { id: 1, action: "submitted" },
    ]);
    const { POST } = await import("@/app/api/journals/approve/route");
    const req = makeReq("POST", "http://localhost:3000/api/journals/approve", {
      journalEntryId: 1,
      action: "submit",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});

describe("GET /api/loans", () => {
  it("200 と data 配列を返す", async () => {
    const { GET } = await import("@/app/api/loans/route");
    const req = makeReq("GET", "http://localhost:3000/api/loans");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });
});

describe("GET /api/tenants", () => {
  it("200 と data 配列を返す", async () => {
    const { GET } = await import("@/app/api/tenants/route");
    const req = makeReq("GET", "http://localhost:3000/api/tenants");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });
});

describe("GET /api/closing/statements", () => {
  it("fiscalYear と ratios を含むレスポンスを返す", async () => {
    const { GET } = await import("@/app/api/closing/statements/route");
    const req = makeReq("GET", "http://localhost:3000/api/closing/statements?year=2026");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fiscalYear).toBe(2026);
    expect(json).toHaveProperty("pnl");
    expect(json).toHaveProperty("bs");
    expect(json).toHaveProperty("ratios");
  });
});

describe("GET /api/business-profile", () => {
  it("200 を返す（データなし時は data: null）", async () => {
    const { GET } = await import("@/app/api/business-profile/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
