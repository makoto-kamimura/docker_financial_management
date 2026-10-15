/**
 * 控除・確定申告の書類のファイルの結合テスト（実 DB 使用）
 *
 * - 証明書の画像・PDF を年・書類ごとに保存し、一覧・配信・削除ができる（ほかのテナントは 404）
 * - 画像と PDF 以外は 400、year・docId が無ければ 400、viewer は保存できない
 * - 現金の明細の証憑にセルフメディケーション税制の対象の額・品目を付けると、その年の一覧に出る
 * - 対象の額は PATCH で直せる・外せる
 *
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import { rm } from "node:fs/promises";
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
import { uploadStorage } from "@/lib/server/storage";
import { GET as docsGet, POST as docsPost } from "./route";
import { DELETE as docDelete } from "./[id]/route";
import { GET as docFile } from "./[id]/file/route";
import { PATCH as selfMedPatch } from "../self-medication/[id]/route";
import { POST as actualsPost } from "../../actuals/route";
import { POST as attachPost } from "../../actuals/[id]/receipts/route";

const SUFFIX = `taxdoc_${Date.now()}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from("%PDF-1.4\n%test\n");

function req(
  url: string,
  init: { method?: string; body?: unknown; form?: Record<string, string | File> } = {},
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(init.form ?? {})) fd.append(k, v);
  return {
    method: init.method ?? "GET",
    nextUrl: new URL(`http://localhost:3000${url}`),
    json: () => Promise.resolve(init.body ?? {}),
    formData: () => Promise.resolve(fd),
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}
const noParams = () => ({ params: Promise.resolve({}) });
const idParams = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const photo = () => new File([JPEG], "源泉徴収票.jpg", { type: "image/jpeg" });

let tenantId: number;
let otherTenantId: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let viewer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let outsider: any;
let medicineCode: string;

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
  medicineCode = `M${SUFFIX}`;
  await prisma.account.create({
    data: { tenantId, code: medicineCode, name: "医薬品費", category: "COGS" },
  });
});

afterAll(async () => {
  const tids = [tenantId, otherTenantId];
  const docs = await prisma.taxDocument.findMany({ where: { tenantId: { in: tids } } });
  for (const d of docs) await uploadStorage().remove(d.tenantId, d.savedName);
  const receipts = await prisma.receipt.findMany({
    where: { financialRecord: { tenantId: { in: tids } } },
    select: { savedName: true },
  });
  for (const r of receipts) await uploadStorage().remove(tenantId, r.savedName!);
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [editor.id, viewer.id, outsider.id] } },
  });
  await prisma.taxDocument.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.receipt.deleteMany({ where: { financialRecord: { tenantId: { in: tids } } } });
  await prisma.financialRecord.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.period.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.account.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tids } } });
  for (const tid of tids) await rm(tenantUploadDir(tid), { recursive: true, force: true });
  await prisma.$disconnect();
});

const list = async (year = 2026) => {
  const res = await docsGet(req(`/api/tax-return/documents?year=${year}`), noParams());
  expect(res.status).toBe(200);
  return (await res.json()).data;
};

describe("証明書のファイル", () => {
  let docId: number;

  it("年・書類ごとに保存し、一覧に出る（ほかの年には出ない）", async () => {
    actingUser = editor;
    const res = await docsPost(
      req("/api/tax-return/documents", {
        method: "POST",
        form: { year: "2026", docId: "withholdingSlip", file: photo() },
      }),
      noParams(),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    docId = created.id;
    expect(created).toMatchObject({
      taxYear: 2026,
      docId: "withholdingSlip",
      fileName: "源泉徴収票.jpg",
      fileType: "image",
      fileUrl: `/api/tax-return/documents/${docId}/file`,
    });
    const pdf = await docsPost(
      req("/api/tax-return/documents", {
        method: "POST",
        form: {
          year: "2026",
          docId: "lifeInsuranceCert",
          file: new File([PDF], "控除証明書.pdf", { type: "application/pdf" }),
        },
      }),
      noParams(),
    );
    expect(pdf.status).toBe(201);
    actingUser = viewer;
    const data = await list();
    expect(data.documents.map((d: { docId: string }) => d.docId).sort()).toEqual([
      "lifeInsuranceCert",
      "withholdingSlip",
    ]);
    expect((await list(2025)).documents).toEqual([]);
  });

  it("配信は自テナントだけ。inline と、download=1 で attachment", async () => {
    actingUser = viewer;
    const res = await docFile(req(`/api/tax-return/documents/${docId}/file`), idParams(docId));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
    const dl = await docFile(
      req(`/api/tax-return/documents/${docId}/file?download=1`),
      idParams(docId),
    );
    expect(dl.headers.get("Content-Disposition")).toMatch(/^attachment;/);

    actingUser = outsider;
    expect(
      (await docFile(req(`/api/tax-return/documents/${docId}/file`), idParams(docId))).status,
    ).toBe(404);
    expect(
      (
        await docDelete(
          req(`/api/tax-return/documents/${docId}`, { method: "DELETE" }),
          idParams(docId),
        )
      ).status,
    ).toBe(404);
  });

  it("画像と PDF 以外・year や docId が無いものは 400、viewer は 403", async () => {
    actingUser = editor;
    const text = await docsPost(
      req("/api/tax-return/documents", {
        method: "POST",
        form: {
          year: "2026",
          docId: "withholdingSlip",
          file: new File(["hello"], "memo.txt", { type: "text/plain" }),
        },
      }),
      noParams(),
    );
    expect(text.status).toBe(400);
    const noDoc = await docsPost(
      req("/api/tax-return/documents", { method: "POST", form: { year: "2026", file: photo() } }),
      noParams(),
    );
    expect(noDoc.status).toBe(400);
    actingUser = viewer;
    const denied = await docsPost(
      req("/api/tax-return/documents", {
        method: "POST",
        form: { year: "2026", docId: "withholdingSlip", file: photo() },
      }),
      noParams(),
    );
    expect(denied.status).toBe(403);
  });

  it("削除すると行もファイルも消える", async () => {
    actingUser = editor;
    const doc = await prisma.taxDocument.findUniqueOrThrow({ where: { id: docId } });
    const res = await docDelete(
      req(`/api/tax-return/documents/${docId}`, { method: "DELETE" }),
      idParams(docId),
    );
    expect(res.status).toBe(200);
    expect(await prisma.taxDocument.findUnique({ where: { id: docId } })).toBeNull();
    expect(await uploadStorage().get(tenantId, doc.savedName)).toBeNull();
  });
});

describe("セルフメディケーションのレシート", () => {
  let receiptId: number;

  it("証憑に対象の額と品目を付けると、その年の一覧に出る", async () => {
    actingUser = editor;
    const entry = await actualsPost(
      req("/api/actuals", {
        method: "POST",
        body: {
          date: "2026-10-12",
          description: "ドラッグストアミドリ",
          accountCode: medicineCode,
          amount: 2758,
          direction: "expense",
        },
      }),
      noParams(),
    );
    expect(entry.status).toBe(201);
    const entryId = (await entry.json()).data.id;
    const items = [
      { name: "かぜ薬A", amount: 1480 },
      { name: "目薬B", amount: 980 },
    ];
    const res = await attachPost(
      req(`/api/actuals/${entryId}/receipts`, {
        method: "POST",
        form: {
          file: new File([JPEG], "receipt.jpg", { type: "image/jpeg" }),
          selfMedicationAmount: "2460",
          selfMedicationItems: JSON.stringify(items),
        },
      }),
      idParams(entryId),
    );
    expect(res.status).toBe(201);
    const receipt = (await res.json()).data;
    receiptId = receipt.id;
    expect(receipt.selfMedicationAmount).toBe(2460);

    // 対象でない証憑は一覧に出ない
    await attachPost(
      req(`/api/actuals/${entryId}/receipts`, {
        method: "POST",
        form: { file: new File([JPEG], "other.jpg", { type: "image/jpeg" }) },
      }),
      idParams(entryId),
    );

    const data = await list();
    expect(data.selfMedicationReceipts).toEqual([
      expect.objectContaining({
        id: receiptId,
        date: "2026-10-12",
        merchant: "ドラッグストアミドリ",
        amount: 2460,
        items,
      }),
    ]);
    expect((await list(2025)).selfMedicationReceipts).toEqual([]);
  });

  it("品目の形が違えば 400", async () => {
    actingUser = editor;
    const entry = await prisma.financialRecord.findFirstOrThrow({
      where: { tenantId, description: "ドラッグストアミドリ" },
    });
    const res = await attachPost(
      req(`/api/actuals/${entry.id}/receipts`, {
        method: "POST",
        form: {
          file: new File([JPEG], "receipt.jpg", { type: "image/jpeg" }),
          selfMedicationAmount: "100",
          selfMedicationItems: "not json",
        },
      }),
      idParams(entry.id),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH で対象の額を直せ、null で対象から外せる。ほかのテナントは 404", async () => {
    actingUser = editor;
    const fixed = await selfMedPatch(
      req(`/api/tax-return/self-medication/${receiptId}`, {
        method: "PATCH",
        body: { amount: 1480, items: [{ name: "かぜ薬A", amount: 1480 }] },
      }),
      idParams(receiptId),
    );
    expect(fixed.status).toBe(200);
    expect((await list()).selfMedicationReceipts[0].amount).toBe(1480);

    actingUser = outsider;
    const denied = await selfMedPatch(
      req(`/api/tax-return/self-medication/${receiptId}`, {
        method: "PATCH",
        body: { amount: null },
      }),
      idParams(receiptId),
    );
    expect(denied.status).toBe(404);

    actingUser = editor;
    await selfMedPatch(
      req(`/api/tax-return/self-medication/${receiptId}`, {
        method: "PATCH",
        body: { amount: null },
      }),
      idParams(receiptId),
    );
    expect((await list()).selfMedicationReceipts).toEqual([]);
  });
});
