import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const DETAIL_INCLUDE = {
  details: {
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { side: "asc" as const },
  },
};

// GET /api/actuals?year=2026&month=6
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year") ?? new Date().getFullYear());
  const month = Number(sp.get("month") ?? new Date().getMonth() + 1);

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 1);

  const entries = await db.journalEntry.findMany({
    where: { tenantId, transactionDate: { gte: from, lt: to } },
    include: DETAIL_INCLUDE,
    orderBy: { transactionDate: "asc" },
  });

  return NextResponse.json({ data: entries });
}

// POST /api/actuals
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    date: string;
    description: string;
    accountCode: string;
    counterAccountCode: string;
    amount: number;
    direction: "income" | "expense";
    paymentMethod?: string;
  };

  if (!body.date || !body.description || !body.accountCode || !body.counterAccountCode || !body.amount) {
    return NextResponse.json({ error: "必須項目が不足しています" }, { status: 400 });
  }

  const [account, counter] = await Promise.all([
    db.account.findUnique({ where: { tenantId_code: { tenantId, code: body.accountCode } } }),
    db.account.findUnique({ where: { tenantId_code: { tenantId, code: body.counterAccountCode } } }),
  ]);
  if (!account)
    return NextResponse.json({ error: `勘定科目 "${body.accountCode}" が見つかりません` }, { status: 400 });
  if (!counter)
    return NextResponse.json({ error: `対当科目 "${body.counterAccountCode}" が見つかりません` }, { status: 400 });

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
    include: DETAIL_INCLUDE,
  });

  await writeAudit(auth.user.id, "create", `journal_entry:${entry.id}`);
  return NextResponse.json({ data: entry }, { status: 201 });
}

// DELETE /api/actuals?id=123
export async function DELETE(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id が必要です" }, { status: 400 });

  const entry = await db.journalEntry.findUnique({ where: { id, tenantId } });
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.journalEntry.delete({ where: { id } });
  await writeAudit(auth.user.id, "delete", `journal_entry:${id}`);
  return NextResponse.json({ ok: true });
}
