import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { badRequest, notFound } from "@/lib/server/api-error";
import { removeTenantUpload } from "@/lib/server/upload";
import { assertActualsPeriodsEditable } from "@/lib/budget/budget-lock";
import { findAccountByCode } from "@/lib/accounting/period";
import { CASH, CASH_INCLUDE, createEntry, toCashEntry } from "@/lib/ledger/ledger-entries";
import { learnCategoryRule } from "@/lib/ledger/ledger-categorize";
import { BusinessInput, entryBusiness } from "@/lib/ledger/business-use";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";

// 現金の明細（実績の表 financial_records の kind = CASH の行）。実績管理の「現金」のカレンダーと履歴で使う。
// 科目を付けて登録するので、登録した時点で実績になる（科目は履歴から変えられる: ./[id]/categorize）。

const ActualSchema = BusinessInput.extend({
  date: z.string().min(1),
  description: z.string().min(1),
  accountCode: z.string().min(1),
  amount: z.number().positive(),
  direction: z.enum(["income", "expense"]),
  // true なら、摘要と科目の組を学習ルールに覚えさせる（次から同じ店名の明細に同じ科目が付く）
  learn: z.boolean().optional(),
});

// GET /api/actuals?year=2026&month=6 … その月の現金の明細（カレンダー）
// GET /api/actuals … 直近 200 件の現金の明細（履歴）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ db, query }) => {
    const byMonth = query.year !== undefined && query.month !== undefined;
    const rows = await db.financialRecord.findMany({
      where: {
        ...CASH,
        ...(byMonth
          ? {
              date: {
                gte: new Date(query.year!, query.month! - 1, 1),
                lt: new Date(query.year!, query.month!, 1),
              },
            }
          : {}),
      },
      include: CASH_INCLUDE,
      orderBy: [{ date: byMonth ? "asc" : "desc" }, { id: "asc" }],
      ...(byMonth ? {} : { take: 200 }),
    });
    return NextResponse.json({ data: rows.map(toCashEntry) });
  },
});

// POST /api/actuals … 現金の明細の登録（科目つき。登録した時点で実績になる）
export const POST = withApi({
  role: "editor",
  schema: ActualSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const account = await findAccountByCode(db, tenantId, body.accountCode);
    if (!account) throw badRequest(`勘定科目 "${body.accountCode}" が見つかりません`);

    const business = await entryBusiness(db, body, account);
    const row = await createEntry(
      db,
      tenantId,
      { kind: "CASH" },
      {
        date: new Date(body.date),
        description: body.description,
        flow: body.direction === "income" ? body.amount : -body.amount,
        source: "MANUAL",
        category: account,
        business,
      },
    );
    if (body.learn) {
      // 事業利用は指定したときだけ覚える（指定しなければ、覚えた事業利用を消さない）
      const learned = body.businessUse === undefined ? undefined : business;
      await learnCategoryRule(db, tenantId, body.description, account.id, learned);
    }
    await invalidateActualsCaches(user.tenantId);
    await audit("create_cash_entry", `financial_record:${row.id}`);
    const created = await db.financialRecord.findUniqueOrThrow({
      where: { id: row.id },
      include: CASH_INCLUDE,
    });
    return NextResponse.json({ data: toCashEntry(created) }, { status: 201 });
  },
});

// DELETE /api/actuals?id=123 … 現金の明細の削除（実績を確定済みの月は 409）。証憑のファイルも消す
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ id: z.coerce.number().int().positive() }),
  handler: async ({ user, db, query, audit }) => {
    const row = await db.financialRecord.findFirst({
      where: { id: query.id, ...CASH },
      include: { receipts: { select: { savedName: true } } },
    });
    if (!row) throw notFound();
    await assertActualsPeriodsEditable(db, [row.periodId]);
    await db.financialRecord.delete({ where: { id: row.id } });
    // 証憑の行は明細と一緒に消える（onDelete: Cascade）。ファイルはベストエフォートで消す
    for (const r of row.receipts) {
      if (r.savedName) await removeTenantUpload(user.tenantId, r.savedName);
    }
    await invalidateActualsCaches(user.tenantId);
    await audit("delete_cash_entry", `financial_record:${query.id}`);
    return NextResponse.json({ ok: true });
  },
});
