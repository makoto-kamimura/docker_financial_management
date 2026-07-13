import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { parseBankCsv } from "@/lib/banktxn-import";
import { serializeBankTransaction, upsertExternalTransactions } from "@/lib/bank-transactions";

const TxnSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.number(),
  balance: z.number().nullable().optional(),
});

// GET /api/bank-accounts/[id]/transactions … 入出金明細（直近 200 件）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const account = await db.bankAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound();

    const txns = await db.bankTransaction.findMany({
      where: { accountId: id },
      orderBy: { date: "desc" },
      take: 200,
      include: { categoryAccount: { select: { id: true, code: true, name: true } } },
    });
    return NextResponse.json({ data: txns.map(serializeBankTransaction) });
  },
});

// POST /api/bank-accounts/[id]/transactions … 手動登録（JSON）/ CSV 取込（text）
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, id, audit }) => {
    const account = await db.bankAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound("account not found");

    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("application/json")) {
      const parsed = TxnSchema.safeParse(await req.json());
      if (!parsed.success) throw badRequest("date, description, amount は必須です");

      const body = parsed.data;
      const txn = await db.bankTransaction.create({
        data: {
          accountId: id,
          date: new Date(body.date),
          description: body.description,
          amount: body.amount,
          balance: body.balance ?? null,
          source: "MANUAL",
        },
      });
      await audit("create_txn", `bank_account:${id}:${txn.id}`);
      return NextResponse.json({ data: serializeBankTransaction(txn) }, { status: 201 });
    }

    const csv = await req.text();
    if (!csv.trim()) throw badRequest("empty body");

    const { rows, errors } = parseBankCsv(csv, id);
    const inserted = await upsertExternalTransactions(db, id, rows, "CSV");
    await audit("import_txn", `bank_account:${id}:${inserted}`);
    return NextResponse.json({ inserted, errors }, { status: errors.length ? 207 : 201 });
  },
});

// DELETE /api/bank-accounts/[id]/transactions?txnId= … 明細 1 件の削除
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ txnId: z.coerce.number().int().positive() }),
  handler: async ({ user, db, id, query, audit }) => {
    const account = await db.bankAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound();

    await db.bankTransaction.delete({ where: { id: query.txnId, accountId: id } });
    await audit("delete_txn", `bank_account:${id}:${query.txnId}`);
    return NextResponse.json({ ok: true });
  },
});
