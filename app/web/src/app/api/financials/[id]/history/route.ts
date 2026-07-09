import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const recordId = parseInt(id, 10);
  if (isNaN(recordId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const record = await db.financialRecord.findUnique({ where: { id: recordId, tenantId } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const histories = await db.financialRecordHistory.findMany({
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
