/**
 * チャージの紐付けの候補と自動相殺の結合テスト（実 DB 使用）
 *
 *   - チャージ先のカードに新しい明細がたくさんあっても、古い日付のチャージの候補が出る
 *   - 自動相殺: 同じ日・同じ金額の入金が複数あっても、摘要に銀行名が出ている入金と組む
 *   - 自動相殺: 取り込みのルールでチャージ先だけ付いたカードの出金も、チャージ先の入金と組む
 *
 * 実行: `npm run test:integration`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/server/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/server/authz", () => ({
  requireRole: vi.fn(async () => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/server/prisma";
import { tenantDb } from "@/lib/server/tenant-db";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { applyAutoOffset } from "@/lib/ledger/auto-offset";
import { GET as candidatesGet } from "./charge-links/candidates/route";

const SUFFIX = `chlink_${Date.now()}`;
const YEAR = 2034;

function makeReq(method: string, url: string) {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("{}"),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}

let tenantId: number;
let bankId: number;
let creditId: number;
let walletId: number;
const periodIds = new Map<number, number>();

beforeAll(async () => {
  for (const t of ["tenants", "users", "periods", "financial_records"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "チャージテスト",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };

  const [bank, credit, wallet] = await Promise.all([
    prisma.bankAccount.create({
      data: { tenantId, name: "住信SBIネット銀行", bankName: "住信SBIネット銀行" },
    }),
    prisma.linkedAccount.create({
      data: {
        tenantId,
        name: "三井住友カード",
        type: "CREDIT_CARD",
        institution: "三井住友カード",
      },
    }),
    prisma.linkedAccount.create({
      data: { tenantId, name: "JAL Global Wallet", type: "PREPAID_CARD", institution: "JAL" },
    }),
  ]);
  bankId = bank.id;
  creditId = credit.id;
  walletId = wallet.id;
  for (const month of [3, 4, 5, 6, 7, 8, 9]) {
    const p = await prisma.period.create({
      data: { tenantId, fiscalYear: YEAR, month, quarter: Math.ceil(month / 3) },
    });
    periodIds.set(month, p.id);
  }
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.financialRecord.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

// 明細の日付は UTC の 0 時で持つ（取り込みと同じ）
const at = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const monthOf = (ymd: string) => Number(ymd.slice(5, 7));

function cardRow(cardId: number, ymd: string, description: string, flow: number) {
  return {
    tenantId,
    kind: "CARD" as const,
    cardAccountId: cardId,
    periodId: periodIds.get(monthOf(ymd))!,
    date: at(ymd),
    description,
    flow,
    amount: 0,
    source: "CSV" as const,
  };
}

describe("チャージの紐付けの候補", () => {
  it("チャージ先に新しい明細が 500 件を超えてあっても、古い日付の候補が出る", async () => {
    const target = await prisma.financialRecord.create({
      data: cardRow(walletId, `${YEAR}-03-15`, "住信SBIネット銀行", 5_000),
    });
    // 4 月以降に 600 件の利用明細
    await prisma.financialRecord.createMany({
      data: Array.from({ length: 600 }, (_, i) => {
        const day = new Date(YEAR, 3, 1 + (i % 150));
        const ymd = `${YEAR}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
        return cardRow(walletId, ymd, `利用 ${i}`, -100);
      }),
    });
    const res = await candidatesGet(
      makeReq(
        "GET",
        `http://x/api/charge-links/candidates?targetAccountId=${walletId}&amount=-5000&date=${YEAR}-03-15`,
      ),
      emptyRouteContext(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ id: target.id, amountMatch: true, dayGap: 0 });
  });
});

describe("自動相殺", () => {
  it("同じ日・同じ金額の入金が 2 件でも、摘要の銀行名で組む。対の無いカードのチャージも組む", async () => {
    const day = `${YEAR}-09-15`;
    const bankOut = await prisma.financialRecord.create({
      data: {
        tenantId,
        kind: "BANK",
        bankAccountId: bankId,
        periodId: periodIds.get(9)!,
        date: at(day),
        description: "振替　ＪＡＬ　Ｐａｙ （1000076392839）",
        flow: -5_000,
        amount: 0,
        source: "CSV",
      },
    });
    const cardOut = await prisma.financialRecord.create({
      data: { ...cardRow(creditId, day, "[信] ＪＡＬ　Ｐａｙ", -5_000), chargeToCardId: walletId },
    });
    const fromCard = await prisma.financialRecord.create({
      data: cardRow(walletId, day, "クレジットカード", 5_000),
    });
    const fromBank = await prisma.financialRecord.create({
      data: cardRow(walletId, day, "住信SBIネット銀行", 5_000),
    });

    const { pairs } = await applyAutoOffset(tenantDb(tenantId), [at(day)]);
    expect(pairs).toBe(2);
    const row = (id: number) => prisma.financialRecord.findUniqueOrThrow({ where: { id } });
    const [b, fb, c, fc] = await Promise.all([
      row(bankOut.id),
      row(fromBank.id),
      row(cardOut.id),
      row(fromCard.id),
    ]);
    expect(b.chargeToCardId).toBe(walletId);
    expect(b.chargeGroupId).not.toBeNull();
    expect(fb.chargeGroupId).toBe(b.chargeGroupId);
    expect(c.chargeToCardId).toBe(walletId);
    expect(c.chargeGroupId).not.toBeNull();
    expect(fc.chargeGroupId).toBe(c.chargeGroupId);
  });
});
