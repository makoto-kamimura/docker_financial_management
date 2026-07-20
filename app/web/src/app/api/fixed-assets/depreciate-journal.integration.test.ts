/**
 * D-5d-4 結合テスト（実 DB 使用・固定資産の減価償却）
 *
 * 目的: POST /api/fixed-assets/[id]/depreciate が、
 *       (1) 従来存在しない "H3400" を参照していたバグを修正し、実在する償却費科目
 *           （7600 / C7300）へ正しく実績連動すること
 *       (2) 対照科目（減価償却累計額）が整備されていれば、監査証跡の複式仕訳
 *           （Dr 減価償却費/Cr 減価償却累計額）も作ること
 *       (3) その仕訳は choke-point 同期を呼ばない＝償却費側の FinancialRecord が
 *           二重計上されないこと
 *       (4) 対照科目が未整備でも、直接書き込み（従来どおりの単側連動）は成功すること
 *       を検証する。
 *
 * 実行: `npm run test:integration`（platform-db 起動が前提）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(async () => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/prisma";
import { POST as depreciatePost } from "./[id]/depreciate/route";

const SUFFIX = `d5d4dep_${Date.now()}`;

function makeReq(url: string) {
  return {
    method: "POST",
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("{}"),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let tenantId: number;
let expenseAccountId: number;
let accumulatedAccountId: number;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: `D5D4DEP_${SUFFIX}` } });
  tenantId = tenant.id;

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `d5d4dep_${SUFFIX}@example.com`,
      name: "D-5d-4 Depreciation Test User",
      passwordHash: "x",
      role: "admin",
    },
  });

  const [expense, accumulated] = await Promise.all([
    prisma.account.create({
      data: { tenantId, code: "7600", name: "減価償却費", category: "EXPENSE" },
    }),
    prisma.account.create({
      data: { tenantId, code: "2400", name: "減価償却累計額", category: "ASSET" },
    }),
  ]);
  expenseAccountId = expense.id;
  accumulatedAccountId = accumulated.id;

  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
});

afterAll(async () => {
  if (!tenantId) return;
  await prisma.financialRecordHistory.deleteMany({ where: { record: { tenantId } } });
  await prisma.financialRecord.deleteMany({ where: { tenantId } });
  await prisma.journalDetail.deleteMany({ where: { journalEntry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.depreciation.deleteMany({ where: { fixedAsset: { tenantId } } });
  await prisma.fixedAsset.deleteMany({ where: { tenantId } });
  await prisma.period.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("D-5d-4: 減価償却の実績連動バグ修正 + 監査証跡仕訳", () => {
  it("対照科目（減価償却累計額）が整備済みなら FinancialRecord + 監査証跡仕訳の両方を作る", async () => {
    const asset = await prisma.fixedAsset.create({
      data: {
        tenantId,
        name: "D-5d-4 検証機材",
        acquiredOn: new Date("2024-01-01"),
        acquisitionCost: 1_200_000,
        usefulLife: 5,
        method: "straight",
        residualRate: 0.1,
        bookValue: 1_200_000,
      },
    });

    const res = await depreciatePost(makeReq(`http://x?year=2026`), params(asset.id));
    expect(res.status).toBe(201);

    // バグ修正: 従来は存在しない "H3400" 参照で常に no-op だったが、7600 へ正しく実績連動する
    const records = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: expenseAccountId },
    });
    expect(records).toHaveLength(1);
    const expectedAmount = Math.floor((1_200_000 - 1_200_000 * 0.1) / 5);
    expect(Number(records[0].amount)).toBe(expectedAmount);
    expect(records[0].journalEntryId).toBeNull(); // choke-point 経由ではない単側直接書き込み

    const entry = await prisma.journalEntry.findFirst({
      where: { tenantId, description: `${asset.name} 2026年度償却（自動仕訳）` },
      include: { details: { orderBy: { side: "asc" } } },
    });
    expect(entry).not.toBeNull();
    expect(entry!.details.map((d) => [d.side, d.accountId, Number(d.amount)])).toEqual([
      ["credit", accumulatedAccountId, expectedAmount],
      ["debit", expenseAccountId, expectedAmount],
    ]);

    // 監査証跡の仕訳は choke-point 同期を呼ばない = 償却費 FinancialRecord が二重計上されない
    const allExpenseRecords = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: expenseAccountId },
    });
    expect(allExpenseRecords).toHaveLength(1);
  });

  it("対照科目が未整備のテナントでは仕訳は作らず、直接書き込みだけが従来どおり成功する", async () => {
    const otherTenant = await prisma.tenant.create({ data: { name: `D5D4DEP_noacc_${SUFFIX}` } });
    const otherUser = await prisma.user.create({
      data: {
        tenantId: otherTenant.id,
        email: `d5d4dep_noacc_${SUFFIX}@example.com`,
        name: "No Account User",
        passwordHash: "x",
        role: "admin",
      },
    });
    const expenseOnly = await prisma.account.create({
      data: { tenantId: otherTenant.id, code: "7600", name: "減価償却費", category: "EXPENSE" },
    });
    actingUser = {
      id: otherUser.id,
      tenantId: otherTenant.id,
      role: "admin",
      email: otherUser.email,
      name: otherUser.name,
    };

    try {
      const asset = await prisma.fixedAsset.create({
        data: {
          tenantId: otherTenant.id,
          name: "対照科目なし機材",
          acquiredOn: new Date("2024-01-01"),
          acquisitionCost: 600_000,
          usefulLife: 3,
          method: "straight",
          residualRate: 0.1,
          bookValue: 600_000,
        },
      });

      const res = await depreciatePost(makeReq(`http://x?year=2026`), params(asset.id));
      expect(res.status).toBe(201);

      const records = await prisma.financialRecord.findMany({
        where: { tenantId: otherTenant.id, accountId: expenseOnly.id },
      });
      expect(records).toHaveLength(1);

      const entry = await prisma.journalEntry.findFirst({ where: { tenantId: otherTenant.id } });
      expect(entry).toBeNull();
    } finally {
      await prisma.financialRecordHistory.deleteMany({
        where: { record: { tenantId: otherTenant.id } },
      });
      await prisma.financialRecord.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.depreciation.deleteMany({ where: { fixedAsset: { tenantId: otherTenant.id } } });
      await prisma.fixedAsset.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.period.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.account.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.user.deleteMany({ where: { tenantId: otherTenant.id } });
      await prisma.tenant.delete({ where: { id: otherTenant.id } });
      actingUser = { id: 0, tenantId, role: "admin", email: "", name: "" };
    }
  });
});
