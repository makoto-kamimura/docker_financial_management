/**
 * 仮の明細（/api/actuals/drafts）の結合テスト（実 DB 使用）
 *
 * - 写真と日付で仮を作るとすぐ応答し（読み取り中）、読み取りが終わると店名・金額などが仮に入る
 * - 仮の写真は、自テナントだけが /api/uploads から取れる
 * - 仮から登録すると（POST /api/actuals の draftId）、写真は明細の証憑になり、仮は消える。二度目は 409
 * - 読み取れなかった仮は理由を残し、読み取り直せる。回数の上限を超えたら、その旨を残す
 * - 仮を消すと写真のファイルも消える。viewer は仮を作れない
 *
 * 読み取り（Tesseract）はモックに差し替える。
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

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

const { scanWithTesseract, readDraft } = vi.hoisted(() => {
  const readDraft = {
    date: "2026-10-14",
    merchant: "ドラッグひまわり",
    total: 1280,
    items: [{ name: "かぜ薬", amount: 980, selfMedication: true }],
    selfMedicationTotal: 980,
    paymentMethod: "cash" as const,
  };
  return {
    readDraft,
    scanWithTesseract: vi.fn(async () => ({ draft: readDraft, model: "tesseract.js" })),
  };
});
vi.mock("@/lib/ledger/receipt-scan/tesseract", () => ({ scanWithTesseract }));

import { prisma } from "@/lib/server/prisma";
import { uploadStorage } from "@/lib/server/storage";
import { settleBackground } from "@/lib/server/background";
import { ReceiptScanError } from "@/lib/ledger/receipt-scan/types";
import { GET as listGet, POST as createPost } from "./route";
import { GET as oneGet, DELETE as oneDelete } from "./[id]/route";
import { POST as readPost } from "./[id]/read/route";
import { POST as actualsPost } from "../route";
import { GET as uploadGet } from "../../uploads/[filename]/route";

const SUFFIX = `draft_${Date.now()}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function req(url: string, init: { method?: string; body?: unknown; form?: FormData } = {}) {
  return {
    method: init.method ?? "GET",
    nextUrl: new URL(`http://localhost:3000${url}`),
    json: () => Promise.resolve(init.body ?? {}),
    formData: () => Promise.resolve(init.form ?? new FormData()),
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

async function createDraft(date = "2026-10-13") {
  const form = new FormData();
  form.append("file", new File([JPEG], "receipt.jpg", { type: "image/jpeg" }));
  form.append("date", date);
  const res = await createPost(req("/api/actuals/drafts", { method: "POST", form }), ctx());
  return { status: res.status, json: await res.json().catch(() => null) };
}

let tenantId: number;
let otherTenantId: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let viewer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let outsider: any;
let foodCode: string;
let otherCode: string;

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: `Other_${SUFFIX}` } })).id;
  const user = (role: string, tid = tenantId) =>
    prisma.user.create({
      data: {
        tenantId: tid,
        email: `${role}_${SUFFIX}@example.com`,
        name: role,
        passwordHash: "x",
        role,
      },
    });
  editor = await user("editor");
  viewer = await user("viewer");
  outsider = await user("admin", otherTenantId);
  foodCode = `F${SUFFIX}`;
  const food = await prisma.account.create({
    data: { tenantId, code: foodCode, name: "医療費", category: "EXPENSE" },
  });
  otherCode = `O${SUFFIX}`;
  await prisma.account.create({
    data: { tenantId: otherTenantId, code: otherCode, name: "食費", category: "EXPENSE" },
  });
  await prisma.txnCategoryRule.create({
    data: { tenantId, keyword: "ドラッグひまわり", categoryAccountId: food.id, priority: 100 },
  });
});

beforeEach(async () => {
  // 前のテストで作った仮の読み取りが終わってから、読み取りのモックを差し替える
  await settleBackground();
  actingUser = editor;
  scanWithTesseract.mockClear();
  scanWithTesseract.mockImplementation(async () => ({ draft: readDraft, model: "tesseract.js" }));
  await prisma.receiptScanRequest.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  await settleBackground();
  const where = { tenantId };
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [editor.id, viewer.id, outsider.id] } },
  });
  const drafts = await prisma.receiptDraft.findMany({ where, include: { receipts: true } });
  const records = await prisma.financialRecord.findMany({ where, include: { receipts: true } });
  for (const r of [...drafts.flatMap((d) => d.receipts), ...records.flatMap((r) => r.receipts)]) {
    if (r.savedName) await uploadStorage().remove(tenantId, r.savedName);
  }
  await prisma.receiptDraft.deleteMany({ where });
  await prisma.receiptScanRequest.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.txnCategoryRule.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where: { tenantId: otherTenantId } });
  await prisma.period.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.account.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect();
});

describe("仮を作る", () => {
  it("すぐ応答し（読み取り中）、読み取りが終わると店名・金額・科目の候補が入る", async () => {
    const { status, json } = await createDraft();
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ date: "2026-10-13", status: "READING", result: null });
    expect(json.data.photo.fileUrl).toMatch(/^\/api\/uploads\//);

    await settleBackground();
    const res = await oneGet(
      req(`/api/actuals/drafts/${json.data.id}`),
      ctx({ id: String(json.data.id) }),
    );
    const { data } = await res.json();
    expect(data).toMatchObject({
      status: "READ",
      error: null,
      result: {
        draft: { merchant: "ドラッグひまわり", total: 1280, date: "2026-10-14" },
        suggestedAccount: { code: foodCode },
        warnings: [],
      },
    });
    expect(scanWithTesseract).toHaveBeenCalledTimes(1);
    // 読み取りは回数に数える
    expect(await prisma.receiptScanRequest.count({ where: { tenantId } })).toBe(1);
  });

  it("仮の写真は自テナントだけが取れる", async () => {
    const { json } = await createDraft();
    const savedName = json.data.photo.fileUrl.split("/").pop();
    const ok = await uploadGet(req(json.data.photo.fileUrl), ctx({ filename: savedName }));
    expect(ok.status).toBe(200);
    actingUser = outsider;
    const ng = await uploadGet(req(json.data.photo.fileUrl), ctx({ filename: savedName }));
    expect(ng.status).toBe(404);
  });

  it("月で絞った一覧は、撮ったときに選んでいた日で数える", async () => {
    await createDraft("2026-09-30");
    const res = await listGet(req("/api/actuals/drafts?year=2026&month=9"), ctx());
    const { data } = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.every((d: { date: string }) => d.date.startsWith("2026-09"))).toBe(true);
  });

  it("日付が無ければ 400。viewer は作れない（403）", async () => {
    const form = new FormData();
    form.append("file", new File([JPEG], "receipt.jpg", { type: "image/jpeg" }));
    const bad = await createPost(req("/api/actuals/drafts", { method: "POST", form }), ctx());
    expect(bad.status).toBe(400);
    actingUser = viewer;
    expect((await createDraft()).status).toBe(403);
  });
});

describe("読み取れないとき", () => {
  it("理由を残し、読み取り直せる", async () => {
    scanWithTesseract.mockRejectedValueOnce(new ReceiptScanError("この画像は読み取れません"));
    const { json } = await createDraft();
    await settleBackground();
    const id = String(json.data.id);
    let data = (await (await oneGet(req(`/x`), ctx({ id }))).json()).data;
    expect(data).toMatchObject({
      status: "FAILED",
      error: "この画像は読み取れません",
      result: null,
    });

    data = (await (await readPost(req(`/x`, { method: "POST" }), ctx({ id }))).json()).data;
    expect(data.status).toBe("READING");
    await settleBackground();
    data = (await (await oneGet(req(`/x`), ctx({ id }))).json()).data;
    expect(data).toMatchObject({ status: "READ", result: { draft: { total: 1280 } } });
  });

  it("今日の読み取りの上限を超えていたら、その旨を残す（写真は残る）", async () => {
    await prisma.receiptScanRequest.createMany({
      data: Array.from({ length: 30 }, () => ({
        tenantId,
        userId: editor.id,
        engine: "tesseract",
        status: "SUCCEEDED" as const,
      })),
    });
    const { json } = await createDraft();
    await settleBackground();
    const data = (await (await oneGet(req(`/x`), ctx({ id: String(json.data.id) }))).json()).data;
    expect(data.status).toBe("FAILED");
    expect(data.error).toContain("上限");
    expect(data.photo).not.toBeNull();
    expect(scanWithTesseract).not.toHaveBeenCalled();
  });
});

describe("仮から登録する", () => {
  const entry = (draftId: number) => ({
    date: "2026-10-14",
    description: "ドラッグひまわり",
    accountCode: foodCode,
    amount: 1280,
    direction: "expense",
    draftId,
    selfMedication: { amount: 980, items: [{ name: "かぜ薬", amount: 980 }] },
  });

  it("写真は明細の証憑になり（セルフメディケーションの額も）、仮は消える。二度目は 409", async () => {
    const { json } = await createDraft();
    await settleBackground();
    const draftId = json.data.id as number;

    const res = await actualsPost(
      req("/api/actuals", { method: "POST", body: entry(draftId) }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    const receipts = await prisma.receipt.findMany({ where: { financialRecordId: data.id } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ receiptDraftId: null, fileName: "receipt.jpg" });
    expect(Number(receipts[0].selfMedicationAmount)).toBe(980);
    expect(await prisma.receiptDraft.findUnique({ where: { id: draftId } })).toBeNull();
    // ファイルはそのまま（付け替えるだけ）
    expect(await uploadStorage().get(tenantId, receipts[0].savedName!)).not.toBeNull();

    const before = await prisma.financialRecord.count({ where: { tenantId } });
    const again = await actualsPost(
      req("/api/actuals", { method: "POST", body: entry(draftId) }),
      ctx(),
    );
    expect(again.status).toBe(409);
    // 明細の登録ごと取り消される
    expect(await prisma.financialRecord.count({ where: { tenantId } })).toBe(before);
  });

  it("ほかのテナントの仮からは登録できない（写真も付け替わらない）", async () => {
    const { json } = await createDraft();
    actingUser = outsider;
    const res = await actualsPost(
      req("/api/actuals", {
        method: "POST",
        body: { ...entry(json.data.id), accountCode: otherCode },
      }),
      ctx(),
    );
    expect(res.status).toBe(409);
    const receipt = await prisma.receipt.findFirst({ where: { receiptDraftId: json.data.id } });
    expect(receipt).toMatchObject({ financialRecordId: null });
    // 明細も作られない
    expect(await prisma.financialRecord.count({ where: { tenantId: otherTenantId } })).toBe(0);
  });
});

describe("仮を消す", () => {
  it("行も写真のファイルも消える", async () => {
    const { json } = await createDraft();
    await settleBackground();
    const savedName = json.data.photo.fileUrl.split("/").pop();
    const res = await oneDelete(req(`/x`, { method: "DELETE" }), ctx({ id: String(json.data.id) }));
    expect(res.status).toBe(200);
    expect(await prisma.receiptDraft.findUnique({ where: { id: json.data.id } })).toBeNull();
    expect(await prisma.receipt.count({ where: { savedName } })).toBe(0);
    expect(await uploadStorage().get(tenantId, savedName)).toBeNull();
  });
});
