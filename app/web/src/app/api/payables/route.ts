import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { resolvePeriod } from "@/lib/period";
import { zDate } from "@/lib/zod-helpers";

const PayableSchema = z.object({
  supplierName: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  taxAmount: z.number().default(0),
  issueDate: zDate,
  dueDate: zDate,
  note: z.string().optional(),
});

// GET /api/payables?status=&year= … 買掛金一覧
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

    const list = await db.payable.findMany({ where, orderBy: { dueDate: "asc" } });
    return NextResponse.json({ data: list });
  },
});

// POST /api/payables … 買掛金の登録（買掛金科目 3000 へ実績連動、editor 以上）
export const POST = withApi({
  role: "editor",
  schema: PayableSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    const record = await db.payable.create({
      data: {
        tenantId,
        supplierName: body.supplierName,
        description: body.description,
        amount: body.amount,
        taxAmount: body.taxAmount,
        issueDate: body.issueDate,
        dueDate: body.dueDate,
        note: body.note ?? null,
      },
    });

    const apAccount = await db.account.findFirst({ where: { tenantId, code: "3000" } });
    if (apAccount) {
      const period = await resolvePeriod(
        db,
        tenantId,
        record.issueDate.getFullYear(),
        record.issueDate.getMonth() + 1,
      );
      await db.financialRecord.create({
        data: { tenantId, accountId: apAccount.id, periodId: period.id, amount: body.amount },
      });
    }

    return NextResponse.json({ data: record }, { status: 201 });
  },
});
