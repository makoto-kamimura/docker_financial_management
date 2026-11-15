/**
 * 明細分け（通販の注文）の請求とカードの明細の紐付けの結合テスト（実 DB 使用）
 *
 *   - 金額と日付が合い相手が 1 つに決まる明細に自動で紐付き、商品ごとの行（内訳）が実績になる。
 *     明細そのものは科目が外れ、未割り当てにも数えない
 *   - 科目の無い商品は未割り当てに数え、商品の科目を付けると数えなくなる（商品名の学習ルールにも覚える）
 *   - 手での紐付けは、金額の差を商品の金額の割合で割り振る。候補は金額の差の小さい順
 *   - 紐付いた明細には科目を付けられず、チャージにもできない
 *   - 事業利用の商品は scope=business で按分した額になり、自動仕訳でも商品ごとの行になる
 *   - 紐付けを外すと明細は未割り当てに戻る。実績を確定済みの月の明細には紐付けない
 *   - 明細を消すと内訳の行も消え、請求は未紐付けに戻る
 *
 * 実行: `npm run test:integration`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/server/authz", () => ({
  requireRole: vi.fn(async () =>
    actingUser ? { user: actingUser } : { error: new Response("unauthorized", { status: 401 }) },
  ),
}));

import { prisma } from "@/lib/server/prisma";
import { tenantDb } from "@/lib/server/tenant-db";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { createTestEntry } from "@/lib/ledger/test-entries";
import { countUnassignedEntries } from "@/lib/ledger/actuals-coverage";
import { loadAutoBook } from "@/lib/accounting/auto-journal-data";
import { GET as listGet } from "./route";
import { POST as autoLinkPost } from "./auto-link/route";
import { POST as linkPost, DELETE as linkDelete } from "./[id]/link/route";
import { GET as candidatesGet } from "./[id]/candidates/route";
import { DELETE as chargeDelete } from "./[id]/route";
import { PATCH as itemPatch } from "./items/[id]/route";
import { PATCH as cardCategorize } from "../card-transactions/[id]/categorize/route";
import { PATCH as cardTransfer } from "../card-transactions/[id]/transfer/route";
import { GET as matrixGet } from "../financials/matrix/route";
import { GET as unassignedGet } from "../ledger/unassigned/route";

const SUFFIX = `shopo_${Date.now()}`;
const YEAR = 2092;

function makeReq(url: string, method = "GET", body?: unknown) {
  return {
    method,
    nextUrl: new URL(url),
    json: () => Promise.resolve(body ?? {}),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as import("next/server").NextRequest;
}
const call = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: any, ctx: any) => Promise<Response>,
  url: string,
  method = "GET",
  body?: unknown,
  id?: number,
) =>
  handler(
    makeReq(`http://x${url}`, method, body),
    id === undefined ? emptyRouteContext() : { params: Promise.resolve({ id: String(id) }) },
  );

let tenantId: number;
let cardId: number;
let walletId: number;
let shopId: number;
let daily: number;
let books: number;
const e: Record<string, number> = {};
const c: Record<string, number> = {};
const items: Record<string, number> = {};

async function charge(
  key: string,
  ymd: string,
  amount: number,
  lines: { name: string; amount: number; categoryAccountId?: number }[],
) {
  const row = await prisma.shopCharge.create({
    data: {
      tenantId,
      shopAccountId: shopId,
      orderNo: `ORDER-${key}`,
      date: new Date(`${ymd}T00:00:00Z`),
      amount,
      externalKey: key,
      items: {
        create: lines.map((l, i) => ({
          tenantId,
          name: l.name,
          amount: l.amount,
          categoryAccountId: l.categoryAccountId ?? null,
          sortOrder: i,
        })),
      },
    },
    include: { items: true },
  });
  for (const it of row.items) items[it.name] = it.id;
  return row.id;
}

const cardEntry = (ymd: string, flow: number, description: string, category?: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return createTestEntry(
    tenantId,
    { kind: "CARD", accountId: cardId },
    {
      date: new Date(y, m - 1, d),
      description,
      flow,
      category: category ? ({ id: category, category: "EXPENSE" } as never) : (null as never),
    },
  ).then((r) => r.id);
};

const record = (id: number) => prisma.financialRecord.findUniqueOrThrow({ where: { id } });
const splitsOf = (id: number) =>
  prisma.financialRecord.findMany({ where: { splitOfId: id }, orderBy: { id: "asc" } });

beforeAll(async () => {
  for (const t of [
    "tenants",
    "users",
    "accounts",
    "periods",
    "financial_records",
    "linked_accounts",
    "shop_accounts",
    "shop_charges",
    "shop_order_items",
  ]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "通販",
      passwordHash: "x",
      role: "admin",
    },
  });
  actingUser = { id: user.id, tenantId, role: "admin", email: user.email, name: user.name };
  const acct = async (code: string, name: string) =>
    (
      await prisma.account.create({
        data: { tenantId, code: `${code}_${SUFFIX}`, name, category: "EXPENSE" },
      })
    ).id;
  daily = await acct("E1", "日用品");
  books = await acct("E2", "書籍");
  cardId = (
    await prisma.linkedAccount.create({
      data: { tenantId, name: "JAL Global Wallet", type: "PREPAID_CARD", institution: "JAL" },
    })
  ).id;
  walletId = (
    await prisma.linkedAccount.create({
      data: { tenantId, name: "電子マネー", type: "E_MONEY", institution: "X" },
    })
  ).id;
  shopId = (
    await prisma.shopAccount.create({
      data: { tenantId, name: "Amazon", type: "AMAZON", paymentCardIds: [cardId] },
    })
  ).id;

  // 3 月: 自動で紐付く（金額・日付・摘要が合う）明細と、金額の合わない明細、会費の明細
  e.auto = await cardEntry(`${YEAR}-03-02`, -3_000, "AMAZON.CO.JP", daily);
  e.manual = await cardEntry(`${YEAR}-03-10`, -1_500, "AMAZON.CO.JP 非接触");
  e.prime = await cardEntry(`${YEAR}-03-11`, -1_800, "AMAZON PRIME MEMBERSHI");
  // 2 月は実績を確定済みにする
  e.locked = await cardEntry(`${YEAR}-02-10`, -999, "AMAZON.CO.JP");
  const feb = await prisma.period.findUniqueOrThrow({
    where: { tenantId_fiscalYear_month: { tenantId, fiscalYear: YEAR, month: 2 } },
  });
  await prisma.actualsConfirmation.create({
    data: { tenantId, periodId: feb.id, confirmedById: user.id },
  });

  c.auto = await charge("A", `${YEAR}-03-01`, 3_000, [
    { name: "洗剤", amount: 1_000, categoryAccountId: daily },
    { name: "本", amount: 2_000, categoryAccountId: books },
  ]);
  // ポイントを使い、カードの請求は 1,500 円（商品は 1,800 円）
  c.manual = await charge("B", `${YEAR}-03-09`, 1_800, [{ name: "電池 単3", amount: 1_800 }]);
  c.locked = await charge("C", `${YEAR}-02-10`, 999, [{ name: "ケーブル", amount: 999 }]);
});

afterAll(async () => {
  if (!tenantId) return;
  const where = { tenantId };
  await prisma.shopItemRule.deleteMany({ where });
  await prisma.shopOrderItem.deleteMany({ where });
  await prisma.shopCharge.deleteMany({ where });
  await prisma.shopAccount.deleteMany({ where });
  await prisma.actualsConfirmation.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where: { tenantId, splitOfId: { not: null } } });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.linkedAccount.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("明細分けの請求とカードの明細の紐付け", () => {
  it("金額・日付・摘要が合い 1 つに決まる明細だけに自動で紐付き、商品ごとの行が実績になる", async () => {
    const res = await call(autoLinkPost, "/api/shop-orders/auto-link", "POST", {});
    expect(await res.json()).toEqual({ linked: 1 });

    const linked = await prisma.shopCharge.findUniqueOrThrow({ where: { id: c.auto } });
    expect(linked).toMatchObject({ entryId: e.auto, linkedBy: "AUTO" });
    // 明細は科目が外れ、実績から抜ける
    expect(await record(e.auto)).toMatchObject({ accountId: null });
    expect(Number((await record(e.auto)).amount)).toBe(0);
    const parts = await splitsOf(e.auto);
    expect(
      parts.map((p) => [p.description, p.accountId, Number(p.amount), Number(p.flow)]),
    ).toEqual([
      ["洗剤", daily, 1_000, -1_000],
      ["本", books, 2_000, -2_000],
    ]);
    expect(parts.every((p) => p.kind === null)).toBe(true);

    // 科目×月の表には商品ごとの行が出て、出どころはカードの明細
    const matrix = await (await call(matrixGet, `/api/financials/matrix?year=${YEAR}`)).json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const book = matrix.data.find((r: any) => r.account.id === books);
    expect(book).toMatchObject({
      amount: 2_000,
      source: { kind: "card", accountName: "JAL Global Wallet", description: "AMAZON.CO.JP（本）" },
    });
  });

  it("手での紐付けの候補は、金額の差の小さい順。キーワードに当たらない明細も出す", async () => {
    const res = await call(
      candidatesGet,
      `/api/shop-orders/${c.manual}/candidates`,
      "GET",
      undefined,
      c.manual,
    );
    const { data } = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = data.map((d: any) => d.id);
    expect(ids).toContain(e.manual);
    expect(ids).toContain(e.prime);
    expect(ids).not.toContain(e.auto); // もう紐付いている
    expect(data[0]).toMatchObject({ id: e.prime, amountGap: 0, keywordMatch: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(data.find((d: any) => d.id === e.manual)).toMatchObject({
      amountGap: -300,
      keywordMatch: true,
    });
  });

  it("手で紐付けると差額を割り振り、科目の無い商品は未割り当てに数える", async () => {
    const before = await countUnassignedEntries(tenantDb(tenantId), tenantId, YEAR, 3);
    expect(before).toBe(2); // 紐付いていない明細（e.manual・e.prime）

    const res = await call(
      linkPost,
      `/api/shop-orders/${c.manual}/link`,
      "POST",
      { entryId: e.manual },
      c.manual,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.items[0]).toMatchObject({
      name: "電池 単3",
      amount: 1_800,
      allocatedAmount: 1_500,
    });
    expect(data.entry).toMatchObject({
      id: e.manual,
      amount: -1_500,
      sourceName: "JAL Global Wallet",
    });

    const parts = await splitsOf(e.manual);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ accountId: null });
    expect(Number(parts[0].flow)).toBe(-1_500);
    // 明細は数えず、科目の無い商品の行を数える
    expect(await countUnassignedEntries(tenantDb(tenantId), tenantId, YEAR, 3)).toBe(2);
    const list = await (
      await call(unassignedGet, `/api/ledger/unassigned?year=${YEAR}&month=3`)
    ).json();
    expect(list).toMatchObject({ unassignedCount: 2, shopItemCount: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(list.data.map((r: any) => r.id)).toEqual([e.prime]);
  });

  it("商品に科目を付けると実績になり、商品名を学習ルールに覚える", async () => {
    const res = await call(
      itemPatch,
      `/api/shop-orders/items/${items["電池 単3"]}`,
      "PATCH",
      { categoryAccountId: daily, learn: true },
      items["電池 単3"],
    );
    expect(res.status).toBe(200);
    const parts = await splitsOf(e.manual);
    expect(parts[0]).toMatchObject({ accountId: daily });
    expect(Number(parts[0].amount)).toBe(1_500);
    expect(await countUnassignedEntries(tenantDb(tenantId), tenantId, YEAR, 3)).toBe(1);
    const rules = await prisma.shopItemRule.findMany({ where: { tenantId } });
    expect(rules).toMatchObject([{ keyword: "電池 単3", categoryAccountId: daily, priority: 100 }]);

    const uncategorized = await (
      await call(listGet, `/api/shop-orders?status=uncategorized`)
    ).json();
    expect(uncategorized.total).toBe(1); // ケーブル（2 月）
  });

  it("紐付いた明細には科目を付けられず、チャージにもできない", async () => {
    const cat = await call(
      cardCategorize,
      `/api/card-transactions/${e.auto}/categorize`,
      "PATCH",
      { categoryAccountId: daily },
      e.auto,
    );
    expect(cat.status).toBe(400);
    const transfer = await call(
      cardTransfer,
      `/api/card-transactions/${e.auto}/transfer`,
      "PATCH",
      { transferToAccountId: walletId },
      e.auto,
    );
    expect(transfer.status).toBe(400);
  });

  it("事業利用の商品は scope=business で按分した額になり、自動仕訳でも商品ごとの行になる", async () => {
    const res = await call(
      itemPatch,
      `/api/shop-orders/items/${items["洗剤"]}`,
      "PATCH",
      { businessUse: true, businessRatio: 50 },
      items["洗剤"],
    );
    expect(res.status).toBe(200);
    const matrix = await (
      await call(matrixGet, `/api/financials/matrix?year=${YEAR}&scope=business`)
    ).json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = matrix.data.filter((r: any) => r.account.id === daily);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 500, fullAmount: 1_000, businessRatio: 50 });

    const book = await loadAutoBook(tenantDb(tenantId), tenantId, YEAR);
    const journal = book.journals.find((j) => j.description.includes("洗剤"));
    expect(journal).toBeDefined();
    expect(journal!.description).toBe("AMAZON.CO.JP（洗剤）");
  });

  it("紐付けを外すと明細は未割り当てに戻り、内訳の行は消える", async () => {
    const res = await call(
      linkDelete,
      `/api/shop-orders/${c.auto}/link`,
      "DELETE",
      undefined,
      c.auto,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.entry).toBeNull();
    expect(await splitsOf(e.auto)).toHaveLength(0);
    expect(await record(e.auto)).toMatchObject({ accountId: null });
    expect(await countUnassignedEntries(tenantDb(tenantId), tenantId, YEAR, 3)).toBe(2);
  });

  it("実績を確定済みの月の明細には紐付けない", async () => {
    const res = await call(
      linkPost,
      `/api/shop-orders/${c.locked}/link`,
      "POST",
      { entryId: e.locked },
      c.locked,
    );
    expect(res.status).toBe(409);
    expect(
      await call(autoLinkPost, "/api/shop-orders/auto-link", "POST", {}).then((r) => r.json()),
    ).toEqual({
      linked: 1, // 外した c.auto がもう一度紐付く（c.locked は確定済みの月なので紐付かない）
    });
    expect(
      (await prisma.shopCharge.findUniqueOrThrow({ where: { id: c.locked } })).entryId,
    ).toBeNull();
  });

  it("明細を消すと内訳の行も消え、請求は未紐付けに戻る。請求を消すと明細は未割り当てに戻る", async () => {
    await prisma.financialRecord.delete({ where: { id: e.manual } });
    expect(await splitsOf(e.manual)).toHaveLength(0);
    expect(
      (await prisma.shopCharge.findUniqueOrThrow({ where: { id: c.manual } })).entryId,
    ).toBeNull();

    const res = await call(chargeDelete, `/api/shop-orders/${c.auto}`, "DELETE", undefined, c.auto);
    expect(res.status).toBe(204);
    expect(await splitsOf(e.auto)).toHaveLength(0);
    expect(await prisma.shopOrderItem.count({ where: { chargeId: c.auto } })).toBe(0);
  });
});
