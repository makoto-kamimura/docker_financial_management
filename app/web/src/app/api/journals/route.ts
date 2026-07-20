import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { JOURNAL_DETAILS_INCLUDE, syncJournalToFinancialRecords } from "@/lib/journal";
import { invalidateCache } from "@/lib/redis";
import { resolveReceiptFileUrl } from "@/lib/upload";

const INCLUDE_WITH_RECEIPTS = {
  ...JOURNAL_DETAILS_INCLUDE,
  receipts: { orderBy: { uploadedAt: "desc" as const } },
};

// D-7: receipts[].fileUrl は savedName からの導出値で応答する（保存済みカラムは信用しない）
function withResolvedReceiptUrls<
  T extends { receipts: { savedName: string | null; fileUrl: string }[] },
>(entry: T): T {
  return {
    ...entry,
    receipts: entry.receipts.map((r) => ({ ...r, fileUrl: resolveReceiptFileUrl(r) })),
  };
}

const JournalSchema = z.object({
  transactionDate: z.string().min(1),
  description: z.string().min(1),
  paymentMethod: z.string().optional(),
  taxCategory: z.string().optional(),
  details: z
    .array(
      z.object({
        side: z.enum(["debit", "credit"]),
        accountId: z.number().int().positive(),
        amount: z.number(),
        note: z.string().optional(),
      }),
    )
    .min(1),
});

// GET /api/journals?year=2026&month=6&page=1&limit=50 … 仕訳一覧（ページング）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  handler: async ({ user, db, query }) => {
    const { year, month, page, limit } = query;

    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;
    if (year && month) {
      dateFrom = new Date(year, month - 1, 1);
      dateTo = new Date(year, month, 1);
    } else if (year) {
      dateFrom = new Date(year, 0, 1);
      dateTo = new Date(year + 1, 0, 1);
    }

    const where = {
      tenantId: user.tenantId,
      ...(dateFrom ? { transactionDate: { gte: dateFrom, lt: dateTo } } : {}),
    };

    const [total, entries] = await Promise.all([
      db.journalEntry.count({ where }),
      db.journalEntry.findMany({
        where,
        include: INCLUDE_WITH_RECEIPTS,
        orderBy: { transactionDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return NextResponse.json({ data: entries.map(withResolvedReceiptUrls), total, page, limit });
  },
});

// POST /api/journals — 仕訳登録（ヘッダ + 明細をまとめて）
export const POST = withApi({
  role: "editor",
  schema: JournalSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    const debitTotal = body.details
      .filter((d) => d.side === "debit")
      .reduce((s, d) => s + d.amount, 0);
    const creditTotal = body.details
      .filter((d) => d.side === "credit")
      .reduce((s, d) => s + d.amount, 0);
    if (Math.abs(debitTotal - creditTotal) > 0.01) {
      throw badRequest(`借方合計(${debitTotal})と貸方合計(${creditTotal})が一致しません`);
    }

    const entry = await db.journalEntry.create({
      data: {
        tenantId,
        transactionDate: new Date(body.transactionDate),
        description: body.description,
        paymentMethod: body.paymentMethod ?? "cash",
        taxCategory: body.taxCategory ?? "taxable",
        details: {
          create: body.details.map((d) => ({
            side: d.side,
            accountId: d.accountId,
            amount: d.amount,
            note: d.note ?? null,
          })),
        },
      },
      include: INCLUDE_WITH_RECEIPTS,
    });

    await syncJournalToFinancialRecords(
      db,
      tenantId,
      entry.id,
      entry.transactionDate,
      entry.details.map((d) => ({
        accountId: d.accountId,
        category: d.account.category,
        side: d.side,
        amount: Number(d.amount),
      })),
    );

    const year = entry.transactionDate.getFullYear();
    await invalidateCache(`closing:statements:${year}`);
    await invalidateCache(`reports:ledger:${year}:*`);

    return NextResponse.json({ data: withResolvedReceiptUrls(entry) }, { status: 201 });
  },
});
