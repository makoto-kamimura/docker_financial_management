/**
 * 申告書の転記用 PDF の結合テスト（実 DB 使用）
 *
 * - 保存した入力と帳簿から、要る申告書の一覧を返す（医療費控除・ワンストップ特例など）
 * - PDF を inline（確認）と attachment（保存）で返す。知らない申告書は 404
 * - 医療費控除の明細書・ワンストップ特例申請書は帳簿の明細から作る（ほかのテナントの明細は混ざらない）
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

import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/server/prisma";
import { createTestEntry } from "@/lib/ledger/test-entries";
import { emptyTaxInputs } from "@/lib/shared/tax-estimate";
import { loadFormContext } from "@/lib/tax/forms/context";
import { GET as formsGet } from "./route";
import { GET as formGet } from "./[form]/route";

const SUFFIX = `taxform_${Date.now()}`;
const YEAR = 2025;

function makeReq(url: string) {
  return {
    method: "GET",
    nextUrl: new URL(`http://x${url}`),
    json: () => Promise.resolve({}),
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}
const params = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });

let tenantId: number;
let otherTenantId: number;
const accounts = new Map<string, { id: number; category: "REVENUE" | "EXPENSE" | "COGS" }>();

beforeAll(async () => {
  for (const t of ["tenants", "users", "accounts", "periods", "financial_records"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: `Other_${SUFFIX}` } })).id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${SUFFIX}@example.com`,
      name: "申告",
      passwordHash: "x",
      role: "viewer",
    },
  });
  actingUser = { id: user.id, tenantId, role: "viewer", email: user.email, name: user.name };

  const defs = [
    ["H-1001", "給与", "REVENUE"],
    ["H-3009", "社会保険", "EXPENSE"],
    ["H-3030", "所得税", "EXPENSE"],
    ["H-2005", "医療費", "COGS"],
    ["H-3039", "ふるさと納税", "EXPENSE"],
  ] as const;
  for (const tid of [tenantId, otherTenantId]) {
    for (const [code, name, category] of defs) {
      const a = await prisma.account.create({ data: { tenantId: tid, code, name, category } });
      if (tid === tenantId) accounts.set(code, { id: a.id, category });
    }
  }
  const entry = (code: string, month: number, description: string, flow: number) =>
    createTestEntry(
      tenantId,
      { kind: "CASH" },
      { date: new Date(YEAR, month - 1, 15), description, flow, category: accounts.get(code)! },
    );
  await entry("H-1001", 6, "給与", 5_000_000);
  await entry("H-3009", 6, "社会保険", -750_000);
  await entry("H-3030", 6, "所得税", -120_000);
  await entry("H-2005", 3, "Aクリニック", -100_000);
  await entry("H-2005", 4, "Aクリニック", -60_000);
  await entry("H-2005", 5, "B歯科", -40_000);
  await entry("H-3039", 11, "A市", -20_000);
  await entry("H-3039", 12, "B町", -10_000);
  // ほかのテナントの医療費は混ざらない
  const otherMedical = await prisma.account.findFirstOrThrow({
    where: { tenantId: otherTenantId, code: "H-2005" },
  });
  await createTestEntry(
    otherTenantId,
    { kind: "CASH" },
    {
      date: new Date(YEAR, 2, 1),
      description: "他人の病院",
      flow: -999_999,
      category: { id: otherMedical.id, category: "COGS" },
    },
  );
  await prisma.taxReturnInput.create({
    data: {
      tenantId,
      taxYear: YEAR,
      inputs: { ...emptyTaxInputs(YEAR), furusatoMunicipalities: 2 },
    },
  });
});

afterAll(async () => {
  const where = { tenantId: { in: [tenantId, otherTenantId] } };
  await prisma.taxReturnInput.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { userId: actingUser.id } });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

describe("GET /api/tax-return/forms", () => {
  it("医療費控除で確定申告するので、確定申告書と医療費控除の明細書が要る。ワンストップ特例は要らない", async () => {
    const res = await formsGet(makeReq(`/api/tax-return/forms?year=${YEAR}`), params());
    expect(res.status).toBe(200);
    const list: { key: string; needed: boolean; pageCount: number }[] = (await res.json()).data;
    const needed = list.filter((f) => f.needed).map((f) => f.key);
    expect(needed).toEqual(expect.arrayContaining(["return-1", "return-2", "medical"]));
    expect(needed).not.toContain("one-stop");
    // ワンストップ特例申請書は寄附先ごと（2 枚）
    expect(list.find((f) => f.key === "one-stop")!.pageCount).toBe(2);
  });

  it("医療費控除の明細書は支払先ごとにまとめ、ほかのテナントの明細は入らない", async () => {
    const ctx = await loadFormContext(prisma as never, tenantId, YEAR, { sole: false });
    expect(ctx.medicalEntries.map((e) => [e.payee, e.amount])).toEqual([
      ["Aクリニック", 100_000],
      ["Aクリニック", 60_000],
      ["B歯科", 40_000],
    ]);
  });
});

describe("GET /api/tax-return/forms/[form]", () => {
  it("PDF を inline と attachment で返す", async () => {
    const res = await formGet(
      makeReq(`/api/tax-return/forms/medical?year=${YEAR}`),
      params({ form: "medical" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);

    const dl = await formGet(
      makeReq(`/api/tax-return/forms/one-stop?year=${YEAR}&download=1`),
      params({ form: "one-stop" }),
    );
    expect(dl.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect((await PDFDocument.load(new Uint8Array(await dl.arrayBuffer()))).getPageCount()).toBe(2);
  });

  it("知らない申告書は 404", async () => {
    const res = await formGet(
      makeReq(`/api/tax-return/forms/unknown?year=${YEAR}`),
      params({ form: "unknown" }),
    );
    expect(res.status).toBe(404);
  });
});
