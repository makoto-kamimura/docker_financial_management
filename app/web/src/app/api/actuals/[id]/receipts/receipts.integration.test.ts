/**
 * 現金の明細の証憑（POST / GET /api/actuals/[id]/receipts）の結合テスト（実 DB 使用）
 *
 * - 撮影したレシートの写真を、登録した現金の明細に付けられる（ファイルはテナントのフォルダに保存）
 * - 現金の明細の一覧（GET /api/actuals）に証憑が入る
 * - 証憑は /api/uploads から自テナントだけが取れる（ほかのテナントは 404）
 * - 証憑の削除・明細の削除で、行もファイルも消える
 * - 銀行の明細・他テナントの明細には付けられない。viewer は付けられない
 * - 証憑は仕訳か現金の明細のどちらか一方に付く（CHECK 制約）
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/server/redis", () => ({
  withCache: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
}));

const RANK: Record<string, number> = { viewer: 1, accountant: 2, editor: 3, admin: 4 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let actingUser: any = null;
vi.mock("@/lib/server/authz", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (!actingUser) return { error: new Response("unauthorized", { status: 401 }) };
    if (RANK[actingUser.role] < RANK[min]) {
      return { error: new Response("forbidden", { status: 403 }) };
    }
    return { user: actingUser };
  }),
}));

import { prisma } from "@/lib/server/prisma";
import { tenantUploadDir } from "@/lib/server/upload";
import { GET as listGet, POST as attachPost } from "./route";
import { DELETE as receiptDelete } from "./[receiptId]/route";
import { GET as actualsGet, POST as actualsPost, DELETE as actualsDelete } from "../../route";
import { GET as uploadGet } from "../../../uploads/[filename]/route";

const SUFFIX = `rcpt_${Date.now()}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function req(url: string, init: { method?: string; body?: unknown; file?: File } = {}) {
  const fd = new FormData();
  if (init.file) fd.append("file", init.file);
  return {
    method: init.method ?? "GET",
    nextUrl: new URL(`http://localhost:3000${url}`),
    json: () => Promise.resolve(init.body ?? {}),
    formData: () => Promise.resolve(fd),
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}
const idParams = (id: number, extra: Record<string, string> = {}) => ({
  params: Promise.resolve({ id: String(id), ...extra }),
});
const photo = () => new File([JPEG], "receipt.jpg", { type: "image/jpeg" });

let tenantId: number;
let otherTenantId: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let viewer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let outsider: any;
let foodCode: string;
let bankRecordId: number;

async function createCashEntry(): Promise<number> {
  actingUser = editor;
  const res = await actualsPost(
    req("/api/actuals", {
      method: "POST",
      body: {
        date: "2026-10-12",
        description: "スーパーマルヤマ",
        accountCode: foodCode,
        amount: 3456,
        direction: "expense",
      },
    }),
    { params: Promise.resolve({}) },
  );
  expect(res.status).toBe(201);
  return (await res.json()).data.id;
}

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "receipts", "financial_records"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: `Other_${SUFFIX}` } })).id;
  const user = (tid: number, role: string) =>
    prisma.user.create({
      data: {
        tenantId: tid,
        email: `${role}${tid}_${SUFFIX}@example.com`,
        name: role,
        passwordHash: "x",
        role,
      },
    });
  editor = await user(tenantId, "editor");
  viewer = await user(tenantId, "viewer");
  outsider = await user(otherTenantId, "admin");
  foodCode = `F${SUFFIX}`;
  await prisma.account.create({
    data: { tenantId, code: foodCode, name: "食費", category: "EXPENSE" },
  });
  const bank = await prisma.bankAccount.create({
    data: { tenantId, name: "テスト普通", bankName: "テスト銀行" },
  });
  const period = await prisma.period.create({
    data: { tenantId, fiscalYear: 2026, quarter: 4, month: 10 },
  });
  bankRecordId = (
    await prisma.financialRecord.create({
      data: {
        tenantId,
        periodId: period.id,
        kind: "BANK",
        bankAccountId: bank.id,
        date: new Date("2026-10-12"),
        description: "振込",
        flow: -1000,
        amount: 0,
      },
    })
  ).id;
});

afterAll(async () => {
  const tids = [tenantId, otherTenantId];
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [editor.id, viewer.id, outsider.id] } },
  });
  await prisma.receipt.deleteMany({ where: { financialRecord: { tenantId: { in: tids } } } });
  await prisma.financialRecord.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.bankAccount.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.period.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.account.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tids } } });
  for (const tid of tids) await rm(tenantUploadDir(tid), { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("現金の明細の証憑", () => {
  it("写真を付けると、テナントのフォルダに保存され、明細の一覧と証憑の一覧に入る", async () => {
    const entryId = await createCashEntry();
    const res = await attachPost(
      req(`/api/actuals/${entryId}/receipts`, { method: "POST", file: photo() }),
      idParams(entryId),
    );
    expect(res.status).toBe(201);
    const receipt = (await res.json()).data;
    expect(receipt).toMatchObject({ fileName: "receipt.jpg", fileType: "image" });
    expect(existsSync(path.join(tenantUploadDir(tenantId), receipt.savedName))).toBe(true);

    const list = await (
      await listGet(req(`/api/actuals/${entryId}/receipts`), idParams(entryId))
    ).json();
    expect(list.data).toHaveLength(1);

    const month = await (
      await actualsGet(req("/api/actuals?year=2026&month=10"), { params: Promise.resolve({}) })
    ).json();
    const entry = month.data.find((e: { id: number }) => e.id === entryId);
    expect(entry.receipts).toEqual([
      { id: receipt.id, fileName: "receipt.jpg", fileUrl: `/api/uploads/${receipt.savedName}` },
    ]);
  });

  it("証憑は自テナントだけが取れる（ほかのテナントは 404）", async () => {
    const entryId = await createCashEntry();
    const receipt = (
      await (
        await attachPost(
          req(`/api/actuals/${entryId}/receipts`, { method: "POST", file: photo() }),
          idParams(entryId),
        )
      ).json()
    ).data;
    const filename = { params: Promise.resolve({ filename: receipt.savedName }) };

    actingUser = viewer;
    const own = await uploadGet(req(`/api/uploads/${receipt.savedName}`), filename);
    expect(own.status).toBe(200);
    expect(own.headers.get("Content-Type")).toBe("image/jpeg");

    actingUser = outsider;
    expect((await uploadGet(req(`/api/uploads/${receipt.savedName}`), filename)).status).toBe(404);
    // 他テナントの明細には付けられない
    const res = await attachPost(
      req(`/api/actuals/${entryId}/receipts`, { method: "POST", file: photo() }),
      idParams(entryId),
    );
    expect(res.status).toBe(404);
  });

  it("証憑を消すと、行もファイルも消える", async () => {
    const entryId = await createCashEntry();
    const receipt = (
      await (
        await attachPost(
          req(`/api/actuals/${entryId}/receipts`, { method: "POST", file: photo() }),
          idParams(entryId),
        )
      ).json()
    ).data;
    const res = await receiptDelete(
      req(`/api/actuals/${entryId}/receipts/${receipt.id}`, { method: "DELETE" }),
      idParams(entryId, { receiptId: String(receipt.id) }),
    );
    expect(res.status).toBe(200);
    expect(await prisma.receipt.count({ where: { id: receipt.id } })).toBe(0);
    expect(existsSync(path.join(tenantUploadDir(tenantId), receipt.savedName))).toBe(false);
  });

  it("明細を消すと、証憑の行もファイルも消える", async () => {
    const entryId = await createCashEntry();
    const receipt = (
      await (
        await attachPost(
          req(`/api/actuals/${entryId}/receipts`, { method: "POST", file: photo() }),
          idParams(entryId),
        )
      ).json()
    ).data;
    const res = await actualsDelete(req(`/api/actuals?id=${entryId}`, { method: "DELETE" }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(await prisma.receipt.count({ where: { id: receipt.id } })).toBe(0);
    expect(existsSync(path.join(tenantUploadDir(tenantId), receipt.savedName))).toBe(false);
  });

  it("銀行の明細には付けられない（404）。viewer は付けられない（403）", async () => {
    actingUser = editor;
    const bank = await attachPost(
      req(`/api/actuals/${bankRecordId}/receipts`, { method: "POST", file: photo() }),
      idParams(bankRecordId),
    );
    expect(bank.status).toBe(404);

    const entryId = await createCashEntry();
    actingUser = viewer;
    const res = await attachPost(
      req(`/api/actuals/${entryId}/receipts`, { method: "POST", file: photo() }),
      idParams(entryId),
    );
    expect(res.status).toBe(403);
  });

  it("証憑は仕訳か現金の明細のどちらか一方に付く（CHECK 制約）", async () => {
    await expect(
      prisma.receipt.create({
        data: { fileName: "x.jpg", fileUrl: "/api/uploads/x.jpg", fileType: "image", fileSize: 1 },
      }),
    ).rejects.toThrow();
  });
});
