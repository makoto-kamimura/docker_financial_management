/**
 * レシートの読み取り（POST /api/actuals/receipt-scan）の結合テスト（実 DB 使用）
 *
 * - 無料プランはサーバーの中の OCR（Tesseract）、有料プランは Claude で読む
 * - 有料プランでも API キーが無ければ Tesseract で読む
 * - 店名が学習ルールに当たれば、科目の候補を返す
 * - テナントごとに 1 日 30 回まで。失敗した回は数えない
 * - 画像だけを受け付け、viewer は読み取れない
 * - POST /api/actuals の learn で、店名と科目を学習ルールに覚える
 *
 * Tesseract はモックに差し替え、Claude の API はこのファイルで立てる偽のサーバーで代用する。
 * 実行: `npm run test:integration`（DB 起動が前提）
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";

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

const { tesseractDraft, scanWithTesseract } = vi.hoisted(() => {
  const tesseractDraft = {
    date: "2026-10-13",
    merchant: "コンビニマート",
    total: 1280,
    items: [],
    paymentMethod: "cash" as const,
  };
  return { tesseractDraft, scanWithTesseract: vi.fn(async () => ({ draft: tesseractDraft })) };
});
vi.mock("@/lib/ledger/receipt-scan/tesseract", () => ({ scanWithTesseract }));

import { prisma } from "@/lib/server/prisma";
import { emptyRouteContext } from "@/lib/server/api-handler";
import { GET as statusGet, POST as scanPost } from "./route";
import { POST as actualsPost } from "../route";

const SUFFIX = `rscan_${Date.now()}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

// ── 偽の Claude ─────────────────────────────────────────────────
type ClaudeReply = { stop_reason: string; content: object[] };
let claudeReply: ClaudeReply;
const claudeRequests: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
const claudeServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    claudeRequests.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        stop_sequence: null,
        usage: { input_tokens: 1500, output_tokens: 80 },
        ...claudeReply,
      }),
    );
  });
});
const claudeDraft = {
  date: "2026-10-12",
  merchant: "スーパーマルヤマ",
  total: 3456,
  items: [{ name: "牛乳", amount: 250 }],
  paymentMethod: "card",
};
const okReply = (): ClaudeReply => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(claudeDraft) }],
});

function useClaude() {
  const { port } = claudeServer.address() as AddressInfo;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
}

// ── リクエスト ─────────────────────────────────────────────────
function scanReq(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return {
    method: "POST",
    nextUrl: new URL("http://localhost:3000/api/actuals/receipt-scan"),
    formData: () => Promise.resolve(fd),
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}
const jpeg = () => new File([JPEG], "receipt.jpg", { type: "image/jpeg" });
const getReq = () =>
  ({
    method: "GET",
    nextUrl: new URL("http://localhost:3000/api/actuals/receipt-scan"),
    headers: new Headers(),
  }) as unknown as import("next/server").NextRequest;
function jsonReq(body: unknown) {
  return {
    method: "POST",
    nextUrl: new URL("http://localhost:3000/api/actuals"),
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as unknown as import("next/server").NextRequest;
}

async function scan(file = jpeg()) {
  const res = await scanPost(scanReq(file), emptyRouteContext());
  return { status: res.status, json: await res.json() };
}
async function status() {
  return (await (await statusGet(getReq(), emptyRouteContext())).json()).data;
}

let tenantId: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let viewer: any;
let foodCode: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => claudeServer.listen(0, "127.0.0.1", resolve));
  for (const t of ["tenants", "users", "accounts"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
  tenantId = (await prisma.tenant.create({ data: { name: `Tenant_${SUFFIX}` } })).id;
  const user = (role: string) =>
    prisma.user.create({
      data: {
        tenantId,
        email: `${role}_${SUFFIX}@example.com`,
        name: role,
        passwordHash: "x",
        role,
      },
    });
  editor = await user("editor");
  viewer = await user("viewer");
  foodCode = `F${SUFFIX}`;
  const food = await prisma.account.create({
    data: { tenantId, code: foodCode, name: "食費", category: "EXPENSE" },
  });
  // 店名「コンビニマート」には食費が付く
  await prisma.txnCategoryRule.create({
    data: { tenantId, keyword: "コンビニマート", categoryAccountId: food.id, priority: 100 },
  });
});

beforeEach(async () => {
  actingUser = editor;
  claudeReply = okReply();
  claudeRequests.length = 0;
  scanWithTesseract.mockClear();
  await prisma.receiptScanRequest.deleteMany({ where: { tenantId } });
});

afterEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  await prisma.subscription.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  const where = { tenantId };
  await prisma.auditLog.deleteMany({ where: { userId: { in: [editor.id, viewer.id] } } });
  await prisma.receiptScanRequest.deleteMany({ where });
  await prisma.financialRecord.deleteMany({ where });
  await prisma.txnCategoryRule.deleteMany({ where });
  await prisma.period.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
  claudeServer.close();
});

const premium = () =>
  prisma.subscription.create({
    data: { tenantId, stripeCustomerId: `cus_${SUFFIX}`, status: "ACTIVE" },
  });

describe("無料プラン", () => {
  it("サーバーの中の OCR で読み、店名が学習ルールに当たれば科目の候補を返す", async () => {
    useClaude(); // キーがあっても、無料プランは Claude を使わない
    expect(await status()).toMatchObject({ engine: "tesseract", plan: "free", remaining: 30 });

    const { status: code, json } = await scan();
    expect(code).toBe(200);
    expect(json.data).toMatchObject({
      engine: "tesseract",
      remaining: 29,
      draft: tesseractDraft,
      suggestedAccount: { code: foodCode, name: "食費", category: "EXPENSE" },
    });
    expect(scanWithTesseract).toHaveBeenCalledTimes(1);
    expect(claudeRequests).toHaveLength(0);
    const rows = await prisma.receiptScanRequest.findMany({ where: { tenantId } });
    expect(rows).toMatchObject([{ engine: "tesseract", status: "SUCCEEDED", userId: editor.id }]);
  });
});

describe("有料プラン", () => {
  it("Claude で読み、使ったトークンを記録する", async () => {
    await premium();
    useClaude();
    expect(await status()).toMatchObject({ engine: "claude", plan: "premium" });

    const { status: code, json } = await scan();
    expect(code).toBe(200);
    expect(json.data).toMatchObject({
      engine: "claude",
      draft: claudeDraft,
      suggestedAccount: null,
    });
    expect(scanWithTesseract).not.toHaveBeenCalled();

    const sent = claudeRequests[0];
    expect(sent.url).toContain("/v1/messages");
    expect(sent.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(sent.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default" });
    expect(sent.body.output_config.effort).toBe("low");
    expect(sent.body.messages[0].content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: JPEG.toString("base64") },
    });

    const row = await prisma.receiptScanRequest.findFirstOrThrow({ where: { tenantId } });
    expect(row).toMatchObject({
      engine: "claude",
      status: "SUCCEEDED",
      model: "claude-opus-5-5",
      inputTokens: 1500,
      outputTokens: 80,
    });
  });

  it("API キーが無ければ、有料プランでもサーバーの中の OCR で読む", async () => {
    await premium();
    expect(await status()).toMatchObject({ engine: "tesseract", plan: "premium" });
    expect((await scan()).json.data.engine).toBe("tesseract");
  });

  it("読み取りを断られたら 422 で、回数には数えない", async () => {
    await premium();
    useClaude();
    claudeReply = { stop_reason: "refusal", content: [] };
    const { status: code, json } = await scan();
    expect(code).toBe(422);
    expect(json.code).toBe("receipt_scan_failed");
    const row = await prisma.receiptScanRequest.findFirstOrThrow({ where: { tenantId } });
    expect(row.status).toBe("FAILED");
    expect((await status()).remaining).toBe(30);
  });
});

describe("回数の上限", () => {
  it("1 日 30 回を超えると 429。昨日の分と失敗した分は数えない", async () => {
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
    await prisma.receiptScanRequest.createMany({
      data: [
        ...Array.from({ length: 29 }, () => ({
          tenantId,
          userId: editor.id,
          engine: "tesseract",
          status: "SUCCEEDED" as const,
        })),
        { tenantId, userId: editor.id, engine: "tesseract", status: "FAILED" as const },
        {
          tenantId,
          userId: editor.id,
          engine: "tesseract",
          status: "SUCCEEDED" as const,
          createdAt: yesterday,
        },
      ],
    });
    expect((await scan()).status).toBe(200); // 30 回目

    const over = await scan();
    expect(over.status).toBe(429);
    expect(over.json.code).toBe("receipt_scan_limit");
    expect(await status()).toMatchObject({ remaining: 0, reason: expect.stringContaining("上限") });
  });
});

describe("受け付ける画像", () => {
  it("画像以外・中身が拡張子と合わないファイルは 400。読み取りの記録も残さない", async () => {
    const pdf = new File([Buffer.from("%PDF-1.4")], "r.pdf", { type: "application/pdf" });
    expect((await scan(pdf)).status).toBe(400);
    const fake = new File([Buffer.from("not an image")], "r.jpg", { type: "image/jpeg" });
    expect((await scan(fake)).status).toBe(400);
    expect(await prisma.receiptScanRequest.count({ where: { tenantId } })).toBe(0);
  });

  it("viewer は読み取れない（403）", async () => {
    actingUser = viewer;
    const res = await scanPost(scanReq(jpeg()), emptyRouteContext());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/actuals の learn", () => {
  it("店名と科目を学習ルールに覚える", async () => {
    const res = await actualsPost(
      jsonReq({
        date: "2026-10-12",
        description: "スーパーマルヤマ",
        accountCode: foodCode,
        amount: 3456,
        direction: "expense",
        learn: true,
      }),
      emptyRouteContext(),
    );
    expect(res.status).toBe(201);
    const rule = await prisma.txnCategoryRule.findFirst({
      where: { tenantId, keyword: "スーパーマルヤマ" },
    });
    expect(rule).toMatchObject({ priority: 100 });
  });
});
