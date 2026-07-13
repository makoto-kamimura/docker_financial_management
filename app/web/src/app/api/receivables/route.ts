import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { resolvePeriod } from "@/lib/period";
import { zDate } from "@/lib/zod-helpers";

const ReceivableSchema = z.object({
  customerName: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  taxAmount: z.number().default(0),
  issueDate: zDate,
  dueDate: zDate,
  invoiceNumber: z.string().optional(),
  note: z.string().optional(),
});

// GET /api/receivables?status=&year= … 売掛金一覧
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    status: z.string().optional(),
    year: z.coerce.number().int().optional(),
  }),
  handler: async ({ user, db, query }) => {
    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (query.status && query.status !== "all") where.status = query.status;
    if (query.year) {
      where.issueDate = {
        gte: new Date(`${query.year}-01-01`),
        lt: new Date(`${query.year + 1}-01-01`),
      };
    }

    const list = await db.receivable.findMany({ where, orderBy: { dueDate: "asc" } });
    return NextResponse.json({ data: list });
  },
});

// POST /api/receivables … 売掛金の登録（売掛金科目 1300 へ実績連動、editor 以上）
export const POST = withApi({
  role: "editor",
  schema: ReceivableSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    const record = await db.receivable.create({
      data: {
        tenantId,
        customerName: body.customerName,
        description: body.description,
        amount: body.amount,
        taxAmount: body.taxAmount,
        issueDate: body.issueDate,
        dueDate: body.dueDate,
        invoiceNumber: body.invoiceNumber ?? null,
        note: body.note ?? null,
      },
    });

    const arAccount = await db.account.findFirst({ where: { tenantId, code: "1300" } });
    if (arAccount) {
      const period = await resolvePeriod(
        db,
        tenantId,
        record.issueDate.getFullYear(),
        record.issueDate.getMonth() + 1,
      );
      await db.financialRecord.create({
        data: { tenantId, accountId: arAccount.id, periodId: period.id, amount: body.amount },
      });
    }

    return NextResponse.json({ data: record }, { status: 201 });
  },
});
