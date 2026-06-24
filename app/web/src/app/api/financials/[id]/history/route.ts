import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/financials/[id]/history … 個別実績データの変更履歴一覧
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const recordId = parseInt(id, 10);
  if (isNaN(recordId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const histories = await prisma.financialRecordHistory.findMany({
    where: { recordId },
    orderBy: { changedAt: "desc" },
    include: {
      record: {
        include: {
          account: { select: { code: true, name: true } },
          period: { select: { fiscalYear: true, month: true } },
        },
      },
    },
  });

  return NextResponse.json({ data: histories });
}
