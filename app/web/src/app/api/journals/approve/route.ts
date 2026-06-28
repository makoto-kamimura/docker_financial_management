import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/journals/approve?status=pending&year=2026 — 承認待ち仕訳一覧
export async function GET(req: NextRequest) {
  const auth = await requireRole("accountant");
  if (auth.error) return auth.error;

  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const year = req.nextUrl.searchParams.get("year");
  const q = req.nextUrl.searchParams.get("q");

  const where: Prisma.JournalEntryWhereInput = { approvalStatus: status };
  if (year) {
    where.transactionDate = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${Number(year) + 1}-01-01`),
    };
  }
  if (q) {
    where.description = { contains: q, mode: "insensitive" };
  }

  const journals = await prisma.journalEntry.findMany({
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

// POST /api/journals/approve — 仕訳を承認申請 or 承認 or 差戻し
export async function POST(req: NextRequest) {
  const auth = await requireRole("accountant");
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    journalEntryId: number;
    action: "submit" | "approve" | "reject";
    comment?: string;
  };

  if (!body.journalEntryId || !body.action) {
    return NextResponse.json({ error: "journalEntryId and action are required" }, { status: 400 });
  }

  const statusMap: Record<string, string> = {
    submit: "pending",
    approve: "approved",
    reject: "rejected",
  };

  const newStatus = statusMap[body.action];
  if (!newStatus) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const [, approval] = await prisma.$transaction([
    prisma.journalEntry.update({
      where: { id: body.journalEntryId },
      data: { approvalStatus: newStatus },
    }),
    prisma.journalApproval.create({
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
