/**
 * D-5d-4 結合テスト（実 DB 使用・棚卸の確定）
 *
 * 目的: POST /api/inventories/[id]/close が、
 *       (1) 従来 "1200"（当座預金）を誤って参照していたバグを修正し、正しく棚卸資産
 *           科目（1400）へ実績連動すること
 *       (2) 相手科目（仕入高 5000）が整備されていれば、監査証跡の複式仕訳
 *           （Dr 棚卸資産/Cr 仕入高）も作ること
 *       (3) その仕訳は choke-point 同期を呼ばない＝仕入高側の FinancialRecord が
 *           作られない（期末棚卸による売上原価調整は本タスクのスコープ外）こと
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
import { POST as closePost } from "./[id]/close/route";

const SUFFIX = `d5d4inv_${Date.now()}`;

function makeReq() {
  return {
    method: "POST",
    nextUrl: new URL("http://x"),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("{}"),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let tenantId: number;
let stockAccountId: number;
let cogsAccountId: number;
let wrongAccountId: number; // 旧バグが参照していた "1200"（当座預金）— 汚染されないことの確認用

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: `D5D4INV_${SUFFIX}` } });
  tenantId = tenant.id;

  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `d5d4inv_${SUFFIX}@example.com`,
      name: "D-5d-4 Inventory Test User",
      passwordHash: "x",
      role: "admin",
    },
  });

  const [stock, cogs, wrong] = await Promise.all([
    prisma.account.create({
      data: { tenantId, code: "1400", name: "棚卸資産", category: "ASSET" },
    }),
    prisma.account.create({
      data: { tenantId, code: "5000", name: "仕入高", category: "COGS" },
    }),
    prisma.account.create({
      data: { tenantId, code: "1200", name: "当座預金", category: "ASSET" },
    }),
  ]);
  stockAccountId = stock.id;
  cogsAccountId = cogs.id;
  wrongAccountId = wrong.id;

  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
});

afterAll(async () => {
  if (!tenantId) return;
  await prisma.financialRecordHistory.deleteMany({ where: { record: { tenantId } } });
  await prisma.financialRecord.deleteMany({ where: { tenantId } });
  await prisma.journalDetail.deleteMany({ where: { journalEntry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.inventoryItem.deleteMany({ where: { inventory: { tenantId } } });
  await prisma.inventory.deleteMany({ where: { tenantId } });
  await prisma.period.deleteMany({ where: { tenantId } });
  await prisma.account.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("D-5d-4: 棚卸確定の実績連動バグ修正 + 監査証跡仕訳", () => {
  it("棚卸資産（1400）へ正しく実績連動し、当座預金（1200）は汚染しない。仕入高への監査証跡仕訳も作る", async () => {
    const inventory = await prisma.inventory.create({
      data: {
        tenantId,
        name: "D-5d-4 検証棚卸",
        inventoryDate: new Date("2026-06-30"),
        totalAmount: 250_000,
      },
    });

    const res = await closePost(makeReq(), params(inventory.id));
    expect(res.status).toBe(200);

    const stockRecords = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: stockAccountId },
    });
    expect(stockRecords).toHaveLength(1);
    expect(Number(stockRecords[0].amount)).toBe(250_000);
    expect(stockRecords[0].journalEntryId).toBeNull();

    // バグ修正の回帰確認: 当座預金（1200）には何も書き込まれない
    const wrongRecords = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: wrongAccountId },
    });
    expect(wrongRecords).toHaveLength(0);

    const entry = await prisma.journalEntry.findFirst({
      where: { tenantId, description: "棚卸確定（D-5d-4 検証棚卸）（自動仕訳）" },
      include: { details: { orderBy: { side: "asc" } } },
    });
    expect(entry).not.toBeNull();
    expect(entry!.details.map((d) => [d.side, d.accountId, Number(d.amount)])).toEqual([
      ["credit", cogsAccountId, 250_000],
      ["debit", stockAccountId, 250_000],
    ]);

    // 監査証跡の仕訳は choke-point 同期を呼ばない = 仕入高側の FinancialRecord は作られない
    const cogsRecords = await prisma.financialRecord.findMany({
      where: { tenantId, accountId: cogsAccountId },
    });
    expect(cogsRecords).toHaveLength(0);
  });
});
