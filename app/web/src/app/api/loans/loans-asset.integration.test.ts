/**
 * 借入金と資産のひも付け 結合テスト（実 DB 使用）
 *
 * 借入金の入力は借入金管理に集め、資産管理は資産だけを入力する形にした。
 * - 借入追加で「この借入で買った資産」をその場で作る・既存から選ぶ
 * - 借入条件の編集で資産を付け替える・外す、借入額を直す
 * - 資産の名前を変えても、資産を消しても、借入は変わらない
 * - 返済の記録が無い借入の残高は返済予定どおりに減る
 * - 資産の借入の予算への上乗せは、借入の予算連携先に入る
 * - マイグレーション（資産の紐付け負債科目 → 借入の予算連携先、asset 種別の決め直し）
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(async () =>
    actingUser ? { user: actingUser } : { error: new Response("unauthorized", { status: 401 }) },
  ),
}));

import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { emptyRouteContext } from "@/lib/api-handler";
import { computePersonalAssetDebtOverlay } from "@/lib/budget-overlay";
import { GET as loansGet, POST as loansPost } from "./route";
import { PATCH as loanPatch } from "./[id]/route";
import { POST as assetPost } from "../personal-assets/route";
import { PATCH as assetPatch, DELETE as assetDelete } from "../personal-assets/[id]/route";

const SUFFIX = `la_${Date.now()}`;

function makeReq(method: string, url: string, body?: unknown) {
  return {
    method,
    nextUrl: new URL(url, "http://localhost:3000"),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

let tenantId: number;
let liabilityCode: string;
let liabilityId: number;

const now = new Date();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
// 12 か月前に借りた 24 回払い・無利子の借入
const borrowedOn = ymd(new Date(Date.UTC(now.getFullYear() - 1, now.getMonth(), 1)));
const repaymentDate = ymd(new Date(Date.UTC(now.getFullYear() + 1, now.getMonth() - 1, 1)));

async function createLoan(body: Record<string, unknown>) {
  const res = await loansPost(
    makeReq("POST", "http://x/api/loans", {
      lenderName: "テスト銀行",
      amount: 2_400_000,
      interestRate: 0,
      borrowedOn,
      repaymentDate,
      loanType: "housing",
      ...body,
    }),
    emptyRouteContext(),
  );
  return { status: res.status, data: (await res.json()).data };
}

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "loans",
    "personal_assets",
    "personal_asset_valuations",
  ]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  const tenant = await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } });
  tenantId = tenant.id;
  actingUser = await prisma.user.create({
    data: {
      tenantId,
      email: `editor_${SUFFIX}@example.com`,
      name: "e",
      passwordHash: "x",
      role: "editor",
    },
  });
  liabilityCode = `L_${SUFFIX}`;
  const liability = await prisma.account.create({
    data: { tenantId, code: liabilityCode, name: "住宅ローン", category: "LIABILITY" },
  });
  liabilityId = liability.id;
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.personalAssetValuation.deleteMany({ where });
  await prisma.personalAsset.deleteMany({ where });
  await prisma.loan.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("借入追加で資産を付ける", () => {
  it("その場で作る: 資産ができて借入にひも付き、評価額の記録も残る", async () => {
    const { status, data } = await createLoan({
      linkedAccountCode: liabilityCode,
      asset: {
        mode: "new",
        name: "自宅",
        category: "BUILDING",
        acquisitionCost: 3_000_000,
        currentValue: 3_000_000,
      },
    });
    expect(status).toBe(201);
    expect(data.personalAsset).toMatchObject({ name: "自宅", category: "BUILDING" });
    const asset = await prisma.personalAsset.findFirstOrThrow({
      where: { tenantId, name: "自宅" },
    });
    expect(asset.loanId).toBe(data.id);
    expect(await prisma.personalAssetValuation.count({ where: { assetId: asset.id } })).toBe(1);
  });

  it("既存から選ぶ: ローンの無い資産にひも付く。ほかの借入がある資産は選べない", async () => {
    const created = await assetPost(
      makeReq("POST", "http://x/api/personal-assets", {
        name: "車",
        category: "VEHICLE",
        currentValue: 1_000_000,
      }),
      emptyRouteContext(),
    );
    const carId = (await created.json()).data.id;
    const first = await createLoan({
      lenderName: "カーローン",
      loanType: "car",
      asset: { mode: "link", assetId: carId },
    });
    expect(first.status).toBe(201);
    expect(first.data.personalAsset.id).toBe(carId);

    const second = await createLoan({
      lenderName: "もう一本",
      asset: { mode: "link", assetId: carId },
    });
    expect(second.status).toBe(400);
  });
});

describe("借入条件の編集", () => {
  it("資産を外す・付け替える、借入額を直すと残高も合わせる", async () => {
    const loan = await prisma.loan.findFirstOrThrow({
      where: { tenantId, lenderName: "カーローン" },
    });
    const car = await prisma.personalAsset.findFirstOrThrow({ where: { tenantId, name: "車" } });

    let res = await loanPatch(
      makeReq("PATCH", `http://x/api/loans/${loan.id}`, { assetId: null }),
      params(loan.id),
    );
    expect(res.status).toBe(200);
    expect(
      (await prisma.personalAsset.findUniqueOrThrow({ where: { id: car.id } })).loanId,
    ).toBeNull();

    res = await loanPatch(
      makeReq("PATCH", `http://x/api/loans/${loan.id}`, { assetId: car.id, amount: 2_000_000 }),
      params(loan.id),
    );
    const data = (await res.json()).data;
    expect(data.personalAsset.id).toBe(car.id);
    expect(
      Number((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).remainingAmount),
    ).toBe(2_000_000);
  });
});

describe("資産の画面からは借入に触らない", () => {
  it("資産の名前を変えても借入は変わらず、資産を消しても借入は残る", async () => {
    const home = await prisma.personalAsset.findFirstOrThrow({ where: { tenantId, name: "自宅" } });
    const loanBefore = await prisma.loan.findUniqueOrThrow({ where: { id: home.loanId! } });

    await assetPatch(
      makeReq("PATCH", `http://x/api/personal-assets/${home.id}`, {
        name: "わが家",
        currentValue: 3_000_000,
      }),
      params(home.id),
    );
    const loanAfter = await prisma.loan.findUniqueOrThrow({ where: { id: home.loanId! } });
    expect(loanAfter.lenderName).toBe(loanBefore.lenderName);
    expect(Number(loanAfter.monthlyPayment ?? 0)).toBe(Number(loanBefore.monthlyPayment ?? 0));

    // 予算への上乗せは借入の予算連携先（負債科目）に入る
    const overlay = await computePersonalAssetDebtOverlay(
      tenantDb(tenantId),
      tenantId,
      now.getFullYear(),
    );
    expect(overlay.some((o) => o.accountId === liabilityId && o.assetName === "わが家")).toBe(true);

    const del = await assetDelete(
      makeReq("DELETE", `http://x/api/personal-assets/${home.id}`),
      params(home.id),
    );
    expect(del.status).toBe(200);
    expect(await prisma.loan.findUnique({ where: { id: loanBefore.id } })).not.toBeNull();
  });

  it("返済の記録が無い借入の残高は、返済予定どおりに減る", async () => {
    const res = await loansGet(makeReq("GET", "http://x/api/loans"), emptyRouteContext());
    const loans = (await res.json()).data as { lenderName: string; remainingAmount: string }[];
    const home = loans.find((l) => l.lenderName === "テスト銀行")!;
    // 24 回払いで 13 回分（借りた月を含む）済み → 11 回分の 1,100,000
    expect(Number(home.remainingAmount)).toBe(1_100_000);
  });
});

describe("マイグレーション（資産の借入の入力を借入金管理へ）", () => {
  it("資産の紐付け負債科目を借入の予算連携先に移し、asset 種別を資産の種別から決め直す", async () => {
    const loan = await prisma.loan.create({
      data: {
        tenantId,
        lenderName: "古い資産の借入",
        amount: 1_000_000,
        interestRate: 0,
        borrowedOn: new Date(borrowedOn),
        repaymentDate: new Date(repaymentDate),
        remainingAmount: 1_000_000,
        loanType: "asset",
      },
    });
    await prisma.personalAsset.create({
      data: {
        tenantId,
        name: "古い土地",
        category: "LAND",
        currentValue: 1,
        linkedAccountId: liabilityId,
        loanId: loan.id,
      },
    });
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20261010120000_move_asset_debt_inputs_to_loans/migration.sql",
      ),
      "utf8",
    );
    const statements = sql
      .split(";")
      .map((st) => st.replace(/--.*$/gm, "").trim())
      .filter(Boolean);
    for (const st of statements) await prisma.$executeRawUnsafe(st);

    const migrated = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(migrated.linkedAccountId).toBe(liabilityId);
    expect(migrated.loanType).toBe("housing");
  });
});
