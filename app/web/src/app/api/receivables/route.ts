import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { zDate } from "@/lib/common/zod-helpers";
import { postIssueRecord } from "@/lib/accounting/settlement";
import { assertActualsDateEditable } from "@/lib/budget/budget-lock";

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

    // 実績（売掛金・買掛金の科目）へ連動するため、実績確定済みの月なら登録前に止める
    await assertActualsDateEditable(db, tenantId, body.issueDate);

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

    // 売掛金科目（1300）があれば実績へ連動記帳する（D-5d-2: 監査証跡の仕訳も併せて記録）
    await postIssueRecord(db, tenantId, "receivable", record.issueDate, body.amount);

    return NextResponse.json({ data: record }, { status: 201 });
  },
});
