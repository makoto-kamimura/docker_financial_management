import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("accountant");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const year = req.nextUrl.searchParams.get("year");
  const q = req.nextUrl.searchParams.get("q");

  const where: Prisma.JournalEntryWhereInput = { tenantId, approvalStatus: status };
  if (year) {
    where.transactionDate = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${Number(year) + 1}-01-01`),
    };
  }
  if (q) {
    where.description = { contains: q, mode: "insensitive" };
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
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("accountant");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    journalEntryId: number;
    action: "submit" | "approve" | "reject";
    comment?: string;
  };

  if (!body.journalEntryId || !body.action) {
    return NextResponse.json({ error: "journalEntryId and action are required" }, { status: 400 });
  }

  const entry = await db.journalEntry.findUnique({
    where: { id: body.journalEntryId, tenantId },
  });
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  const statusMap: Record<string, string> = {
    submit: "pending",
    approve: "approved",
    reject: "rejected",
  };
  const newStatus = statusMap[body.action];
  if (!newStatus) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const [, approval] = await db.$transaction([
    db.journalEntry.update({
      where: { id: body.journalEntryId },
      data: { approvalStatus: newStatus },
    }),
    db.journalApproval.create({
      data: {
        journalEntryId: body.journalEntryId,
        action:
          body.action === "submit"
            ? "submitted"
            : body.action === "approve"
              ? "approved"
              : "rejected",
        actorId: auth.user!.id,
        comment: body.comment ?? null,
      },
    }),
  ]);

  return NextResponse.json({ data: approval }, { status: 201 });
}
