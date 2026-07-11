import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const fiscalYears = await db.fiscalYear.findMany({
    where: { tenantId },
    include: { tenant: true },
    orderBy: { year: "desc" },
  });
  return NextResponse.json({ data: fiscalYears });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as { year: number; startDate: string; endDate: string };
  if (!body.year || !body.startDate || !body.endDate) {
    return NextResponse.json({ error: "year, startDate, endDate are required" }, { status: 400 });
  }

  const fy = await db.fiscalYear.create({
    data: {
      tenantId,
      year: body.year,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    },
    include: { tenant: true },
  });
  return NextResponse.json({ data: fy }, { status: 201 });
}
