import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const tenantId = req.nextUrl.searchParams.get("tenantId");
  const fiscalYears = await prisma.fiscalYear.findMany({
    where: tenantId ? { tenantId: Number(tenantId) } : undefined,
    include: { tenant: true },
    orderBy: [{ tenantId: "asc" }, { year: "desc" }],
  });
  return NextResponse.json({ data: fiscalYears });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    tenantId: number;
    year: number;
    startDate: string;
    endDate: string;
  };
  if (!body.tenantId || !body.year || !body.startDate || !body.endDate) {
    return NextResponse.json(
      { error: "tenantId, year, startDate, endDate are required" },
      { status: 400 },
    );
  }

  const fy = await prisma.fiscalYear.create({
    data: {
      tenantId: body.tenantId,
      year: body.year,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    },
    include: { tenant: true },
  });
  return NextResponse.json({ data: fy }, { status: 201 });
}
