import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { findAccountByCode } from "@/lib/period";
import {
  deleteFinancialRecordsForJournalEntry,
  JOURNAL_DETAILS_INCLUDE,
  syncJournalToFinancialRecords,
} from "@/lib/journal";

const ActualSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  accountCode: z.string().min(1),
  counterAccountCode: z.string().min(1),
  amount: z.number().positive(),
  direction: z.enum(["income", "expense"]),
  paymentMethod: z.string().optional(),
});

// GET /api/actuals?year=2026&month=6 … カレンダー日次実績（複式仕訳）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ user, db, query }) => {
    const year = query.year ?? new Date().getFullYear();
    const month = query.month ?? new Date().getMonth() + 1;

    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);

    const entries = await db.journalEntry.findMany({
      where: { tenantId: user.tenantId, transactionDate: { gte: from, lt: to } },
      include: JOURNAL_DETAILS_INCLUDE,
      orderBy: { transactionDate: "asc" },
    });

    return NextResponse.json({ data: entries });
  },
});

// POST /api/actuals … 日次実績の登録（内部的に複式仕訳を自動生成）
export const POST = withApi({
  role: "editor",
  schema: ActualSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;

    const [account, counter] = await Promise.all([
      findAccountByCode(db, tenantId, body.accountCode),
      findAccountByCode(db, tenantId, body.counterAccountCode),
    ]);
    if (!account) throw badRequest(`勘定科目 "${body.accountCode}" が見つかりません`);
    if (!counter) throw badRequest(`対当科目 "${body.counterAccountCode}" が見つかりません`);

    const [debitId, creditId] =
      body.direction === "income" ? [counter.id, account.id] : [account.id, counter.id];

    const entry = await db.journalEntry.create({
      data: {
        tenantId,
        transactionDate: new Date(body.date),
        description: body.description,
        paymentMethod: body.paymentMethod ?? "cash",
        details: {
          create: [
            { side: "debit", accountId: debitId, amount: body.amount },
            { side: "credit", accountId: creditId, amount: body.amount },
          ],
        },
      },
      include: JOURNAL_DETAILS_INCLUDE,
    });

    // D-5c: カレンダー入力（自動 2 行仕訳）も choke-point 経由で月次実績へ同期する
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

    await audit("create", `journal_entry:${entry.id}`);
    return NextResponse.json({ data: entry }, { status: 201 });
  },
});

// DELETE /api/actuals?id=123 … 日次実績の削除
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ id: z.coerce.number().int().positive() }),
  handler: async ({ user, db, query, audit }) => {
    const entry = await db.journalEntry.findUnique({
      where: { id: query.id, tenantId: user.tenantId },
    });
    if (!entry) throw notFound();

    // D-5a: 同期済み FinancialRecord 行があれば一緒に削除する（現状 actuals は未同期のため
    // no-op だが、D-5c で同期対象になった時点でこの処理がそのまま効くようにしておく）
    await db.$transaction(async (tx) => {
      await deleteFinancialRecordsForJournalEntry(tx, query.id);
      await tx.journalEntry.delete({ where: { id: query.id } });
    });
    await audit("delete", `journal_entry:${query.id}`);
    return NextResponse.json({ ok: true });
  },
});
