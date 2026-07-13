import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

const ApproveSchema = z.object({
  journalEntryId: z.number().int().positive(),
  action: z.enum(["submit", "approve", "reject"]),
  comment: z.string().optional(),
});

// GET /api/journals/approve?status=&year=&q= … 承認対象の仕訳一覧（accountant 以上）
export const GET = withApi({
  role: "accountant",
  querySchema: z.object({
    status: z.string().default("pending"),
    year: z.coerce.number().int().optional(),
    q: z.string().optional(),
  }),
  handler: async ({ user, db, query }) => {
    const where: Prisma.JournalEntryWhereInput = {
      tenantId: user.tenantId,
      approvalStatus: query.status,
    };
    if (query.year) {
      where.transactionDate = {
        gte: new Date(`${query.year}-01-01`),
        lt: new Date(`${query.year + 1}-01-01`),
      };
    }
    if (query.q) {
      where.description = { contains: query.q, mode: "insensitive" };
    }

    const journals = await db.journalEntry.findMany({
      where,
      include: {
        details: { include: { account: { select: { code: true, name: true } } } },
        approvals: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { actor: { select: { id: true, name: true } } },
        },
      },
      orderBy: { transactionDate: "desc" },
      take: 100,
    });

    return NextResponse.json({ data: journals });
  },
});

// POST /api/journals/approve … 承認アクション（submit / approve / reject）
export const POST = withApi({
  role: "accountant",
  schema: ApproveSchema,
  handler: async ({ user, db, body }) => {
    const entry = await db.journalEntry.findUnique({
      where: { id: body.journalEntryId, tenantId: user.tenantId },
    });
    if (!entry) throw notFound();

    const statusMap = { submit: "pending", approve: "approved", reject: "rejected" } as const;
    const actionMap = { submit: "submitted", approve: "approved", reject: "rejected" } as const;

    const [, approval] = await db.$transaction([
      db.journalEntry.update({
        where: { id: body.journalEntryId },
        data: { approvalStatus: statusMap[body.action] },
      }),
      db.journalApproval.create({
        data: {
          journalEntryId: body.journalEntryId,
          action: actionMap[body.action],
          actorId: user.id,
          comment: body.comment ?? null,
        },
      }),
    ]);

    return NextResponse.json({ data: approval }, { status: 201 });
  },
});
