/**
 * 実物資産の内訳・評価額の推移・総資産サマリの時点 結合テスト（実 DB 使用）
 *
 * - 住宅ローン 1 本で土地と建物を買った資産を、内訳つきの 1 資産として登録できる（ローンも 1 本）
 * - 評価額を入れ直すと記録が残り、内訳の合計が資産の評価額になる
 * - 推移（/api/personal-assets/trend）と、指定した月の時点の総資産サマリ（/api/assets/summary）
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
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
  requireRole: vi.fn(async () =>
    actingUser ? { user: actingUser } : { error: new Response("unauthorized", { status: 401 }) },
  ),
}));

import { prisma } from "@/lib/server/prisma";
import { createTestEntry } from "@/lib/ledger/test-entries";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { GET as listGet, POST as assetPost } from "./route";
import { PATCH as assetPatch } from "./[id]/route";
import { GET as trendGet } from "./trend/route";
import { GET as summaryGet } from "../assets/summary/route";

const SUFFIX = `pa_${Date.now()}`;

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
let houseId: number;

async function list() {
  const res = await listGet(makeReq("GET", "http://x/api/personal-assets"), emptyRouteContext());
  expect(res.status).toBe(200);
  return (await res.json()).data;
}
async function summary(year: number, month: number) {
  const res = await summaryGet(
    makeReq("GET", `http://x/api/assets/summary?year=${year}&month=${month}`),
    emptyRouteContext(),
  );
  expect(res.status).toBe(200);
  return res.json();
}
const amountOf = (s: { breakdown: { key: string; amount: number }[] }, key: string) =>
  s.breakdown.find((b) => b.key === key)?.amount;

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "loans",
    "personal_assets",
    "personal_asset_parts",
    "personal_asset_valuations",
    "bank_accounts",
    "financial_records",
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

  // 口座: 2015 年 1 月に 100 万円、今月に 50 万円の入金
  const bank = await prisma.bankAccount.create({
    data: { tenantId, name: "給与口座", bankName: "テスト銀行" },
  });
  const now = new Date();
  const target = { kind: "BANK" as const, accountId: bank.id };
  await createTestEntry(tenantId, target, {
    date: new Date(2015, 0, 10),
    description: "入金",
    flow: 1_000_000,
  });
  await createTestEntry(tenantId, target, {
    date: new Date(now.getFullYear(), now.getMonth(), 1),
    description: "入金",
    flow: 500_000,
  });
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.personalAssetValuation.deleteMany({ where });
  await prisma.personalAssetPart.deleteMany({ where });
  await prisma.personalAsset.deleteMany({ where });
  await prisma.loan.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where: { tenantId } });
  await prisma.period.deleteMany({ where: { tenantId } });
  await prisma.bankAccount.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("実物資産の内訳", () => {
  it("住宅ローン 1 本で買った土地と建物を、内訳つきの 1 資産として登録できる", async () => {
    const res = await assetPost(
      makeReq("POST", "http://x/api/personal-assets", {
        name: "自宅",
        category: "BUILDING",
        acquiredOn: "2016-04-01",
        debtStartOn: "2016-05",
        debtPayoffDue: "2050-04",
        debtInitialAmount: 30_000_000,
        parts: [
          {
            name: "土地",
            category: "LAND",
            acquisitionCost: 15_000_000,
            currentValue: 16_000_000,
            valuationRate: 1,
          },
          {
            name: "建物",
            category: "BUILDING",
            acquisitionCost: 20_000_000,
            currentValue: 12_000_000,
            buildingStructure: "wood",
          },
        ],
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    const asset = (await res.json()).data;
    houseId = asset.id;
    // 評価額と取得価格は内訳の合計。ローンは 1 本
    expect(Number(asset.currentValue)).toBe(28_000_000);
    expect(Number(asset.acquisitionCost)).toBe(35_000_000);
    expect(Number(asset.debtInitialAmount)).toBe(30_000_000);
    expect(await prisma.loan.count({ where: { tenantId } })).toBe(1);
    expect(asset.parts.map((p: { name: string }) => p.name)).toEqual(["土地", "建物"]);
    // 登録した日の評価額が記録され、今の見積もりはその合計
    expect(await prisma.personalAssetValuation.count({ where: { assetId: houseId } })).toBe(2);
    expect(asset.estimatedValue).toBe(28_000_000);
  });

  it("内訳ごとに価値の変わり方と向きを返す（土地は年 +1%、建物は木造 22 年で 0 円へ）", async () => {
    const [house] = await list();
    const [land, building] = house.parts;
    expect(land).toMatchObject({ ruleLabel: "年 +1%", trend: "up" });
    expect(building).toMatchObject({ ruleLabel: "木造 22 年で 0 円へ（定額）", trend: "down" });
    expect(house.ruleLabel).toBeNull();
  });

  it("内訳の評価額を入れ直すと、同じ日の記録を置き換え、資産の評価額は内訳の合計になる", async () => {
    const [house] = await list();
    const res = await assetPatch(
      makeReq("PATCH", `http://x/api/personal-assets/${houseId}`, {
        parts: house.parts.map(
          (p: { id: number; name: string; category: string; currentValue: string }) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            currentValue: p.name === "土地" ? 17_000_000 : Number(p.currentValue),
          }),
        ),
      }),
      params(houseId),
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()).data;
    expect(Number(updated.currentValue)).toBe(29_000_000);
    expect(updated.parts[0].valuationRate).not.toBeNull(); // 送らなかった設定はそのまま
    const landValuations = await prisma.personalAssetValuation.findMany({
      where: { assetId: houseId, partId: house.parts[0].id },
    });
    expect(landValuations.map((v) => Number(v.value))).toEqual([17_000_000]);
  });

  it("推移: 月末ごとの見積もりを返し、取得前の月は持っていない（null）", async () => {
    const res = await trendGet(
      makeReq("GET", "http://x/api/personal-assets/trend?back=150&forward=12"),
      emptyRouteContext(),
    );
    const data = (await res.json()).data;
    expect(data.months).toHaveLength(163);
    const house = data.assets.find((a: { id: number }) => a.id === houseId);
    expect(house.parts).toHaveLength(2);
    const i2016 = data.months.indexOf("2016-03");
    if (i2016 >= 0) expect(house.series[i2016]).toBeNull();
    // 建物は先へ行くほど下がる
    const now = data.months.indexOf(data.currentKey);
    const building = house.parts[1].series;
    expect(building[now + 12]).toBeLessThan(building[now]);
    expect(data.total[now]).toBe(house.series[now]);
  });

  it("内訳をやめると、資産そのものの評価額として記録する", async () => {
    const res = await assetPatch(
      makeReq("PATCH", `http://x/api/personal-assets/${houseId}`, {
        parts: [],
        currentValue: 29_000_000,
      }),
      params(houseId),
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()).data;
    expect(updated.parts).toEqual([]);
    expect(updated.estimatedValue).toBe(29_000_000);
    expect(
      await prisma.personalAssetValuation.count({ where: { assetId: houseId, partId: null } }),
    ).toBe(1);
  });
});

describe("過ぎた月の見積もりは変わらない", () => {
  let carId: number;
  async function carSeries() {
    const res = await trendGet(
      makeReq("GET", "http://x/api/personal-assets/trend?back=12&forward=0"),
      emptyRouteContext(),
    );
    const data = (await res.json()).data;
    const car = data.assets.find((a: { id: number }) => a.id === carId);
    // 今月は月末（まだ先）の見積もりなので、比べるのは先月まで
    return (car.series as (number | null)[]).slice(0, data.months.indexOf(data.currentKey));
  }

  it("価値の変わり方を変えても、評価額を入れ直しても、先月までの金額は同じ", async () => {
    const now = new Date();
    const eight = new Date(now.getFullYear(), now.getMonth() - 8, 1);
    const ym8 = `${eight.getFullYear()}-${String(eight.getMonth() + 1).padStart(2, "0")}-01`;
    const res = await assetPost(
      makeReq("POST", "http://x/api/personal-assets", {
        name: "車",
        category: "VEHICLE",
        acquiredOn: ym8,
        currentValue: 3_000_000,
      }),
      emptyRouteContext(),
    );
    carId = (await res.json()).data.id;
    // 登録時の記録を 8 か月前（取得日）に移し、それから今日まで「毎年 20% 減る」で見積もられた過去を作る
    await prisma.personalAssetValuation.updateMany({
      where: { assetId: carId },
      data: { valuedOn: new Date(Date.UTC(now.getFullYear(), now.getMonth() - 8, 1)) },
    });
    const before = await carSeries();
    expect(before.filter((v) => v !== null).length).toBeGreaterThan(5);

    // 価値の変わり方を「変わらない」に（編集画面と同じく、評価額も今と同じ値で送る）
    const changed = await assetPatch(
      makeReq("PATCH", `http://x/api/personal-assets/${carId}`, {
        valuationMethod: "fixed",
        currentValue: 3_000_000,
      }),
      params(carId),
    );
    const afterRule = (await changed.json()).data;
    expect(await carSeries()).toEqual(before);
    // 変える前の今日の見積もり（8 か月分減った値）を記録し、それを評価額にする
    expect(Number(afterRule.currentValue)).toBeLessThan(3_000_000);
    expect(afterRule.estimatedValue).toBe(Number(afterRule.currentValue));
    expect(await prisma.personalAssetValuation.count({ where: { assetId: carId } })).toBe(2);

    // 評価額を入れ直す
    await assetPatch(
      makeReq("PATCH", `http://x/api/personal-assets/${carId}`, { currentValue: 2_000_000 }),
      params(carId),
    );
    expect(await carSeries()).toEqual(before);
  });
});

describe("総資産サマリの時点", () => {
  it("指定した月の時点で出す: 取得前の実物資産は 0、口座はその月までの明細の合計", async () => {
    const past = await summary(2015, 1);
    expect(past.asOf).toBe("2015-01-31");
    expect(past.isCurrentMonth).toBe(false);
    expect(amountOf(past, "personalAssets")).toBe(0);
    expect(amountOf(past, "bankBalances")).toBe(1_000_000);
    // まだ借りていないローンは負債に入れない
    expect(amountOf(past, "personalAssetDebts")).toBe(0);

    const now = new Date();
    const current = await summary(now.getFullYear(), now.getMonth() + 1);
    expect(current.isCurrentMonth).toBe(true);
    expect(amountOf(current, "bankBalances")).toBe(1_500_000);
    // 自宅 2,900 万 ＋ 車 200 万
    expect(amountOf(current, "personalAssets")).toBe(31_000_000);
    expect(amountOf(current, "personalAssetDebts")).toBeLessThan(30_000_000);
  });
});
